const express = require('express');
const { Op } = require('sequelize');
const router = express.Router();
const { sequelize } = require('../config/database');
const {
  CalendarEvent, CalendarEventAttendee, CalendarEventGcalLink,
  BusinessMember, User, Client, Project, ProjectMember,
} = require('../models');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { applyMemberDisplayName, applyMemberDisplayNameOne } = require('../services/displayName');

// 워크스페이스 표시명 우선 적용 — N+39-7. event.creator + attendees[].user 양쪽.
async function applyEventDisplayNames(items, businessId) {
  if (!businessId) return items;
  const list = Array.isArray(items) ? items : [items];
  await applyMemberDisplayName(list, businessId, ['creator']);
  // attendees[].user 평면화 후 처리
  const attendeeUsers = [];
  for (const e of list) {
    if (Array.isArray(e?.attendees)) {
      for (const a of e.attendees) if (a?.user) attendeeUsers.push(a);
    }
  }
  if (attendeeUsers.length) await applyMemberDisplayName(attendeeUsers, businessId, ['user']);
  return items;
}

// N+38 — 실시간 동기화 (CLAUDE.md 운영 안정성 16번 박제).
function broadcastEvent(req, event, eventName = 'event:updated') {
  const io = req.app.get('io');
  if (!io) return;
  const data = event.toJSON ? event.toJSON() : event;
  if (event.business_id) io.to(`business:${event.business_id}`).emit(eventName, data);
}

const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { attachWorkspaceScope, isMemberOrAbove, getUserScope, calendarListWhere } = require('../middleware/access_scope');
const { createAuditLog } = require('../middleware/audit');
const { RRule, rrulestr } = require('rrule');
// 사이클 N+13: Daily.co 완전 교체 → Google Calendar API (Meet 자동 생성)
const gcal = require('../services/google_calendar');
const calendarSync = require('../services/calendarSync');
const crypto = require('crypto');
const { Business } = require('../models');
const { createEvent } = require('../services/actions/event_actions');

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const CATEGORY_SET = new Set(['personal', 'work', 'meeting', 'deadline', 'other']);
// google_meet = Google Calendar API 로 자동 발급
// manual      = 사용자가 직접 회의실 URL 입력
const PROVIDER_SET = new Set(['google_meet', 'manual']);
const VISIBILITY_SET = new Set(['personal', 'business']);
const RESPONSE_SET = new Set(['pending', 'accepted', 'declined', 'tentative']);

// ============================================
// 공통: 워크스페이스 멤버 확인
// ============================================
async function requireMember(userId, businessId) {
  if (!userId || !businessId) return null;
  return BusinessMember.findOne({ where: { user_id: userId, business_id: businessId } });
}

// 공통 include
const INCLUDE_DETAIL = [
  { model: User, as: 'creator', attributes: ['id', 'name', 'email', 'name_localized'] },
  { model: Project, attributes: ['id', 'name', 'color'], required: false },
  {
    model: CalendarEventAttendee,
    as: 'attendees',
    include: [
      { model: User, as: 'user', attributes: ['id', 'name', 'email', 'name_localized'] },
      { model: Client, as: 'client', attributes: ['id', 'display_name', 'company_name'] },
    ],
  },
];

// 날짜 파싱 (ISO8601) — 유효하지 않으면 null
function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

// ============================================
// GET /by-business/:businessId — 범위 조회
// query: start, end, project_id?, scope=all|mine (default all)
// ============================================
router.get('/by-business/:businessId', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const start = parseDate(req.query.start);
    const end = parseDate(req.query.end);
    if (!start || !end) return errorResponse(res, 'start and end are required (ISO8601)', 400);
    if (end < start) return errorResponse(res, 'end must be after start', 400);
    // 비용폭탄 L3 — 조회 기간 폭 캡(최대 400일). RRULE 반복 이벤트 무제한 확장으로 인한 메모리·CPU 폭발 방지.
    if (end - start > 400 * 24 * 60 * 60 * 1000) return errorResponse(res, 'range_too_wide (max 400 days)', 400);

    // 비반복 이벤트: 일반 overlap. 반복 이벤트: DTSTART <= rangeEnd 만 필터하고 RRULE 로 확장.
    const baseWhere = {
      business_id: businessId,
      [Op.or]: [
        // 비반복: 범위 겹침
        {
          rrule: null,
          start_at: { [Op.lt]: end },
          end_at: { [Op.gt]: start },
        },
        // 반복: 시작이 범위 끝 이전
        {
          rrule: { [Op.ne]: null },
          start_at: { [Op.lt]: end },
        },
      ],
    };
    if (req.query.project_id) baseWhere.project_id = Number(req.query.project_id);

    // N+67 — 권한 query refactor. vlevel 우선 + legacy visibility fallback.
    // 규칙 본체는 access_scope.calendarListWhere 로 추출 (사람 라우트와 Cue 컨텍스트가 같은 규칙을 쓰도록).
    //   client — 본인이 attendee 인 business event 만 / owner·admin — 전체 / member — 본인·L2·L3·L4
    const visWhere = await calendarListWhere(req.user.id, businessId, req.scope);
    if (!visWhere) return successResponse(res, []);   // 볼 수 있는 일정 없음 (attendee 0 인 client)
    const { business_id: _bid, [Op.and]: visAnd, ...visRest } = visWhere;
    Object.assign(baseWhere, visRest);
    if (visAnd) baseWhere[Op.and] = visAnd;

    const rawEvents = await CalendarEvent.findAll({
      where: baseWhere,
      include: INCLUDE_DETAIL,
      order: [['start_at', 'ASC']],
    });

    // RRULE expansion — 반복 이벤트를 개별 instance 로 분해.
    // N+63 P2a — exception_dates 의 회차는 skip (EXDATE), exception child 는 별도 fetch 해서
    //   같은 recurrence_id (회차 date) 의 master instance 자리에 child 가 대체.
    // 1단계: master rawEvents 분류 + exception child 별도 fetch
    const masterIds = rawEvents.filter(e => e.rrule).map(e => e.id);
    const exceptionChildren = masterIds.length > 0
      ? await CalendarEvent.findAll({
          where: {
            recurrence_parent_id: { [Op.in]: masterIds },
            // 범위 overlap
            start_at: { [Op.lt]: end },
            end_at: { [Op.gt]: start },
          },
          include: INCLUDE_DETAIL,
        })
      : [];
    // recurrence_id (YYYY-MM-DD) 별로 exception child 인덱싱
    const exceptionByParentDate = new Map();
    for (const child of exceptionChildren) {
      const key = `${child.recurrence_parent_id}_${child.recurrence_id}`;
      exceptionByParentDate.set(key, child.toJSON());
    }

    let events = [];
    for (const e of rawEvents) {
      const json = e.toJSON();
      // child (exception) 는 master expansion 안에서 대체 — 단독으로 push 하지 않음 (중복 방지)
      if (json.recurrence_parent_id) continue;
      if (!json.rrule) {
        events.push(json);
        continue;
      }
      try {
        const dur = new Date(json.end_at).getTime() - new Date(json.start_at).getTime();
        const ruleSrc = json.rrule.startsWith('RRULE:') || json.rrule.startsWith('DTSTART')
          ? json.rrule
          : `RRULE:${json.rrule}`;
        const rule = rrulestr(ruleSrc, { dtstart: new Date(json.start_at) });
        const instances = rule instanceof RRule
          ? rule.between(start, end, true)
          : rule.between(start, end, true);
        // exception_dates set (YYYY-MM-DD) — EXDATE 처리
        const exDates = new Set((Array.isArray(json.exception_dates) ? json.exception_dates : []).map(d => String(d).slice(0, 10)));
        for (const inst of instances) {
          const instDate = inst.toISOString().slice(0, 10);
          // EXDATE 의 회차 = master 에서 skip
          if (exDates.has(instDate)) {
            // child 가 대체 있는지
            const child = exceptionByParentDate.get(`${json.id}_${instDate}`);
            if (child) events.push({ ...child, _is_exception: true, _parent_event_id: json.id });
            continue;
          }
          events.push({
            ...json,
            start_at: inst.toISOString(),
            end_at: new Date(inst.getTime() + dur).toISOString(),
            _instance_key: `${json.id}_${instDate}`,
            _parent_event_id: json.id,
          });
        }
      } catch (err) {
        console.error('rrule expansion failed', json.id, err.message);
        events.push(json);
      }
    }
    // exception child 가 master 범위 밖이라 위 loop 에서 안 잡힌 경우 별도 push
    for (const child of exceptionChildren) {
      const cjson = child.toJSON();
      const cdate = String(cjson.recurrence_id).slice(0, 10);
      const alreadyAdded = events.some(e => e._is_exception && e.id === cjson.id);
      if (!alreadyAdded) events.push({ ...cjson, _is_exception: true, _parent_event_id: cjson.recurrence_parent_id });
    }

    // scope=mine — 내가 만들었거나 attendee 인 것만
    if (req.query.scope === 'mine') {
      events = events.filter((e) => {
        if (e.created_by === req.user.id) return true;
        return (e.attendees || []).some((a) => a.user_id === req.user.id);
      });
    }

    events.sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
    await applyEventDisplayNames(events, businessId);
    return successResponse(res, events);
  } catch (err) { next(err); }
});

// ============================================
// POST /by-business/:businessId — 생성
// body: { title, description?, location?, start_at, end_at, all_day?, category?,
//         color?, rrule?, meeting_url?, meeting_provider?, visibility?, project_id?,
//         attendees?: [{ user_id? | client_id? }] }
// ============================================
router.post('/by-business/:businessId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  // 얇은 라우트 — 파싱 + actor 구성 + 행동 계층 호출 + 응답. 생성 규칙은 services/actions/event_actions.js.
  try {
    const businessId = Number(req.params.businessId);
    const b = req.body || {};
    const r = await createEvent(
      { kind: 'user', userId: req.user.id, platformRole: req.user.platform_role, req },
      {
        businessId,
        title: b.title, description: b.description, location: b.location,
        startAt: b.start_at, endAt: b.end_at, allDay: b.all_day,
        category: b.category, color: b.color, rrule: b.rrule,
        meetingUrl: b.meeting_url, meetingProvider: b.meeting_provider,
        autoCreateMeeting: b.auto_create_meeting,
        visibility: b.visibility, projectId: b.project_id,
        attendees: b.attendees || [],
        reminderMinutes: b.reminder_minutes,
        vlevel: b.vlevel, gcalSyncWorkspace: b.gcal_sync_workspace, gcalSyncPersonal: b.gcal_sync_personal, targetMemberIds: b.target_member_ids, targetClientIds: b.target_client_ids,
      }
    );
    if (!r.ok) return errorResponse(res, r.code, r.http || 400);
    // #242 — Meet 링크만 실패한 경우에도 일정 생성은 성공(201)이다. 실패 사실은 삼키지 않고
    //   meet_warning 코드로 실어 보내 프론트가 "일정은 저장됐지만 링크 실패" 를 알린다.
    const created = r.data.full.toJSON();
    if (r.data.meetWarning) created.meet_warning = r.data.meetWarning;
    return successResponse(res, created, 'created', 201);
  } catch (err) { next(err); }
});

// ============================================
// GET /by-business/:businessId/:id — 상세
// ============================================
router.get('/by-business/:businessId/:id', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);

    const event = await CalendarEvent.findOne({
      where: { id: req.params.id, business_id: businessId },
      include: INCLUDE_DETAIL,
    });
    if (!event) return errorResponse(res, 'event_not_found', 404);

    // vlevel 기반 접근검사 — 목록 라우트(N+67)와 동일 규칙 적용.
    //   (이전엔 visibility==='personal' 만 검사 → L2(프로젝트/지정멤버 한정) 이벤트를 id 만 알면
    //    아무 멤버나 단일 GET 으로 조회 가능하던 라이브 누출. Fable #104 인접 발견.)
    //   member: L1(본인) / L2(참여 프로젝트 OR target_member_ids) / L3·L4(멤버) / legacy(visibility)
    const isEventAdmin = req.businessRole === 'owner' || req.businessRole === 'admin' || req.user?.platform_role === 'platform_admin';
    if (!isEventAdmin && !req.scope?.isClient) {
      const uid = parseInt(req.user.id, 10);
      let allowed = false;
      if (event.created_by === uid) allowed = true;                       // 본인 생성은 무조건
      else if (event.vlevel === 'L3' || event.vlevel === 'L4') allowed = true;
      else if (event.vlevel === 'L2') {
        const inProject = event.project_id
          ? !!(await ProjectMember.findOne({ where: { user_id: uid, project_id: event.project_id }, attributes: ['id'] }))
          : false;
        const targets = Array.isArray(event.target_member_ids) ? event.target_member_ids.map(Number) : [];
        if (inProject || targets.includes(uid)) allowed = true;
      } else if (!event.vlevel) {                                          // legacy (vlevel 미마이그레이션)
        if (event.visibility === 'business') allowed = true;
        else if (event.visibility === 'personal' && event.created_by === uid) allowed = true;
      }
      // vlevel==='L1' 은 위 created_by 검사에서만 통과 (본인 아니면 차단)
      if (!allowed) return errorResponse(res, 'forbidden', 403);
    }

    // Client: attendee 인 event 만
    if (req.scope?.isClient) {
      const att = await CalendarEventAttendee.findOne({
        where: { event_id: event.id, user_id: req.user.id },
        attributes: ['id'],
      });
      if (!att) return errorResponse(res, 'forbidden', 403);
    }

    return successResponse(res, event.toJSON());
  } catch (err) { next(err); }
});

// N+63 P2a — 정기일정 scope 변경 (single|future). RFC 5545 exception pattern.
// 호출 시점: PUT 라우트 안에서 master event + scope ∈ {single, future} 일 때.
// single: master.exception_dates += [recurrence_id] + 새 child event 생성
// future: master.rrule += UNTIL=recurrence_id-1 + 새 master event 생성 (새 rrule + 새 start_at)
async function handleRecurrenceScopeUpdate({ req, res, event, scope, businessId }) {
  const t = await sequelize.transaction();
  try {
    const body = req.body || {};
    const targetDateStr = String(body.recurrence_id || body.from_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDateStr)) {
      await t.rollback();
      return errorResponse(res, 'recurrence_id (YYYY-MM-DD) required for scope=single|future', 400);
    }
    const targetDate = new Date(`${targetDateStr}T00:00:00Z`);

    // 변경된 instance 의 새 start/end — body 우선, 없으면 master 의 시간 사용
    //   (target date 의 시각만 변경, 시간 부분은 master 의 시간 그대로 또는 body 명시값)
    const masterStart = new Date(event.start_at);
    const masterDur = new Date(event.end_at).getTime() - masterStart.getTime();
    let newStart;
    if (body.start_at) {
      newStart = parseDate(body.start_at);
      if (!newStart) { await t.rollback(); return errorResponse(res, 'invalid start_at', 400); }
    } else {
      // master 의 시각 (시:분) + target 의 날짜
      newStart = new Date(targetDate);
      newStart.setUTCHours(masterStart.getUTCHours(), masterStart.getUTCMinutes(), 0, 0);
    }
    let newEnd;
    if (body.end_at) {
      newEnd = parseDate(body.end_at);
      if (!newEnd) { await t.rollback(); return errorResponse(res, 'invalid end_at', 400); }
    } else {
      newEnd = new Date(newStart.getTime() + masterDur);
    }

    if (scope === 'single') {
      // 1. master.exception_dates 에 targetDateStr 추가 (set)
      const existing = Array.isArray(event.exception_dates) ? event.exception_dates : [];
      const exSet = new Set(existing.map(d => String(d).slice(0, 10)));
      exSet.add(targetDateStr);
      await event.update({ exception_dates: Array.from(exSet).sort() }, { transaction: t });

      // 2. 새 child event (rrule 없는 exception)
      const child = await CalendarEvent.create({
        business_id: event.business_id,
        project_id: body.project_id !== undefined ? body.project_id : event.project_id,
        title: (body.title?.trim()) || event.title,
        description: body.description !== undefined ? (body.description?.trim() || null) : event.description,
        location: body.location !== undefined ? (body.location?.trim() || null) : event.location,
        start_at: newStart,
        end_at: newEnd,
        all_day: body.all_day !== undefined ? !!body.all_day : event.all_day,
        category: body.category && CATEGORY_SET.has(body.category) ? body.category : event.category,
        color: body.color && HEX_RE.test(body.color) ? body.color : event.color,
        rrule: null,  // child = single exception. rrule 없음
        meeting_url: event.meeting_url,
        meeting_provider: event.meeting_provider,
        visibility: event.visibility,
        // #104 후속 — vlevel·대상 제한을 복사해야 함. 누락 시 hook 이 visibility('business')→vlevel='L3' 로
        //   재추론하여 L2(팀 비공개)·L4(외부 제한) 회차가 워크스페이스 전체(L3)로 확대됨.
        vlevel: event.vlevel,
        target_member_ids: event.target_member_ids,
        target_client_ids: event.target_client_ids,
        created_by: req.user.id,
        recurrence_parent_id: event.id,
        recurrence_id: targetDateStr,
        reminder_minutes: event.reminder_minutes,
      }, { transaction: t });

      // 3. attendees 복사 (master 의 attendees)
      const masterAttendees = await CalendarEventAttendee.findAll({ where: { event_id: event.id } });
      if (masterAttendees.length > 0) {
        await CalendarEventAttendee.bulkCreate(
          masterAttendees.map(a => ({ event_id: child.id, user_id: a.user_id, client_id: a.client_id, response: 'pending' })),
          { transaction: t }
        );
      }

      await t.commit();
      await createAuditLog({
        user_id: req.user.id, business_id: businessId,
        action: 'event.recurrence_exception',
        target_type: 'calendar_event', target_id: event.id,
        new_value: { recurrence_id: targetDateStr, child_id: child.id },
        ip_address: req.ip,
      });
      const full = await CalendarEvent.findByPk(child.id, { include: INCLUDE_DETAIL });
      broadcastEvent(req, full, 'event:updated');
      return successResponse(res, full.toJSON());
    }

    // scope === 'future'
    // 1. master.rrule 에 UNTIL=targetDate-1 추가 (target 직전 날까지만 유효)
    const dayBefore = new Date(targetDate.getTime() - 24 * 60 * 60 * 1000);
    const untilStr = formatRRuleUntil(dayBefore);
    const ruleSrc = event.rrule.startsWith('RRULE:') ? event.rrule : `RRULE:${event.rrule}`;
    const oldRule = rrulestr(ruleSrc, { dtstart: new Date(event.start_at) });
    const oldOpts = oldRule instanceof RRule ? oldRule.options : oldRule.rrules()[0].options;
    const newOldRule = new RRule({ ...oldOpts, until: dayBefore, count: null });
    await event.update({ rrule: newOldRule.toString().replace(/^DTSTART[^\n]*\n/, '') }, { transaction: t });

    // 2. 새 master event 생성 (새 start = targetDate + 시각, 같은 rrule pattern but 새 DTSTART)
    //    body 의 rrule 명시되면 그것 사용, 없으면 옛 rrule 의 FREQ 등 유지 (UNTIL 제거)
    const newMasterRule = body.rrule || event.rrule.replace(/;?UNTIL=[^;]+/i, '').replace(/;?COUNT=[^;]+/i, '');
    const newMaster = await CalendarEvent.create({
      business_id: event.business_id,
      project_id: body.project_id !== undefined ? body.project_id : event.project_id,
      title: (body.title?.trim()) || event.title,
      description: body.description !== undefined ? (body.description?.trim() || null) : event.description,
      location: body.location !== undefined ? (body.location?.trim() || null) : event.location,
      start_at: newStart,
      end_at: newEnd,
      all_day: body.all_day !== undefined ? !!body.all_day : event.all_day,
      category: body.category && CATEGORY_SET.has(body.category) ? body.category : event.category,
      color: body.color && HEX_RE.test(body.color) ? body.color : event.color,
      rrule: newMasterRule,
      meeting_url: event.meeting_url,
      meeting_provider: event.meeting_provider,
      visibility: event.visibility,
      // #104 후속 — vlevel·대상 제한 복사 (누락 시 L2/L4 → L3 확대). child exception 과 동일.
      vlevel: event.vlevel,
      target_member_ids: event.target_member_ids,
      target_client_ids: event.target_client_ids,
      created_by: req.user.id,
      reminder_minutes: event.reminder_minutes,
    }, { transaction: t });

    const masterAttendees2 = await CalendarEventAttendee.findAll({ where: { event_id: event.id } });
    if (masterAttendees2.length > 0) {
      await CalendarEventAttendee.bulkCreate(
        masterAttendees2.map(a => ({ event_id: newMaster.id, user_id: a.user_id, client_id: a.client_id, response: 'pending' })),
        { transaction: t }
      );
    }

    await t.commit();
    await createAuditLog({
      user_id: req.user.id, business_id: businessId,
      action: 'event.recurrence_split',
      target_type: 'calendar_event', target_id: event.id,
      new_value: { from_date: targetDateStr, new_master_id: newMaster.id, old_rrule_until: untilStr },
      ip_address: req.ip,
    });
    const full = await CalendarEvent.findByPk(newMaster.id, { include: INCLUDE_DETAIL });
    broadcastEvent(req, full, 'event:updated');
    return successResponse(res, full.toJSON());
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('[recurrence scope]', err);
    return errorResponse(res, 'recurrence_scope_failed: ' + err.message, 500);
  }
}

function formatRRuleUntil(d) {
  // RRULE 표준 UNTIL = YYYYMMDDTHHmmssZ (UTC)
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}${m}${day}T${hh}${mm}${ss}Z`;
}

// ============================================
// PUT /by-business/:businessId/:id — 수정
// attendees 배열이 오면 전체 교체
// ============================================
router.put('/by-business/:businessId/:id', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
  const t = await sequelize.transaction();
  try {
    const businessId = Number(req.params.businessId);
    const bm = await requireMember(req.user.id, businessId);
    if (!bm || bm.role === 'ai') { await t.rollback(); return errorResponse(res, 'forbidden', 403); }

    const event = await CalendarEvent.findOne({ where: { id: req.params.id, business_id: businessId } });
    if (!event) { await t.rollback(); return errorResponse(res, 'event_not_found', 404); }

    // 편집 권한: 작성자 또는 owner/admin (N+67 — admin 도 편집 허용. PERMISSION_MATRIX 정합)
    if (event.created_by !== req.user.id && bm.role !== 'owner' && bm.role !== 'admin') {
      await t.rollback();
      return errorResponse(res, 'only_creator_or_owner', 403);
    }

    // N+63 P2a — 정기일정 scope 분기 (single|future|all). default=all (기존 동작).
    //   single: master 의 exception_dates 에 recurrence_id 추가 + 새 child event 생성 (변경된 attr)
    //   future: master rrule 에 UNTIL=recurrence_id-1 추가 + 새 master event 생성 (새 rrule, 새 start_at)
    //   all   : 기존 PUT 그대로 — master 만 변경 (모든 회차 영향)
    // master event (rrule != null) 가 아니거나 scope=all 이면 기존 흐름 그대로.
    const scope = String(req.query.scope || 'all').toLowerCase();
    const isMaster = !!event.rrule && !event.recurrence_parent_id;
    if (isMaster && (scope === 'single' || scope === 'future')) {
      await t.rollback();
      return await handleRecurrenceScopeUpdate({ req, res, event, scope, businessId });
    }

    const {
      title, description, location,
      start_at, end_at, all_day,
      category, color, rrule,
      meeting_url, meeting_provider,
      visibility, project_id,
      attendees,
      reminder_minutes,  // N+63 — 변경 시 reminder_sent_at 도 리셋 (다시 보낼 수 있게)
    } = req.body || {};

    const updates = {};
    if (title !== undefined) {
      if (!title.trim()) { await t.rollback(); return errorResponse(res, 'title cannot be empty', 400); }
      updates.title = title.trim();
    }
    if (description !== undefined) updates.description = description?.trim() || null;
    if (location !== undefined) updates.location = location?.trim() || null;

    const sd = start_at !== undefined ? parseDate(start_at) : event.start_at;
    const ed = end_at !== undefined ? parseDate(end_at) : event.end_at;
    if (start_at !== undefined && !sd) { await t.rollback(); return errorResponse(res, 'invalid start_at', 400); }
    if (end_at !== undefined && !ed) { await t.rollback(); return errorResponse(res, 'invalid end_at', 400); }
    if (ed < sd) { await t.rollback(); return errorResponse(res, 'end_at must be after start_at', 400); }
    if (start_at !== undefined) updates.start_at = sd;
    if (end_at !== undefined) updates.end_at = ed;

    if (all_day !== undefined) updates.all_day = !!all_day;
    if (category !== undefined) {
      if (!CATEGORY_SET.has(category)) { await t.rollback(); return errorResponse(res, 'invalid category', 400); }
      updates.category = category;
    }
    if (color !== undefined) updates.color = (color && HEX_RE.test(color)) ? color : null;
    if (rrule !== undefined) updates.rrule = rrule?.trim() || null;
    if (meeting_url !== undefined) updates.meeting_url = meeting_url?.trim() || null;
    if (meeting_provider !== undefined) {
      updates.meeting_provider = PROVIDER_SET.has(meeting_provider) ? meeting_provider : null;
    }
    if (visibility !== undefined) {
      if (!VISIBILITY_SET.has(visibility)) { await t.rollback(); return errorResponse(res, 'invalid visibility', 400); }
      updates.visibility = visibility;
    }
    // 일정 단위 "구글 캘린더에 올리기" — 팀/개인 각각. 끄면 reconcile 이 그 목적지에서 회수한다.
    if (req.body.gcal_sync_workspace !== undefined) updates.gcal_sync_workspace = !!req.body.gcal_sync_workspace;
    if (req.body.gcal_sync_personal !== undefined) updates.gcal_sync_personal = !!req.body.gcal_sync_personal;
    // N+65 — vlevel 통합 visibility (등록 모달과 정합). hook 가 visibility 도 자동 동기.
    if (req.body.vlevel !== undefined) {
      if (req.body.vlevel === null) updates.vlevel = null;
      else if (['L1','L2','L3','L4'].includes(req.body.vlevel)) updates.vlevel = req.body.vlevel;
    }
    if (req.body.target_member_ids !== undefined) {
      updates.target_member_ids = Array.isArray(req.body.target_member_ids)
        ? req.body.target_member_ids.map(Number).filter(Boolean) : null;
    }
    if (req.body.target_client_ids !== undefined) {
      updates.target_client_ids = Array.isArray(req.body.target_client_ids)
        ? req.body.target_client_ids.map(Number).filter(Boolean) : null;
    }
    // #104 — 개인(L1)·팀 비공개(L2)로 전환되면 기존 공개 링크 즉시 회수 (누출 차단, posts security_level 패턴).
    //   effective vlevel 은 모델 hook 규칙과 동일하게 계산 (vlevel 우선; 없으면 visibility 로 추론).
    //   → visibility='personal' 만 왔지만 event.vlevel 이 이미 L3 이면 hook 이 되돌리므로 회수하지 않음(오회수 방지).
    {
      const effVlevel = updates.vlevel !== undefined ? updates.vlevel
        : (event.vlevel != null ? event.vlevel
          : (updates.visibility !== undefined
            ? (updates.visibility === 'personal' ? 'L1' : 'L3')
            : (event.visibility === 'personal' ? 'L1' : 'L3')));
      const becomingRestricted = effVlevel === 'L1' || effVlevel === 'L2';
      if (becomingRestricted && event.share_token) {
        updates.share_token = null;
        updates.shared_at = null;
        updates.share_password_hash = null;
        updates.share_expires_at = null;
      }
    }
    if (project_id !== undefined) {
      if (project_id === null) {
        updates.project_id = null;
      } else {
        const prj = await Project.findOne({ where: { id: project_id, business_id: businessId } });
        if (!prj) { await t.rollback(); return errorResponse(res, 'invalid_project', 400); }
        updates.project_id = prj.id;
      }
    }
    // N+63 — 알림 minutes 변경. 값 바뀌면 reminder_sent_at 리셋 (재발송 가능).
    // start_at 변경되면 cron 이 새 start_at 기준으로 재계산 + sent_at 리셋 필요.
    if (reminder_minutes !== undefined) {
      const v = Number.isFinite(Number(reminder_minutes)) && Number(reminder_minutes) > 0
        ? Math.min(10080, Number(reminder_minutes))
        : null;
      updates.reminder_minutes = v;
      updates.reminder_sent_at = null;
    } else if (start_at !== undefined) {
      // 시간 변경 시 sent_at 리셋 — 새 시간 기준으로 다시 발송 가능
      updates.reminder_sent_at = null;
    }

    const oldValue = {
      title: event.title, start_at: event.start_at, end_at: event.end_at,
      visibility: event.visibility, project_id: event.project_id,
    };

    await event.update(updates, { transaction: t });

    // (N+63 의 gcal 단방향 sync 판단 변수는 제거됐다 — 계산만 하고 아무도 안 쓰는 죽은 코드였고,
    //  실제 PlanQ → Google 반영은 아래 커밋 후의 calendarSync.reconcile 이 목적지·권한까지 보고 처리한다.)

    // attendees 교체
    let priorAttendeeIds = new Set(); // 수정 전 멤버 참석자 — 신규 추가분만 초대 알림 보내려 캡처
    if (Array.isArray(attendees)) {
      priorAttendeeIds = new Set(
        (await CalendarEventAttendee.findAll({ where: { event_id: event.id }, attributes: ['user_id'], transaction: t }))
          .map((x) => x.user_id).filter(Boolean)
      );
      await CalendarEventAttendee.destroy({ where: { event_id: event.id }, transaction: t });

      const validUserIds = new Set(
        (await BusinessMember.findAll({
          where: { business_id: businessId, user_id: attendees.map((a) => a.user_id).filter(Boolean) },
        })).map((x) => x.user_id)
      );
      const validClientIds = new Set(
        (await Client.findAll({
          where: { business_id: businessId, id: attendees.map((a) => a.client_id).filter(Boolean) },
        })).map((x) => x.id)
      );

      const rows = [];
      const seen = new Set();
      for (const a of attendees) {
        const key = `${a.user_id || ''}:${a.client_id || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (a.user_id && validUserIds.has(a.user_id)) {
          rows.push({ event_id: event.id, user_id: a.user_id, response: a.response && RESPONSE_SET.has(a.response) ? a.response : 'pending' });
        } else if (a.client_id && validClientIds.has(a.client_id)) {
          rows.push({ event_id: event.id, client_id: a.client_id, response: 'pending' });
        }
      }
      if (rows.length) await CalendarEventAttendee.bulkCreate(rows, { transaction: t });
    }

    await t.commit();

    await createAuditLog({
      user_id: req.user.id,
      business_id: businessId,
      action: 'event.updated',
      target_type: 'calendar_event',
      target_id: event.id,
      old_value: oldValue,
      new_value: updates,
      ip_address: req.ip,
    });

    // Google Calendar sync (best-effort, transaction 밖 — Google 이 느려도 DB 락을 잡지 않는다).
    //   목적지·토글·권한·회수는 전부 services/calendarSync.reconcile 이 판단한다.
    //   비공개로 전환된 일정이 팀 캘린더에서 **삭제**되는 것(#126 유출 차단)도 reconcile 의 회수 경로가
    //   담당한다 — 목적지 목록에서 빠지면 구글에서 지우고 링크를 끊는다.
    //   목적지별 체크(gcal_sync_workspace/personal)를 끈 경우도 같은 경로로 구글에서 사라진다.
    try {
      const r = await calendarSync.reconcile(event, { businessId, userId: req.user.id });
      if (r.errors.length) console.warn('[calendarSync PUT]', JSON.stringify(r.errors).slice(0, 300));
    } catch (e) {
      console.warn('[calendarSync PUT] reconcile 실패:', e.message);
    }

    const full = await CalendarEvent.findByPk(event.id, { include: INCLUDE_DETAIL });

    // 일정 수정 — 새로 추가된 멤버 참석자에게 초대 알림 (생성 시 초대 알림과 동일 정책).
    //  기존 참석자(priorAttendeeIds)·본인은 제외 → 리스케줄 noise 없이 신규 초대만.
    try {
      if (Array.isArray(attendees)) {
        const newMemberIds = (full.attendees || [])
          .filter((a) => a.user_id && a.user_id !== req.user.id && !priorAttendeeIds.has(a.user_id))
          .map((a) => a.user_id);
        if (newMemberIds.length > 0) {
          const { notifyMany } = require('./notifications');
          const Business = require('../models').Business;
          const biz = await Business.findByPk(businessId, { attributes: ['name', 'brand_name'] });
          const wsName = biz?.brand_name || biz?.name || null;
          const startStr = event.start_at ? new Date(event.start_at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '';
          notifyMany({
            userIds: newMemberIds, businessId, eventKind: 'event',
            title: '일정 초대', body: `"${event.title}"${startStr ? ` · ${startStr}` : ''}`,
            link: `${process.env.APP_URL || 'https://dev.planq.kr'}/calendar?event=${event.id}`,
            ctaLabel: '일정 보기', workspaceName: wsName,
            actorUserId: req.user.id, entityType: 'calendar_event', entityId: event.id, ioApp: req.app,
          }).catch((e) => console.warn('[notify event invite-edit]', e.message));
        }
      }
    } catch (e) { console.warn('[notify event invite-edit outer]', e.message); }

    broadcastEvent(req, full, 'event:updated');
    return successResponse(res, full.toJSON());
  } catch (err) {
    if (!t.finished) await t.rollback();
    next(err);
  }
});

// ============================================
// DELETE /by-business/:businessId/:id
// ============================================
router.delete('/by-business/:businessId/:id', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
  try {
    const businessId = Number(req.params.businessId);
    const bm = await requireMember(req.user.id, businessId);
    if (!bm || bm.role === 'ai') return errorResponse(res, 'forbidden', 403);

    let event = await CalendarEvent.findOne({ where: { id: req.params.id, business_id: businessId } });
    if (!event) return errorResponse(res, 'event_not_found', 404);
    if (event.created_by !== req.user.id && bm.role !== 'owner' && bm.role !== 'admin') {
      return errorResponse(res, 'only_creator_or_owner', 403);
    }

    // N+63 P2a — scope 분기. master event 일 때만 적용.
    //   single: master.exception_dates += [recurrence_id] (이 회차만 skip, master/children 유지)
    //   future: master.rrule += UNTIL=recurrence_id-1초 (이 날짜 이후 회차 모두 skip)
    //   all   : master + 모든 child exception 까지 cascade 삭제 (default 변경 — 옛은 master 만)
    const delScope = String(req.query.scope || 'all').toLowerCase();
    // Fable B-1 — exception child(recurrence_parent_id)에서 all/future 는 "시리즈 전체" 의도이므로
    //   master 로 resolve 후 적용. (single 은 그 회차 child 만 지우는 게 맞아 그대로.)
    let futureFromDate = String(req.query.recurrence_id || '').slice(0, 10);
    if (event.recurrence_parent_id && (delScope === 'all' || delScope === 'future')) {
      const master = await CalendarEvent.findOne({ where: { id: event.recurrence_parent_id, business_id: businessId } });
      if (master) {
        // future 기준일: 쿼리값(프론트 instanceDate) 우선. 없으면 child 회차일. recurrence_id 는 DATEONLY 라
        //   Date 객체일 수 있어 String().slice 로 요일문자열 되는 것 방지(YYYY-MM-DD 로 정규화).
        if (delScope === 'future' && !futureFromDate && event.recurrence_id) {
          const rid = event.recurrence_id;
          futureFromDate = rid instanceof Date ? rid.toISOString().slice(0, 10) : String(rid).slice(0, 10);
        }
        event = master;
      }
    }
    const isMasterDel = !!event.rrule && !event.recurrence_parent_id;
    if (isMasterDel && (delScope === 'single' || delScope === 'future')) {
      const targetDateStr = futureFromDate;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDateStr)) {
        return errorResponse(res, 'recurrence_id (YYYY-MM-DD) required for scope=single|future', 400);
      }
      if (delScope === 'single') {
        const ex = Array.isArray(event.exception_dates) ? event.exception_dates : [];
        const exSet = new Set(ex.map(d => String(d).slice(0, 10)));
        exSet.add(targetDateStr);
        await event.update({ exception_dates: Array.from(exSet).sort() });
        // 같은 회차의 child exception 도 cascade 삭제
        await CalendarEvent.destroy({ where: { recurrence_parent_id: event.id, recurrence_id: targetDateStr } });
      } else {
        // future — UNTIL 은 target 직전 순간(전날 23:59:59Z). 전날 회차는 보존, target 이후만 제거.
        //   (Fable B-2 — 옛 코드는 전날 00:00:00Z 라 시각이 그보다 늦은 전날 회차까지 잘려 데이터 손실.)
        const dayBefore = new Date(`${targetDateStr}T00:00:00Z`);
        dayBefore.setUTCSeconds(dayBefore.getUTCSeconds() - 1);
        const untilStr = formatRRuleUntil(dayBefore);
        const ruleSrc = event.rrule.startsWith('RRULE:') ? event.rrule : `RRULE:${event.rrule}`;
        const oldRule = rrulestr(ruleSrc, { dtstart: new Date(event.start_at) });
        const oldOpts = oldRule instanceof RRule ? oldRule.options : oldRule.rrules()[0].options;
        const newOldRule = new RRule({ ...oldOpts, until: dayBefore, count: null });
        await event.update({ rrule: newOldRule.toString().replace(/^DTSTART[^\n]*\n/, '') });
        // target 이후 child exception 도 cascade 삭제
        await CalendarEvent.destroy({
          where: {
            recurrence_parent_id: event.id,
            recurrence_id: { [Op.gte]: targetDateStr },
          },
        });
      }
      await createAuditLog({
        user_id: req.user.id, business_id: businessId,
        action: delScope === 'single' ? 'event.recurrence_skip' : 'event.recurrence_truncate',
        target_type: 'calendar_event', target_id: event.id,
        new_value: { scope: delScope, recurrence_id: targetDateStr },
        ip_address: req.ip,
      });
      broadcastEvent(req, await CalendarEvent.findByPk(event.id, { include: INCLUDE_DETAIL }), 'event:updated');
      return successResponse(res, { id: event.id, scope: delScope, recurrence_id: targetDateStr });
    }

    const snapshot = { title: event.title, start_at: event.start_at, end_at: event.end_at };
    const savedGcalEventId = event.gcal_event_id;  // N+63 — destroy 전 snapshot

    // ★ 구글 정리를 destroy 보다 **먼저** 한다.
    //   calendar_event_gcal_links 는 FK ON DELETE CASCADE 라 destroy 후엔 어느 이벤트를 지울지
    //   알 방법이 사라진다 — 그러면 구글에 고아 일정이 영구히 남는다.
    try {
      await calendarSync.removeEverywhere(event.id, businessId);
    } catch (e) { console.warn('[calendarSync DELETE]', e.message); }

    // P2a — master 삭제 시 children cascade
    if (isMasterDel) {
      const children = await CalendarEvent.findAll({ where: { recurrence_parent_id: event.id }, attributes: ['id'] });
      for (const c of children) {
        await calendarSync.removeEverywhere(c.id, businessId).catch(() => {});
      }
      await CalendarEvent.destroy({ where: { recurrence_parent_id: event.id } });
    }
    await event.destroy();

    // 옛 단일 컬럼 경로 — 링크 테이블이 생기기 전에 올라간 일정은 링크 row 가 없다.
    if (savedGcalEventId) {
      try {
        const gcalToken = await gcal.getTokenForBusiness(businessId);
        if (gcalToken && gcal.hasWriteScope(gcalToken.scope)) {
          const cal = await gcal.getCalendarClient(gcalToken);
          await gcal.deleteEvent(cal, savedGcalEventId);
        }
      } catch (e) { console.warn('[gcal sync DELETE]', e.message); }
    }

    await createAuditLog({
      user_id: req.user.id,
      business_id: businessId,
      action: 'event.deleted',
      target_type: 'calendar_event',
      target_id: event.id,
      old_value: snapshot,
      ip_address: req.ip,
    });

    broadcastEvent(req, { id: event.id, business_id: event.business_id }, 'event:deleted');
    return successResponse(res, { id: event.id });
  } catch (err) { next(err); }
});

// ============================================
// PUT /by-business/:businessId/:id/attendees/:attendeeId — 참석 응답
// body: { response: 'accepted'|'declined'|'tentative'|'pending' }
// ============================================
router.put('/by-business/:businessId/:id/attendees/:attendeeId', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);

    const event = await CalendarEvent.findOne({ where: { id: req.params.id, business_id: businessId } });
    if (!event) return errorResponse(res, 'event_not_found', 404);

    const attendee = await CalendarEventAttendee.findOne({
      where: { id: req.params.attendeeId, event_id: event.id },
    });
    if (!attendee) return errorResponse(res, 'attendee_not_found', 404);

    // 본인 응답만 변경 가능 (client 도 자기 응답은 변경 가능)
    if (attendee.user_id !== req.user.id) return errorResponse(res, 'only_self_response', 403);

    const { response } = req.body || {};
    if (!RESPONSE_SET.has(response)) return errorResponse(res, 'invalid response', 400);

    await attendee.update({ response, responded_at: new Date() });

    await createAuditLog({
      user_id: req.user.id,
      business_id: businessId,
      action: 'event.attendee_responded',
      target_type: 'calendar_event',
      target_id: event.id,
      new_value: { attendee_id: attendee.id, response },
      ip_address: req.ip,
    });

    // N+63 — 주최자 (created_by) 에게 응답 알림. 응답한 본인 제외.
    if (event.created_by && event.created_by !== req.user.id) {
      try {
        const { notify } = require('./notifications');
        const Business = require('../models').Business;
        const biz = await Business.findByPk(businessId, { attributes: ['name', 'brand_name'] });
        const respLabel = { accepted: '수락', declined: '거절', tentative: '미정', pending: '미응답' }[response] || response;
        const respName = req.user.email?.split('@')[0] || '참석자';
        notify({
          userId: event.created_by, businessId, eventKind: 'event',
          title: `${respName} 님이 "${event.title}" ${respLabel}`,
          body: null,
          link: `${process.env.APP_URL || 'https://dev.planq.kr'}/calendar?event=${event.id}`,
          ctaLabel: '일정 보기',
          workspaceName: biz?.brand_name || biz?.name || null,
          actorUserId: req.user.id, entityType: 'calendar_event', entityId: event.id,
          ioApp: req.app.get('io'),
        }).catch((e) => console.warn('[notify event response]', e.message));
      } catch (e) { console.warn('[notify event response outer]', e.message); }
    }

    return successResponse(res, attendee.toJSON());
  } catch (err) { next(err); }
});

// ============================================
// GET /video/status — Google Calendar 연동 상태 (프론트 UI 토글 제어용)
//   응답: { gcal_configured: 서버 .env 에 Google OAuth credentials 있는지,
//           gcal_connected:  업로드한 워크스페이스가 OAuth 완료했는지 }
// 사이클 N+13 — Daily.co 완전 교체. 기존 daily_configured 응답 키는 제거.
// ============================================
//   ★ 멤버십 검사 필수 — 옛 라우트는 검사가 없어 임의 business_id 를 넣으면 남의 워크스페이스
//     연동 계정 이메일이 읽혔다. 다만 이 라우트는 **business_id 없이도 호출된다**(서버 OAuth 설정
//     여부만 묻는 용도 — 프론트 getVideoStatus(businessId || undefined)). checkBusinessAccess 를
//     그냥 붙이면 그 호출이 400 이 되어 "Google 연결하기" CTA 가 사라진다.
//     → business_id 가 있을 때만 멤버십을 검사한다.
const videoStatusAccess = (req, res, next) => (
  req.query?.business_id ? checkBusinessAccess(req, res, next) : next()
);
router.get('/video/status', authenticateToken, videoStatusAccess, async (req, res, next) => {
  try {
    const businessId = req.query.business_id ? Number(req.query.business_id) : null;
    const configured = gcal.isConfigured();
    // 워크스페이스 축 — 팀 캘린더 동기화·push-to-gcal 은 여전히 이 축에서만 가능하다.
    let workspaceConnected = false;
    let workspaceCanWrite = false;
    let workspaceEmail = null;
    // Meet 축 — 개인 연동 우선. 개인만 연동한 직원도 회의를 만들 수 있어야 한다.
    let meetSourceKind = null;
    let meetEmail = null;
    let personalConnected = false;
    if (businessId && configured) {
      const tk = await gcal.getTokenForBusiness(businessId);
      if (tk) {
        workspaceConnected = true;
        workspaceEmail = tk.account_email;
        workspaceCanWrite = gcal.hasWriteScope(tk.scope);
      }
      const personalConn = await calendarSync.pickPersonalConn(req.user.id, businessId);
      personalConnected = !!personalConn;
      const src = await calendarSync.resolveMeetSource({ businessId, userId: req.user.id });
      if (src.kind) {
        meetSourceKind = src.kind;
        meetEmail = src.kind === 'personal' ? src.conn.account_email : src.token.account_email;
      }
    }
    return successResponse(res, {
      gcal_configured: configured,
      // ── 팀 축 (신규) — 팀 동기화 체크박스·"구글 캘린더로 보내기" 버튼이 쓴다.
      //   아래 gcal_* 는 Meet 축으로 의미가 넓어졌으므로, 팀 기능은 반드시 이 두 필드를 봐야 한다.
      //   안 그러면 개인만 연동한 사용자에게 팀 기능이 열리고 누르는 순간 400 이 난다.
      workspace_connected: workspaceConnected,
      workspace_can_write: workspaceCanWrite,
      workspace_account_email: workspaceEmail,
      // ── Meet 축 — 워크스페이스 **또는** 개인 연동 중 하나라도 회의를 만들 수 있으면 true.
      // #242 — 토큰이 있어도 캘린더 쓰기 권한(scope)이 없을 수 있다. 옛 응답은 그 구분이 없어
      //   프론트가 Meet 자동생성 체크박스를 켤 수 있게 노출했고, 켜면 일정 생성이 실패했다.
      gcal_connected: workspaceConnected || personalConnected,
      gcal_can_write: !!meetSourceKind,
      // 회의가 실제로 어느 계정에 만들어지는지 — 프론트가 "내 구글 계정으로 개설" 을 안내한다.
      meet_source: meetSourceKind,
      account_email: meetEmail,
    });
  } catch (err) { next(err); }
});

// ============================================
// POST /by-business/:businessId/:id/meeting — 기존 이벤트에 Google Meet 회의실 자동 생성
// ============================================
router.post('/by-business/:businessId/:id/meeting', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const bm = await requireMember(req.user.id, businessId);
    if (!bm || bm.role === 'ai') return errorResponse(res, 'forbidden', 403);

    const event = await CalendarEvent.findOne({ where: { id: req.params.id, business_id: businessId } });
    if (!event) return errorResponse(res, 'event_not_found', 404);
    if (event.created_by !== req.user.id && bm.role !== 'owner' && bm.role !== 'admin') {
      return errorResponse(res, 'only_creator_or_owner', 403);
    }
    // ★ 소스는 **일정 소유자의 개인 연동 우선 → 워크스페이스 폴백**.
    //   축을 actor(req.user.id)가 아니라 event.created_by 로 잡는 이유: admin 이 남의 일정에 회의를
    //   다시 발급할 때 admin 개인 캘린더에 앉히면, 이후 reconcile 의 개인 목적지(작성자 축)와
    //   어긋나 회의가 회수 대상이 된다. 목적지 축은 calendarSync.resolveTargets 와 반드시 같아야 한다.
    const meetSource = await calendarSync.resolveMeetSource({
      businessId, userId: event.created_by || req.user.id,
    });
    // #242 — 쓰기 권한 없는 연동이면 구글을 부르지 않고 명시적으로 거부한다. 옛 코드는 그냥 호출해
    //   502 gcal_meeting_create_failed 로 죽었고 사용자는 이유를 알 수 없었다.
    if (!meetSource.kind) {
      return errorResponse(res, meetSource.reason, 400, meetSource.reason);
    }

    let meeting;
    try {
      // N+63 — rrule 전달. N+23 fix 가 신규 생성 (POST /by-business) 에만 적용되어
      // 재발급 라우트가 누락되어 있었음. 정기 회의의 옛 링크 만료 / 다음 회차
      // "회의 없음" 회귀 사용자 self-fix 경로 — 재발급 시에도 정기 정합.
      meeting = await calendarSync.createMeeting(meetSource, {
        title: event.title,
        summary: event.title,
        description: event.description,
        location: event.location,
        startAt: event.start_at,
        endAt: event.end_at,
        rrule: event.rrule || undefined,
      });
    } catch (e) {
      console.error('[createMeeting /:id/meeting]', e.message);
      await calendarSync.recordMeetError(meetSource, e);
      return errorResponse(res, 'gcal_meeting_create_failed', 502);
    }
    if (!meeting?.meetUrl) return errorResponse(res, 'meet_url_not_returned', 502);

    // 옛 회의 정리 — 옛 event 가 캘린더에 남아있으면 사용자 혼란(만료된 Meet 링크 + 새 링크 동시 노출).
    //   ★ 소스가 바뀌었을 수 있으므로(워크스페이스 → 개인) **소스 불문 기존 Meet 보유 링크 전부** +
    //     옛 단일 컬럼(gcal_event_id) 양쪽을 정리한다. 한쪽만 지우면 팀 캘린더에 옛 회의가 살아남아
    //     같은 일정의 회의 링크가 두 개 유통된다.
    let cleared = [];
    try { cleared = await calendarSync.clearMeetings(event.id, businessId); }
    catch (e) { console.warn('[clearMeetings]', e.message); }

    // ★ 옛 단일 컬럼(gcal_event_id) 정리는 **링크가 관리하지 않는 진짜 레거시**에만 한다.
    //   여기가 함정이었다: reconcile 도 워크스페이스에 일반 사본을 만들면서 이 컬럼을 채운다
    //   (calendarSync.js 의 add 분기). 그래서 무조건 지우면 **회의와 무관한 팀 동기화 사본**을
    //   구글에서 삭제해 버린다 — 팀 캘린더에서 일정이 사라지고 링크는 dangling 이 된다.
    //   회의를 들고 있던 워크스페이스 이벤트는 위 clearMeetings 가 이미 지웠다.
    const managedWs = await CalendarEventGcalLink.findOne({
      where: { event_id: event.id, target: 'workspace' },
    });
    const legacyOrphan = event.gcal_event_id
      && event.gcal_event_id !== meeting.id
      && !cleared.some((c) => c.gcal_event_id === event.gcal_event_id)   // 이미 지운 회의
      && !(managedWs && managedWs.gcal_event_id === event.gcal_event_id); // reconcile 관할 사본
    if (legacyOrphan) {
      try {
        const oldToken = await gcal.getTokenForBusiness(businessId);
        if (oldToken && gcal.hasWriteScope(oldToken.scope)) {
          await gcal.deleteEvent(await gcal.getCalendarClient(oldToken), event.gcal_event_id);
        }
      } catch (e) { console.warn('[gcal cleanup old event]', e.message); }
    }

    await event.update({
      meeting_url: meeting.meetUrl,
      meeting_provider: 'google_meet',
      // 옛 단일 컬럼은 워크스페이스 축이다 — 개인 캘린더 회의를 여기 넣으면 삭제 경로가 엉뚱한
      // 캘린더를 본다. 개인 소스일 때는 **살아남은 워크스페이스 사본**의 id 를 유지한다
      // (그 사본은 여전히 팀 캘린더에 있고 reconcile 이 계속 관리한다). 없으면 NULL.
      gcal_event_id: meetSource.kind === 'workspace'
        ? (meeting.id || null)
        : (managedWs ? managedWs.gcal_event_id : null),
    });
    try { await calendarSync.linkMeeting(event.id, meetSource, meeting.id, businessId); }
    catch (e) { console.warn('[linkMeeting /:id/meeting]', e.message); }

    await createAuditLog({
      user_id: req.user.id,
      business_id: businessId,
      action: 'event.meeting_created',
      target_type: 'calendar_event',
      target_id: event.id,
      new_value: { meeting_url: meeting.meetUrl, meeting_provider: 'google_meet' },
      ip_address: req.ip,
    });

    const full = await CalendarEvent.findByPk(event.id, { include: INCLUDE_DETAIL });
    return successResponse(res, full.toJSON());
  } catch (err) { next(err); }
});

// ============================================
// 공유 링크 (사이클 N+4 — 통합 공유 시스템 Phase 2)
// 마운트 alias: server.js 의 app.use('/api/calendar-events', router) 가
// 추가되면 ShareModal 의 /api/calendar-events/:id/share 가 매칭됨.
// 기존 /api/calendar/by-business/... 라우트와 충돌 X (segment 비교 우선).
// ============================================
router.post('/:id/share', authenticateToken, async (req, res, next) => {
  try {
    const ev = await CalendarEvent.findByPk(req.params.id);
    if (!ev) return errorResponse(res, 'event_not_found', 404);
    const scope = await getUserScope(req.user.id, ev.business_id, req.user.platform_role);
    if (!isMemberOrAbove(scope) && ev.created_by !== req.user.id) {
      return errorResponse(res, 'forbidden', 403);
    }
    // #104 — 나만보기(L1)·팀 비공개(L2) 일정은 공개 링크 발급 금지.
    //   공개 링크는 누구나 접근 → L1(개인)·L2(특정 멤버만) 의 제한과 모순. L3(워크스페이스)/L4(외부)만 공유 허용.
    if (ev.vlevel === 'L1' || ev.vlevel === 'L2' || ev.visibility === 'personal') {
      return errorResponse(res, 'cannot_share_private_event', 403);
    }

    const { applyShareUpdate } = require('../services/share_helper');
    const r = await applyShareUpdate(ev, req.body || {});
    const url = `${process.env.APP_URL || 'https://dev.planq.kr'}/public/calendar/${r.token}`;
    return successResponse(res, {
      share_token: r.token,
      share_url: url,
      shared_at: r.shared_at,
      share_expires_at: r.share_expires_at,
      password_set: r.password_set,
    });
  } catch (err) { next(err); }
});

router.delete('/:id/share', authenticateToken, async (req, res, next) => {
  try {
    const ev = await CalendarEvent.findByPk(req.params.id);
    if (!ev) return errorResponse(res, 'event_not_found', 404);
    const scope = await getUserScope(req.user.id, ev.business_id, req.user.platform_role);
    if (!isMemberOrAbove(scope) && ev.created_by !== req.user.id) {
      return errorResponse(res, 'forbidden', 403);
    }
    await ev.update({
      share_token: null,
      shared_at: null,
      share_password_hash: null,
      share_expires_at: null,
    });
    return successResponse(res, { revoked: true });
  } catch (err) { next(err); }
});

router.get('/public/by-token/:token', async (req, res, next) => {
  try {
    // N+44 — 410 통일
    const ev = await CalendarEvent.findOne({
      where: { share_token: req.params.token },
      include: [
        { model: User, as: 'creator', attributes: ['id', 'name'], required: false },
        { model: Project, attributes: ['id', 'name'], required: false },
        { model: Business, attributes: ['id', 'name', 'brand_name'], required: false },
      ],
      attributes: ['id', 'title', 'description', 'location', 'start_at', 'end_at',
        'all_day', 'category', 'meeting_url', 'shared_at', 'share_expires_at',
        'share_password_hash', 'business_id', 'project_id', 'vlevel', 'visibility'],
    });
    if (!ev) return errorResponse(res, 'not_found', 404);
    // #104 — 방어심층: 개인(L1)·팀 비공개(L2)로 전환됐거나 레거시 토큰이 남은 제한 일정은 공개 미제공.
    if (ev.vlevel === 'L1' || ev.vlevel === 'L2' || ev.visibility === 'personal') return errorResponse(res, 'not_found', 404);
    const { verifySharePassword, checkShareExpiry } = require('../services/share_helper');
    if (checkShareExpiry(ev, res)) return;
    const v = await verifySharePassword(ev, req);
    if (!v.ok) return res.status(v.status).json({ success: false, message: v.error, requires_password: v.requires_password });
    return successResponse(res, {
      id: ev.id,
      title: ev.title,
      description: ev.description,
      location: ev.location,
      start_at: ev.start_at,
      end_at: ev.end_at,
      all_day: ev.all_day,
      category: ev.category,
      meeting_url: ev.meeting_url,
      creator: ev.creator ? { id: ev.creator.id, name: ev.creator.name } : null,
      project: ev.Project ? { id: ev.Project.id, name: ev.Project.name } : null,
      workspace: ev.Business ? { id: ev.Business.id, name: ev.Business.brand_name || ev.Business.name } : null,
      shared_at: ev.shared_at,
    });
  } catch (err) { next(err); }
});

router.get('/public/by-token/:token/auth-check', authenticateToken, async (req, res, next) => {
  try {
    // N+44 — 410 통일
    const ev = await CalendarEvent.findOne({ where: { share_token: req.params.token } });
    if (!ev) return errorResponse(res, 'not_found', 404);
    const { checkShareExpiry } = require('../services/share_helper');
    if (checkShareExpiry(ev, res)) return;
    const scope = await getUserScope(req.user.id, ev.business_id, req.user.platform_role);
    const canAccess = isMemberOrAbove(scope) || ev.created_by === req.user.id;
    return successResponse(res, {
      canAccess: !!canAccess,
      appUrl: canAccess ? `/calendar?event=${ev.id}` : null,
    });
  } catch (err) { next(err); }
});

// #126 — "구글 캘린더로 보내기" (backfill). PlanQ→Google push 기능(2026-07-16) 이전에 만든 일정은
//   gcal_event_id 가 NULL 이라 자동 동기화 대상이 아니었다(수정해도 push 안 됨). 명시적으로 push.
//   ★ push 는 워크스페이스 gcal 연동(business_cloud_tokens, calendar.events 쓰기 scope)이 있어야 한다.
//     개인설정 캘린더 연동은 읽기전용(오버레이)이라 push 불가 — 미연결 시 명확히 안내(조용한 skip 금지).
router.post('/by-business/:businessId/:id/push-to-gcal', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const event = await CalendarEvent.findOne({ where: { id: Number(req.params.id), business_id: businessId } });
    if (!event) return errorResponse(res, 'event_not_found', 404);
    // #126 보안 — 개인(L1)·팀 비공개(L2)·personal 일정은 워크스페이스 gcal(owner primary)로 push 금지.
    //   여태 이 라우트엔 vlevel 검사가 없어 id 만 알면 남의 개인 일정을 owner 구글캘린더로 밀 수 있었다(IDOR·유출).
    if (gcal.isPrivateForGcal(event)) return errorResponse(res, 'cannot_push_private_event', 403, 'cannot_push_private_event');
    if (event.gcal_event_id) return successResponse(res, { already_synced: true, gcal_event_id: event.gcal_event_id });

    const gcalToken = await gcal.getTokenForBusiness(businessId);
    if (!gcalToken) {
      // 워크스페이스 gcal 미연결 — 개인설정 연동(readonly)만으론 push 불가. 프론트가 연동 안내로 분기.
      return errorResponse(res, 'gcal_not_connected — 워크스페이스 Google Calendar 연동이 필요합니다', 400, 'gcal_not_connected');
    }
    // 동의 화면에서 캘린더 항목을 체크하지 않고 연결된 토큰은 여기서 걸러진다.
    // 안 걸러내면 구글이 403 insufficientPermissions 를 주고 사용자는 원인을 알 수 없다.
    if (!gcal.hasWriteScope(gcalToken.scope)) {
      return errorResponse(res, 'gcal_scope_missing — Google 캘린더 쓰기 권한이 없습니다. 설정에서 다시 연결해 주세요', 400, 'gcal_scope_missing');
    }
    const cal = await gcal.getCalendarClient(gcalToken);
    let pushed;
    try {
      pushed = await gcal.insertEvent(cal, {
        summary: event.title, description: event.description, location: event.location,
        startAt: event.start_at, endAt: event.end_at, allDay: event.all_day, rrule: event.rrule,
      });
      await gcal.clearPushError(gcalToken);
    } catch (e) {
      await gcal.recordPushError(gcalToken, e);
      throw e;
    }
    if (!pushed?.id) return errorResponse(res, 'gcal_push_failed', 502);
    await event.update({ gcal_event_id: pushed.id });
    // ★ 링크 row 도 같이 만든다. 안 만들면 다음 저장 때 reconcile 이 "워크스페이스 링크 없음" 으로
    //   보고 **두 번째 이벤트를 insert** 한다(구글 캘린더에 사본 2개, gcal_event_id 는 나중 것으로
    //   덮어써짐). Meet 경로와 완전히 같은 기전이라 같이 막는다. holds_meeting 은 false —
    //   이건 일반 일정 backfill 이지 회의가 아니다.
    try {
      const link = await CalendarEventGcalLink.findOne({
        where: { event_id: event.id, target: 'workspace', connection_id: null },
      });
      if (link) await link.update({ gcal_event_id: pushed.id });
      else await CalendarEventGcalLink.create({
        event_id: event.id, target: 'workspace', connection_id: null,
        user_id: null, gcal_event_id: pushed.id, holds_meeting: false,
      });
    } catch (e) { console.warn('[push-to-gcal link]', e.message); }

    require('../services/auditService').logAudit(req, {
      action: 'calendar.push_to_gcal', targetType: 'calendar_event', targetId: event.id,
      newValue: { gcal_event_id: pushed.id },
    });
    return successResponse(res, { gcal_event_id: pushed.id });
  } catch (err) { next(err); }
});

module.exports = router;
