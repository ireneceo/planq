// routes/personal_calendar.js — 개인 Google 캘린더 overlay + 일정 수정·삭제
//
// external_connections.js 에서 분리 (god-file 가드: 라우트 500줄). 개인 캘린더는 스코프·권한
// 경계가 다른 독립 도메인이라 파일도 나눈다 — 마운트 prefix 는 그대로 '/api'.
//
// ★ 사적 공간: 모든 라우트가 **연결 소유자 본인**만 통과한다. owner·admin 백도어 없음.
const express = require('express');
const { Op } = require('sequelize');
const router = express.Router();
const { ExternalConnection, BusinessMember, CalendarEvent } = require('../models');
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

// ─── Phase 2 — 개인 Google Calendar overlay ──────────────
// GET /api/me/calendar/events?business_id=&start=&end=
// → 본인 연결된 개인 Google 캘린더 일정 (정규화). Q Calendar 가 violet overlay 로 표시.
router.get('/me/calendar/events', authenticateToken, async (req, res, next) => {
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
    //   여기서 넘기는 id 집합으로만 걸러낼 수 있다.
    //   ★ 조회 범위와 **같은 기간**으로 좁힌다. 여태 워크스페이스의 전체 기간을 통째로 읽어서,
    //     일정이 쌓일수록 이 한 줄이 무거워졌다 (오버레이는 어차피 timeMin~timeMax 만 그린다).
    //     겹침 판정: 시작이 조회 끝보다 앞이고, 끝이 조회 시작보다 뒤인 것.
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

    const events = [];
    const connections = [];
    for (const conn of conns) {
      try {
        const evs = await personalCalendar.listEvents(conn, { timeMin, timeMax, excludeIds });
        events.push(...evs);
        connections.push({ id: conn.id, account_email: conn.account_email, ok: true });
        if (conn.last_sync_error || conn.fail_count) await conn.update({ last_sync_error: null, fail_count: 0, last_sync_at: new Date() });
        else await conn.update({ last_sync_at: new Date() });
      } catch (e) {
        console.error('[me/calendar/events] fetch failed conn=' + conn.id, e.message);
        connections.push({ id: conn.id, account_email: conn.account_email, ok: false, error: e.message });
        await conn.update({ last_sync_error: e.message, fail_count: (conn.fail_count || 0) + 1 }).catch(() => {});
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
        data = await personalCalendar.patchPersonalOriginEvent(conn, req.params.gcalEventId, patch, { etag: b.etag || null });
      } catch (e) {
        // 412 = 구글에서 이미 바뀐 일정. 최신본을 실어 돌려주면 화면이 스스로 따라잡는다.
        if (e && (e.code === 412 || e.status === 412)) {
          const fresh = await personalCalendar.getEvent(conn, req.params.gcalEventId).catch(() => null);
          return res.status(409).json({
            success: false,
            message: 'event_changed_elsewhere',
            data: fresh ? { event: personalCalendar.normalize(fresh, conn) } : null,
          });
        }
        const mapped = mapGoogleError(e);
        if (mapped) return errorResponse(res, mapped.message, mapped.status, mapped.message);
        throw e;
      }

      // 감사 로그 — **내용은 남기지 않는다.** 개인 일정 제목·본문이 워크스페이스 감사 화면에
      //   남으면 사적 공간 침해다. 무엇을 바꿨는지(필드명)까지만 기록한다.
      const { AuditLog } = require('../models');
      await AuditLog.create({
        user_id: req.user.id,
        business_id: bizId,
        action: 'personal_calendar.event_update',
        target_type: 'external_connection',
        target_id: conn.id,
        new_value: { gcal_event_id: req.params.gcalEventId, fields: Object.keys(patch) },
      }).catch(() => null);

      // 실시간 — 개인 일정이라 business room 이 아니라 **본인 room** 으로만 보낸다.
      try { req.app.get('io')?.to(`user:${req.user.id}`).emit('personal_calendar:changed'); } catch (_) { /* 알림 실패가 저장을 되돌리지 않는다 */ }

      return successResponse(res, { event: personalCalendar.normalize(data, conn) });
    } catch (err) { next(err); }
  });

router.delete('/me/calendar/events/:connId/:gcalEventId',
  authenticateToken,
  perUserLimiter('personal-cal-write', { windowMs: 60 * 1000, max: 30 }),
  async (req, res, next) => {
    try {
      const { conn, bizId, error, status } = await loadOwnCalendarConn(req);
      if (error) return errorResponse(res, error, status, error);
      try {
        // 반복 일정의 인스턴스 id 를 지우면 그 회차만 취소된다 (시리즈 전체는 Google 에서).
        await personalCalendar.deleteEvent(conn, req.params.gcalEventId);
      } catch (e) {
        const mapped = mapGoogleError(e);
        if (mapped) return errorResponse(res, mapped.message, mapped.status, mapped.message);
        throw e;
      }
      const { AuditLog } = require('../models');
      await AuditLog.create({
        user_id: req.user.id,
        business_id: bizId,
        action: 'personal_calendar.event_delete',
        target_type: 'external_connection',
        target_id: conn.id,
        new_value: { gcal_event_id: req.params.gcalEventId },
      }).catch(() => null);
      try { req.app.get('io')?.to(`user:${req.user.id}`).emit('personal_calendar:changed'); } catch (_) { /* 위와 같음 */ }
      return successResponse(res, { deleted: true });
    } catch (err) { next(err); }
  });

module.exports = router;
