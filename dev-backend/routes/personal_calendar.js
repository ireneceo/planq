// routes/personal_calendar.js — 개인 Google 캘린더 overlay + 일정 수정·삭제
//
// external_connections.js 에서 분리 (god-file 가드: 라우트 500줄). 개인 캘린더는 스코프·권한
// 경계가 다른 독립 도메인이라 파일도 나눈다 — 마운트 prefix 는 그대로 '/api'.
//
// ★ 사적 공간: 모든 라우트가 **연결 소유자 본인**만 통과한다. owner·admin 백도어 없음.
const express = require('express');
const { writeAudit } = require('../services/auditService');
const { Op } = require('sequelize');
const router = express.Router();
const { ExternalConnection, BusinessMember, CalendarEvent, CalendarEventGcalLink } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const personalCalendar = require('../services/personalCalendar');
const { perUserLimiter, capText } = require('../middleware/costGuard');

// 본인이 해당 워크스페이스 멤버인지 검증 (owner 도 business_members 행 보유 — 확인됨)
//   external_connections.js 의 동명 헬퍼와 같은 정의 — 두 파일이 각자 쓰는 사설 헬퍼다.
async function assertBusinessMember(req, bizId) {
  if (req.user.platform_role === 'platform_admin') return true;
  const bm = await BusinessMember.findOne({ where: { user_id: req.user.id, business_id: bizId, removed_at: null } });
  return !!bm;
}

// 이 연결의 쓰기 캘린더 이름 — 화면이 «어디로 올리는지» 를 적는 근거다(목록 권한 없이도).
function calendarLabelOf(conn) {
  const id = personalCalendar.calendarIdOf(conn);
  const meta = (conn.metadata && typeof conn.metadata === 'object') ? conn.metadata : {};
  return { calendar_id: id, calendar_primary: id === 'primary', calendar_summary: id === 'primary' ? null : (meta.calendar_summary || null) };
}

// 묶어서 돌린다 — 동시에 limit 개까지, 전체 deadline 을 넘긴 일은 기다리지 않고 «시간 초과» 로 돌려준다.
async function runPool(jobs, { limit = 4, deadlineAt }) {
  const results = new Array(jobs.length);
  let next = 0;
  const timeout = new Promise((resolve) => {
    const ms = Math.max(0, deadlineAt - Date.now());
    const t = setTimeout(() => resolve('__timeout__'), ms);
    if (t.unref) t.unref();
  });
  async function worker() {
    while (next < jobs.length) {
      const i = next++;
      if (Date.now() >= deadlineAt) { results[i] = { ok: false, error: 'timeout' }; continue; }
      const r = await Promise.race([
        jobs[i]().then((value) => ({ ok: true, value }), (e) => ({ ok: false, error: e })),
        timeout,
      ]);
      results[i] = r === '__timeout__' ? { ok: false, error: 'timeout' } : r;
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return results;
}

// 구글 오류 → 화면에 실을 짧은 코드. 메시지 원문(이름·주소가 섞일 수 있다)은 내리지 않는다.
function errCode(e) {
  if (e === 'timeout') return 'timeout';
  const code = e && (e.code || e.status);
  if (code === 401 || code === 403) return 'forbidden';
  if (code === 404 || code === 410) return 'not_found';
  return 'failed';
}

// ─── Phase 2 — 개인 Google Calendar overlay ──────────────
// GET /api/me/calendar/events?business_id=&start=&end=
// → 본인 연결된 개인 Google 캘린더들의 일정 (정규화). Q Calendar 가 overlay 로 표시.
//   2026-10-12 (Fable 2단계 판정 4·5) — 연결마다 «보이기로 한 캘린더들» 을 각각 읽어 합친다.
//   동시 4 · 호출당 10초 · 요청 전체 25초 · 60초 캐시. 실패는 **캘린더 단위**로 알리고, 연결 전체가 실패할 때만 fail_count 를 올린다
//   (공휴일 캘린더 하나가 404 라고 연결을 병든 것으로 찍지 않는다).
router.get('/me/calendar/events', authenticateToken,
  perUserLimiter('personal-cal-read', { windowMs: 60 * 1000, max: 60 }),
  async (req, res, next) => {
  try {
    const bizId = parseInt(req.query.business_id, 10);
    if (!bizId) return errorResponse(res, 'business_id_required', 400);
    if (!(await assertBusinessMember(req, bizId))) return errorResponse(res, 'no_business_access', 403);

    const DAY = 24 * 3600 * 1000;
    const timeMin = req.query.start ? new Date(req.query.start).toISOString() : new Date(Date.now() - 31 * DAY).toISOString();
    const timeMax = req.query.end ? new Date(req.query.end).toISOString() : new Date(Date.now() + 62 * DAY).toISOString();

    const conns = await ExternalConnection.findAll({
      where: {
        owner_scope: 'user', user_id: req.user.id, business_id: bizId,
        provider: 'google_calendar', is_active: true,
      },
      limit: 20,   // 한 사람이 붙이는 개인 캘린더는 많아야 몇 개다 — 상한을 둔다
    });
    if (!conns.length) return successResponse(res, { events: [], connections: [] });

    // PlanQ 가 구글에 밀어 넣은 일정 id — 오버레이에서 제외한다 (PlanQ 원본 + 구글 사본 = 이중 표시).
    //   신규 일정은 구글쪽 표식(extendedProperties.planq)으로도 걸러지지만, 표식이 없던 옛 일정은
    //   여기서 넘기는 id 집합으로만 걸러낼 수 있다. 캘린더와 무관하게 건다.
    //   ★ 조회 범위와 **같은 기간**으로 좁힌다(오버레이는 어차피 timeMin~timeMax 만 그린다).
    const pushed = await CalendarEvent.findAll({
      where: {
        business_id: bizId,
        gcal_event_id: { [Op.ne]: null },
        start_at: { [Op.lte]: new Date(timeMax) },
        end_at: { [Op.gte]: new Date(timeMin) },
      },
      attributes: ['gcal_event_id'],
      limit: 2000,
    });
    const excludeIds = new Set(pushed.map((e) => String(e.gcal_event_id)));
    // 개인 연결로 밀어 넣은 링크(캘린더별) — 쓰기 캘린더를 바꾼 뒤 옛 캘린더를 함께 볼 때도 걸러진다.
    const links = await CalendarEventGcalLink.findAll({
      where: { connection_id: conns.map((c) => c.id) }, attributes: ['gcal_event_id'], limit: 5000,
    }).catch(() => []);
    for (const l of links) excludeIds.add(String(l.gcal_event_id));

    // 연결마다 보여 줄 캘린더 — 목록을 못 읽으면 쓰기 캘린더 하나로 내려앉는다(조용히 비지 않게).
    const plans = [];
    for (const conn of conns) {
      let items = null; let listError = null;
      try { items = await personalCalendar.readableCalendars(conn); }
      catch (e) { listError = errCode(e); console.error('[me/calendar/events] list failed conn=' + conn.id, e.code || e.status || ''); }
      plans.push({ conn, canList: personalCalendar.hasCalendarList(conn), listError, calendars: personalCalendar.visibleCalendarsOf(conn, items) });
    }

    const jobs = [];
    const jobMeta = [];
    for (const p of plans) {
      for (const cal of p.calendars) {
        if (!cal.visible) continue;
        jobMeta.push({ plan: p, cal });
        jobs.push(() => personalCalendar.listEvents(p.conn, { timeMin, timeMax, excludeIds, cal, useCache: true }));
      }
    }
    const results = await runPool(jobs, { limit: 4, deadlineAt: Date.now() + 25000 });

    // 같은 일정(iCalUID)이 보이는 캘린더 둘에 있으면 하나만 그린다 — 쓰기 캘린더 > 권한 높은 쪽(Fable 판정 5).
    const RANK = { owner: 3, writer: 2, reader: 1 };
    const byUid = new Map();
    const events = [];
    const calStatus = new Map();   // `${connId}|${calId}` → { ok, error }
    results.forEach((r, i) => {
      const { plan, cal } = jobMeta[i];
      calStatus.set(`${plan.conn.id}|${cal.id}`, r.ok ? { ok: true } : { ok: false, error: errCode(r.error) });
      if (!r.ok) { console.error('[me/calendar/events] fetch failed conn=' + plan.conn.id + ' cal=' + cal.id, errCode(r.error)); return; }
      for (const ev of r.value) {
        const uidKey = ev.ical_uid ? `${plan.conn.id}|${ev.ical_uid}|${ev.start_at}` : null;
        if (!uidKey) { events.push(ev); continue; }
        const prev = byUid.get(uidKey);
        if (!prev) { ev.also_in = []; byUid.set(uidKey, ev); events.push(ev); continue; }
        const score = (e, c) => (c.is_write ? 10 : 0) + (RANK[e.access_role] || 0);
        const prevCal = plan.calendars.find((c) => c.id === prev.calendar_id) || {};
        if (score(ev, cal) > score(prev, prevCal)) {
          const idx = events.indexOf(prev);
          ev.also_in = [...prev.also_in, prev.calendar_id];
          events[idx] = ev; byUid.set(uidKey, ev);
        } else prev.also_in.push(ev.calendar_id);
      }
    });

    const connections = [];
    for (const p of plans) {
      const { conn } = p;
      const calendars = p.calendars.map((c) => ({ ...c, ...(c.visible ? (calStatus.get(`${conn.id}|${c.id}`) || { ok: false, error: 'timeout' }) : {}) }));
      const tried = calendars.filter((c) => c.visible);
      const anyOk = tried.some((c) => c.ok);
      connections.push({
        id: conn.id, account_email: conn.account_email, ok: anyOk, ...calendarLabelOf(conn),
        can_list: p.canList, list_error: p.listError, visible_max: personalCalendar.VISIBLE_MAX, calendars,
        ...(anyOk ? {} : { error: (tried[0] && tried[0].error) || 'failed' }),
      });
      if (anyOk) {
        if (conn.last_sync_error || conn.fail_count) await conn.update({ last_sync_error: null, fail_count: 0, last_sync_at: new Date() }).catch(() => {});
        else await conn.update({ last_sync_at: new Date() }).catch(() => {});
      } else {
        await conn.update({ last_sync_error: (tried[0] && tried[0].error) || 'failed', fail_count: (conn.fail_count || 0) + 1 }).catch(() => {});
      }
    }
    successResponse(res, { events, connections });
  } catch (err) { next(err); }
});

// ─── 개인 캘린더 일정 수정·삭제 (2026-08-19) ────────────────────────────
//
// Irene: "이거 개인캘린더가 내 껀데 왜 내가 읽기전용이야?"
//   쓰기 권한(calendar.events)은 이미 부여돼 있었는데, 서버가 응답에 read_only 를 하드코딩하고
//   화면 문구도 옛 동작(읽기 전용 스코프 시절)을 그대로 서술하고 있었다.
//
// 개인 캘린더는 **사적 공간**이다 — owner·admin 백도어 없이 연결 소유자 본인만 통과한다.
// 반복 일정은 listEvents 가 singleEvents 로 인스턴스를 펼쳐 주므로, 인스턴스 id 에 patch 하면
// 구글이 그 회차의 예외를 만든다 = "이 회차만 수정". 시리즈 전체 수정은 Google 로 보낸다.

/** 본인 소유 + 활성 + 쓰기 권한까지 확인된 연결을 돌려준다. 하나라도 어긋나면 { error }. */
async function loadOwnCalendarConn(req) {
  const bizId = parseInt(req.body?.business_id || req.query?.business_id, 10);
  if (!bizId) return { error: 'business_id_required', status: 400 };
  if (!(await assertBusinessMember(req, bizId))) return { error: 'no_business_access', status: 403 };
  const conn = await ExternalConnection.findOne({
    where: {
      id: parseInt(req.params.connId, 10),
      owner_scope: 'user',
      user_id: req.user.id,          // ★ 사적 공간 경계 — 남의 개인 캘린더에 닿는 경로를 만들지 않는다
      business_id: bizId,
      provider: 'google_calendar',
      is_active: true,
    },
  });
  if (!conn) return { error: 'connection_not_found', status: 404 };
  // 프론트를 믿지 않는다 — 화면이 편집 가능으로 보였더라도 서버가 다시 판정한다.
  if (!personalCalendar.hasCalendarWrite(conn)) return { error: 'no_calendar_write_scope', status: 403 };
  return { conn, bizId };
}

/** 응답 정규화에 실을 캘린더 정보(이름·색·권한) — 목록 캐시에서. 없으면 null(쓰기 캘린더로 본다). */
async function calOf(conn, calendarId) {
  const items = await personalCalendar.readableCalendars(conn).catch(() => null);
  const hit = personalCalendar.visibleCalendarsOf(conn, items).find((c) => c.id === calendarId);
  return hit ? { id: hit.id, summary: hit.summary, color: hit.color, access_role: hit.access_role } : { id: calendarId, access_role: 'writer' };
}

/** 구글이 돌려주는 오류를 사용자가 이해할 수 있는 상태로 옮긴다. */
function mapGoogleError(e) {
  const code = e && (e.code || e.status);
  if (code === 403) return { status: 403, message: 'cannot_edit' };          // 주최자가 아님 등
  if (code === 404 || code === 410) return { status: 404, message: 'event_not_found' };
  return null;
}

router.patch('/me/calendar/events/:connId/:gcalEventId',
  authenticateToken,
  perUserLimiter('personal-cal-write', { windowMs: 60 * 1000, max: 30 }),
  async (req, res, next) => {
    try {
      const { conn, bizId, error, status } = await loadOwnCalendarConn(req);
      if (error) return errorResponse(res, error, status, error);
      // 어느 캘린더의 일정인가 — 화면이 보낸 값을 그대로 믿지 않는다(보이는 캘린더 + owner·writer 만).
      const allowed = await personalCalendar.assertEditableCalendar(conn, req.body?.calendar_id);
      if (!allowed.ok) return errorResponse(res, allowed.error, allowed.status, allowed.error);
      const calendarId = allowed.calendarId;

      const b = req.body || {};
      const patch = {};
      // 입력 캡 — 외부 API 로 나가는 값이라 크기를 제한한다.
      if (b.title !== undefined) patch.title = capText(String(b.title || ''), 1024);
      if (b.description !== undefined) patch.description = b.description ? capText(String(b.description), 8000) : null;
      if (b.location !== undefined) patch.location = b.location ? capText(String(b.location), 1024) : null;
      if (b.start_at !== undefined || b.end_at !== undefined || b.all_day !== undefined) {
        if (!b.start_at) return errorResponse(res, 'start_at_required', 400);
        patch.startAt = b.start_at;
        patch.endAt = b.end_at || b.start_at;
        patch.allDay = !!b.all_day;
        patch.timezone = b.timezone || 'Asia/Seoul';
      }
      if (Object.keys(patch).length === 0) return errorResponse(res, 'nothing_to_update', 400);

      let data;
      try {
        data = await personalCalendar.patchPersonalOriginEvent(conn, req.params.gcalEventId, patch, { etag: b.etag || null, calendarId });
      } catch (e) {
        // 412 = 구글에서 이미 바뀐 일정. 최신본을 실어 돌려주면 화면이 스스로 따라잡는다.
        if (e && (e.code === 412 || e.status === 412)) {
          const fresh = await personalCalendar.getEvent(conn, req.params.gcalEventId, { calendarId }).catch(() => null);
          return res.status(409).json({
            success: false,
            message: 'event_changed_elsewhere',
            data: fresh ? { event: personalCalendar.normalize(fresh, conn, await calOf(conn, calendarId)) } : null,
          });
        }
        const mapped = mapGoogleError(e);
        if (mapped) return errorResponse(res, mapped.message, mapped.status, mapped.message);
        throw e;
      }

      // 감사 로그 — **내용은 남기지 않는다.** 개인 일정 제목·본문이 워크스페이스 감사 화면에
      //   남으면 사적 공간 침해다. 무엇을 바꿨는지(필드명)까지만 기록한다.
      const { AuditLog } = require('../models');
      await writeAudit({
        user_id: req.user.id,
        business_id: bizId,
        action: 'personal_calendar.event_update',
        target_type: 'external_connection',
        target_id: conn.id,
        new_value: { gcal_event_id: req.params.gcalEventId, calendar_id: calendarId, fields: Object.keys(patch) },
      }).catch(() => null);

      // 실시간 — 개인 일정이라 business room 이 아니라 **본인 room** 으로만 보낸다.
      try { req.app.get('io')?.to(`user:${req.user.id}`).emit('personal_calendar:changed'); } catch (_) { /* 알림 실패가 저장을 되돌리지 않는다 */ }

      personalCalendar.invalidateEvents(conn.id);
      return successResponse(res, { event: personalCalendar.normalize(data, conn, await calOf(conn, calendarId)) });
    } catch (err) { next(err); }
  });

router.delete('/me/calendar/events/:connId/:gcalEventId',
  authenticateToken,
  perUserLimiter('personal-cal-write', { windowMs: 60 * 1000, max: 30 }),
  async (req, res, next) => {
    try {
      const { conn, bizId, error, status } = await loadOwnCalendarConn(req);
      if (error) return errorResponse(res, error, status, error);
      const allowed = await personalCalendar.assertEditableCalendar(conn, req.query?.calendar_id || req.body?.calendar_id);
      if (!allowed.ok) return errorResponse(res, allowed.error, allowed.status, allowed.error);
      try {
        // 반복 일정의 인스턴스 id 를 지우면 그 회차만 취소된다 (시리즈 전체는 Google 에서).
        await personalCalendar.deleteEvent(conn, req.params.gcalEventId, { calendarId: allowed.calendarId });
      } catch (e) {
        const mapped = mapGoogleError(e);
        if (mapped) return errorResponse(res, mapped.message, mapped.status, mapped.message);
        throw e;
      }
      const { AuditLog } = require('../models');
      await writeAudit({
        user_id: req.user.id,
        business_id: bizId,
        action: 'personal_calendar.event_delete',
        target_type: 'external_connection',
        target_id: conn.id,
        new_value: { gcal_event_id: req.params.gcalEventId, calendar_id: allowed.calendarId },
      }).catch(() => null);
      personalCalendar.invalidateEvents(conn.id);
      try { req.app.get('io')?.to(`user:${req.user.id}`).emit('personal_calendar:changed'); } catch (_) { /* 위와 같음 */ }
      return successResponse(res, { deleted: true });
    } catch (err) { next(err); }
  });

// ─── 어느 캘린더에 올릴까 (2026-10-07, Fable B 판정 8) ──────────────────────────
//   골라 둔 캘린더 id 는 external_connections.metadata.calendar_id(기본 primary). 본인 연결만.
//   목록은 «일정을 쓸 수 있는» 캘린더뿐(writer·owner) — 읽기만 되는 구독 캘린더에 올리면 구글이 거절한다.
async function ownCalendarConn(req, connId) {
  const conn = await ExternalConnection.findOne({
    where: { id: connId, user_id: req.user.id, owner_scope: 'user', provider: 'google_calendar' },
  });
  return conn;
}

// GET /api/me/calendar/calendars?connection_id=
router.get('/me/calendar/calendars', authenticateToken, async (req, res, next) => {
  try {
    const conn = await ownCalendarConn(req, parseInt(req.query.connection_id, 10));
    if (!conn) return errorResponse(res, 'not_found', 404);
    const selected = personalCalendar.calendarIdOf(conn);
    // 옛 연결(목록 권한 없음) — 고르려면 다시 연결해야 한다. 화면이 그 사실을 말한다.
    if (!personalCalendar.hasCalendarList(conn)) return successResponse(res, { can_list: false, selected, calendars: [] });
    // ?role=reader — 보기/가리기 목록(공휴일·구독 포함, 보이는지 표시). 새로 묻고 캐시를 갈아 둔다.
    if (req.query.role === 'reader') {
      let items;
      try { items = await personalCalendar.readableCalendars(conn, { force: true }); }
      catch (e) { console.warn('[personal calendars list reader] conn=' + conn.id, e.code || e.status || ''); return errorResponse(res, 'gcal_list_failed', 502); }
      return successResponse(res, { can_list: true, selected, visible_max: personalCalendar.VISIBLE_MAX, calendars: personalCalendar.visibleCalendarsOf(conn, items) });
    }
    let calendars = [];
    try { calendars = await personalCalendar.listCalendars(conn); }
    catch (e) {
      console.warn('[personal calendars list]', e.message);
      return errorResponse(res, 'gcal_list_failed', 502);
    }
    return successResponse(res, { can_list: true, selected, calendars });
  } catch (err) { next(err); }
});

// PUT /api/me/calendar/calendar-id  body: { connection_id, calendar_id }
//   새로 올리는 일정부터 그 캘린더로 간다. 이미 올린 일정은 원래 캘린더에서 계속 고치고 지운다(링크의 gcal_calendar_id).
//   역방향 동기화 커서는 비운다 — 새 캘린더를 처음부터 읽는다.
router.put('/me/calendar/calendar-id', authenticateToken, async (req, res, next) => {
  try {
    const conn = await ownCalendarConn(req, parseInt(req.body?.connection_id, 10));
    if (!conn) return errorResponse(res, 'not_found', 404);
    const want = String(req.body?.calendar_id || '').trim();
    if (!want || want.length > 255) return errorResponse(res, 'invalid_calendar_id', 400);
    if (!personalCalendar.hasCalendarList(conn)) return errorResponse(res, 'reconnect_required', 409);
    // 목록에 있는(쓸 수 있는) 캘린더만 — 손으로 넣은 id 를 그대로 믿지 않는다.
    let calendars;
    try { calendars = await personalCalendar.listCalendars(conn); }
    catch (e) { console.warn('[personal calendars set]', e.message); return errorResponse(res, 'gcal_list_failed', 502); }
    const hit = calendars.find((c) => c.id === want);
    if (!hit) return errorResponse(res, 'calendar_not_writable', 400);
    const prev = personalCalendar.calendarIdOf(conn);
    const meta = { ...(typeof conn.metadata === 'object' && conn.metadata ? conn.metadata : {}) };
    meta.calendar_id = hit.primary ? 'primary' : hit.id;
    // 이름도 같이 둔다 — 캘린더 화면이 «지금 어느 캘린더를 보는지» 를 말하는 데 쓴다(목록 권한 없이도). 2026-10-12
    meta.calendar_summary = hit.primary ? null : (hit.summary || null);
    const next = meta.calendar_id;
    if (prev !== next || (conn.metadata?.calendar_summary ?? null) !== meta.calendar_summary) {
      await conn.update({ metadata: meta, gcal_sync_token: null });
      personalCalendar.invalidateEvents(conn.id);
      await writeAudit({ user_id: req.user.id, business_id: conn.business_id ?? null, action: 'external_connection.calendar_select',
        target_type: 'external_connection', target_id: conn.id, old_value: { calendar_id: prev }, new_value: { calendar_id: next } }).catch(() => null);
    }
    return successResponse(res, { selected: next });
  } catch (err) { next(err); }
});

// PUT /api/me/calendar/visible-calendars  body: { connection_id, calendar_ids: string[] }
//   Q calendar 의 구글 캘린더 칩 보기/가리기(2026-10-12, Fable 2단계 판정 3·7). 저장은 서버 한 곳 — 기기가 바뀌어도 같다.
//   목록에 있는 id 만 · 상한 15 · 쓰기 캘린더는 늘 포함(빼고 보내도 다시 넣는다). 감사에는 id 배열만(이름·일정 내용 없음).
//   실시간 방송 없음 — 개인 데이터다.
router.put('/me/calendar/visible-calendars', authenticateToken,
  perUserLimiter('personal-cal-visible', { windowMs: 60 * 1000, max: 30 }),
  async (req, res, next) => {
  try {
    const conn = await ownCalendarConn(req, parseInt(req.body?.connection_id, 10));
    if (!conn || !conn.is_active) return errorResponse(res, 'not_found', 404);
    if (!personalCalendar.hasCalendarList(conn)) return errorResponse(res, 'reconnect_required', 409);
    const raw = req.body?.calendar_ids;
    if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string' || !x || x.length > 255)) return errorResponse(res, 'invalid_calendar_ids', 400);
    const writeId = personalCalendar.calendarIdOf(conn);
    const want = [...new Set([writeId, ...raw.map((x) => x.trim())])];
    if (want.length > personalCalendar.VISIBLE_MAX) return errorResponse(res, 'too_many_calendars', 400);
    let items;
    try {
      items = await personalCalendar.readableCalendars(conn);
      if (want.some((id) => id !== writeId && !items.some((c) => c.id === id))) items = await personalCalendar.readableCalendars(conn, { force: true });
    } catch (e) { console.warn('[personal calendars visible] conn=' + conn.id, e.code || e.status || ''); return errorResponse(res, 'gcal_list_failed', 502); }
    if (want.some((id) => id !== writeId && !items.some((c) => c.id === id))) return errorResponse(res, 'calendar_not_in_list', 400);

    await conn.reload();   // 목록 캐시 저장이 metadata 를 바꿨을 수 있다 — 최신 위에 얹는다
    const meta = { ...(typeof conn.metadata === 'object' && conn.metadata ? conn.metadata : {}) };
    const prev = Array.isArray(meta.visible_calendar_ids) ? meta.visible_calendar_ids : null;
    const same = prev && prev.length === want.length && prev.every((x, i) => x === want[i]);
    if (!same) {
      meta.visible_calendar_ids = want;
      await conn.update({ metadata: meta });
      personalCalendar.invalidateEvents(conn.id);
      await writeAudit({ user_id: req.user.id, business_id: conn.business_id ?? null, action: 'external_connection.visible_calendars_update',
        target_type: 'external_connection', target_id: conn.id, old_value: { calendar_ids: prev }, new_value: { calendar_ids: want } }).catch(() => null);
    }
    return successResponse(res, { calendars: personalCalendar.visibleCalendarsOf(conn, items) });
  } catch (err) { next(err); }
});

module.exports = router;
