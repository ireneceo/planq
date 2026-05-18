const express = require('express');
const { Op } = require('sequelize');
const router = express.Router();
const { sequelize } = require('../config/database');
const {
  CalendarEvent, CalendarEventAttendee,
  BusinessMember, User, Client, Project,
} = require('../models');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { attachWorkspaceScope, isMemberOrAbove, getUserScope } = require('../middleware/access_scope');
const { createAuditLog } = require('../middleware/audit');
const { RRule, rrulestr } = require('rrule');
// 사이클 N+13: Daily.co 완전 교체 → Google Calendar API (Meet 자동 생성)
const gcal = require('../services/google_calendar');
const crypto = require('crypto');
const { Business } = require('../models');

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

    // visibility:
    //   owner / member — business 전부 + 본인 personal (default '전체' 탭)
    //   client         — 본인이 attendee 인 business event 만 (PERMISSION_MATRIX §7)
    // 멤버가 '나' 만 보고 싶을 때는 query.scope=mine 로 후처리 필터 (line 145).
    if (req.scope?.isClient) {
      const myAttendees = await CalendarEventAttendee.findAll({
        where: { user_id: req.user.id },
        attributes: ['event_id'],
      });
      const ids = myAttendees.map((a) => a.event_id);
      if (ids.length === 0) return successResponse(res, []);
      baseWhere.id = { [Op.in]: ids };
      baseWhere[Op.and] = [{ visibility: 'business' }];
    } else {
      baseWhere[Op.and] = [{
        [Op.or]: [
          { visibility: 'business' },
          { visibility: 'personal', created_by: req.user.id },
        ],
      }];
    }

    const rawEvents = await CalendarEvent.findAll({
      where: baseWhere,
      include: INCLUDE_DETAIL,
      order: [['start_at', 'ASC']],
    });

    // RRULE expansion — 반복 이벤트를 개별 instance 로 분해
    let events = [];
    for (const e of rawEvents) {
      const json = e.toJSON();
      if (!json.rrule) {
        events.push(json);
        continue;
      }
      try {
        const dur = new Date(json.end_at).getTime() - new Date(json.start_at).getTime();
        // RRULE 문자열 정규화 — DTSTART 포함되지 않은 경우 rule 로부터 파싱
        const ruleSrc = json.rrule.startsWith('RRULE:') || json.rrule.startsWith('DTSTART')
          ? json.rrule
          : `RRULE:${json.rrule}`;
        const rule = rrulestr(ruleSrc, { dtstart: new Date(json.start_at) });
        const instances = rule instanceof RRule
          ? rule.between(start, end, true)
          : rule.between(start, end, true);
        for (const inst of instances) {
          events.push({
            ...json,
            start_at: inst.toISOString(),
            end_at: new Date(inst.getTime() + dur).toISOString(),
            _instance_key: `${json.id}_${inst.toISOString().slice(0, 10)}`,
            _parent_event_id: json.id,
          });
        }
      } catch (err) {
        console.error('rrule expansion failed', json.id, err.message);
        // 실패 시 원본 이벤트만 포함
        events.push(json);
      }
    }

    // scope=mine — 내가 만들었거나 attendee 인 것만
    if (req.query.scope === 'mine') {
      events = events.filter((e) => {
        if (e.created_by === req.user.id) return true;
        return (e.attendees || []).some((a) => a.user_id === req.user.id);
      });
    }

    events.sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
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
  if (req.businessRole === 'client') return errorResponse(res, 'Clients cannot create events. Members may invite you as an attendee.', 403);
  const t = await sequelize.transaction();
  try {
    const businessId = Number(req.params.businessId);
    const bm = await requireMember(req.user.id, businessId);
    if (!bm || bm.role === 'ai') {
      await t.rollback();
      return errorResponse(res, 'forbidden', 403);
    }

    const {
      title, description, location,
      start_at, end_at, all_day,
      category, color, rrule,
      meeting_url, meeting_provider,
      auto_create_meeting,
      visibility, project_id,
      attendees = [],
    } = req.body || {};

    if (!title?.trim()) { await t.rollback(); return errorResponse(res, 'title is required', 400); }
    const sd = parseDate(start_at);
    const ed = parseDate(end_at);
    if (!sd || !ed) { await t.rollback(); return errorResponse(res, 'start_at and end_at are required', 400); }
    if (ed < sd) { await t.rollback(); return errorResponse(res, 'end_at must be after start_at', 400); }

    // project_id — 같은 business 여야 함
    let projectId = null;
    if (project_id) {
      const prj = await Project.findOne({ where: { id: project_id, business_id: businessId } });
      if (!prj) { await t.rollback(); return errorResponse(res, 'invalid_project', 400); }
      projectId = prj.id;
    }

    // Google Meet 자동 생성 — auto_create_meeting 옵션 시
    // 워크스페이스에 Google Calendar 연동 (BusinessCloudToken provider='gcal') 있어야 발급 가능.
    // 미연결 시 errorResponse 'gcal_not_connected' 로 frontend 가 연결 CTA 표시.
    let finalMeetingUrl = meeting_url?.trim() || null;
    let finalMeetingProvider = PROVIDER_SET.has(meeting_provider) ? meeting_provider : null;
    if (auto_create_meeting) {
      const gcalToken = await gcal.getTokenForBusiness(businessId);
      if (!gcalToken) {
        await t.rollback();
        return errorResponse(res, 'gcal_not_connected', 400);
      }
      try {
        const cal = await gcal.getCalendarClient(gcalToken);
        const meeting = await gcal.createMeetingEvent(cal, {
          summary: title.trim(),
          description: description?.trim() || null,
          startAt: sd,
          endAt: ed,
          // 사이클 N+23: 정기 일정 rrule 을 Google Calendar 의 recurrence 로 전달 →
          // 모든 회차에 동일 Meet 링크 영구 유효. 옛 단일 이벤트 패턴은 첫 회차 끝나면
          // "회의 존재 안 함" 회귀.
          rrule: rrule?.trim() || null,
        });
        if (meeting?.meetUrl) {
          finalMeetingUrl = meeting.meetUrl;
          finalMeetingProvider = 'google_meet';
        }
      } catch (e) {
        console.error('[gcal createMeetingEvent]', e.message);
        await t.rollback();
        return errorResponse(res, 'gcal_meeting_create_failed', 502);
      }
    }

    const event = await CalendarEvent.create({
      business_id: businessId,
      project_id: projectId,
      title: title.trim(),
      description: description?.trim() || null,
      location: location?.trim() || null,
      start_at: sd,
      end_at: ed,
      all_day: !!all_day,
      category: CATEGORY_SET.has(category) ? category : 'work',
      color: (color && HEX_RE.test(color)) ? color : null,
      rrule: rrule?.trim() || null,
      meeting_url: finalMeetingUrl,
      meeting_provider: finalMeetingProvider,
      visibility: VISIBILITY_SET.has(visibility) ? visibility : 'business',
      created_by: req.user.id,
    }, { transaction: t });

    // attendees — user_id 는 business 멤버 여야 함
    if (Array.isArray(attendees) && attendees.length > 0) {
      const validUserIds = new Set(
        (await BusinessMember.findAll({
          where: {
            business_id: businessId,
            user_id: attendees.map((a) => a.user_id).filter(Boolean),
          },
        })).map((x) => x.user_id)
      );
      const validClientIds = new Set(
        (await Client.findAll({
          where: {
            business_id: businessId,
            id: attendees.map((a) => a.client_id).filter(Boolean),
          },
        })).map((x) => x.id)
      );

      const rows = [];
      const seen = new Set();
      for (const a of attendees) {
        const key = `${a.user_id || ''}:${a.client_id || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (a.user_id && validUserIds.has(a.user_id)) {
          rows.push({ event_id: event.id, user_id: a.user_id, response: 'pending' });
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
      action: 'event.created',
      target_type: 'calendar_event',
      target_id: event.id,
      new_value: { title: event.title, start_at: event.start_at, end_at: event.end_at },
      ip_address: req.ip,
    });

    const full = await CalendarEvent.findByPk(event.id, { include: INCLUDE_DETAIL });

    // 알림: 멤버 attendee 에게 (본인 제외, client 는 별도 채널 필요 — 추후)
    try {
      const memberAttendeeIds = (full.attendees || [])
        .filter((a) => a.user_id && a.user_id !== req.user.id)
        .map((a) => a.user_id);
      if (memberAttendeeIds.length > 0) {
        const { notifyMany } = require('./notifications');
        const Business = require('../models').Business;
        const biz = await Business.findByPk(businessId, { attributes: ['name', 'brand_name'] });
        const wsName = biz?.brand_name || biz?.name || null;
        const startStr = event.start_at ? new Date(event.start_at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '';
        notifyMany({
          userIds: memberAttendeeIds, businessId, eventKind: 'event',
          title: '일정 초대', body: `"${event.title}"${startStr ? ` · ${startStr}` : ''}`,
          link: `${process.env.APP_URL || 'https://dev.planq.kr'}/calendar?event=${event.id}`,
          ctaLabel: '일정 보기', workspaceName: wsName,
        }).catch((e) => console.warn('[notify event invite]', e.message));
      }
    } catch (e) { console.warn('[notify event invite outer]', e.message); }

    return successResponse(res, full.toJSON(), 'created', 201);
  } catch (err) {
    if (!t.finished) await t.rollback();
    next(err);
  }
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

    // personal 은 본인만
    if (event.visibility === 'personal' && event.created_by !== req.user.id) {
      return errorResponse(res, 'forbidden', 403);
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

    // 편집 권한: 작성자 또는 owner
    if (event.created_by !== req.user.id && bm.role !== 'owner') {
      await t.rollback();
      return errorResponse(res, 'only_creator_or_owner', 403);
    }

    const {
      title, description, location,
      start_at, end_at, all_day,
      category, color, rrule,
      meeting_url, meeting_provider,
      visibility, project_id,
      attendees,
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
    if (project_id !== undefined) {
      if (project_id === null) {
        updates.project_id = null;
      } else {
        const prj = await Project.findOne({ where: { id: project_id, business_id: businessId } });
        if (!prj) { await t.rollback(); return errorResponse(res, 'invalid_project', 400); }
        updates.project_id = prj.id;
      }
    }

    const oldValue = {
      title: event.title, start_at: event.start_at, end_at: event.end_at,
      visibility: event.visibility, project_id: event.project_id,
    };

    await event.update(updates, { transaction: t });

    // attendees 교체
    if (Array.isArray(attendees)) {
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

    const full = await CalendarEvent.findByPk(event.id, { include: INCLUDE_DETAIL });
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

    const event = await CalendarEvent.findOne({ where: { id: req.params.id, business_id: businessId } });
    if (!event) return errorResponse(res, 'event_not_found', 404);
    if (event.created_by !== req.user.id && bm.role !== 'owner') {
      return errorResponse(res, 'only_creator_or_owner', 403);
    }

    const snapshot = { title: event.title, start_at: event.start_at, end_at: event.end_at };
    await event.destroy();

    await createAuditLog({
      user_id: req.user.id,
      business_id: businessId,
      action: 'event.deleted',
      target_type: 'calendar_event',
      target_id: event.id,
      old_value: snapshot,
      ip_address: req.ip,
    });

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

    return successResponse(res, attendee.toJSON());
  } catch (err) { next(err); }
});

// ============================================
// GET /video/status — Google Calendar 연동 상태 (프론트 UI 토글 제어용)
//   응답: { gcal_configured: 서버 .env 에 Google OAuth credentials 있는지,
//           gcal_connected:  업로드한 워크스페이스가 OAuth 완료했는지 }
// 사이클 N+13 — Daily.co 완전 교체. 기존 daily_configured 응답 키는 제거.
// ============================================
router.get('/video/status', authenticateToken, async (req, res, next) => {
  try {
    const businessId = req.query.business_id ? Number(req.query.business_id) : null;
    const configured = gcal.isConfigured();
    let connected = false;
    let accountEmail = null;
    if (businessId && configured) {
      const tk = await gcal.getTokenForBusiness(businessId);
      if (tk) { connected = true; accountEmail = tk.account_email; }
    }
    return successResponse(res, {
      gcal_configured: configured,
      gcal_connected: connected,
      account_email: accountEmail,
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
    if (event.created_by !== req.user.id && bm.role !== 'owner') {
      return errorResponse(res, 'only_creator_or_owner', 403);
    }
    const gcalToken = await gcal.getTokenForBusiness(businessId);
    if (!gcalToken) return errorResponse(res, 'gcal_not_connected', 400);

    let meeting;
    try {
      const cal = await gcal.getCalendarClient(gcalToken);
      meeting = await gcal.createMeetingEvent(cal, {
        summary: event.title,
        description: event.description,
        startAt: event.start_at,
        endAt: event.end_at,
      });
    } catch (e) {
      console.error('[gcal /:id/meeting]', e.message);
      return errorResponse(res, 'gcal_meeting_create_failed', 502);
    }
    if (!meeting?.meetUrl) return errorResponse(res, 'meet_url_not_returned', 502);

    await event.update({ meeting_url: meeting.meetUrl, meeting_provider: 'google_meet' });

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
    const ev = await CalendarEvent.findOne({
      where: {
        share_token: req.params.token,
        [Op.or]: [
          { share_expires_at: null },
          { share_expires_at: { [Op.gt]: new Date() } },
        ],
      },
      include: [
        { model: User, as: 'creator', attributes: ['id', 'name'], required: false },
        { model: Project, attributes: ['id', 'name'], required: false },
        { model: Business, attributes: ['id', 'name', 'brand_name'], required: false },
      ],
      attributes: ['id', 'title', 'description', 'location', 'start_at', 'end_at',
        'all_day', 'category', 'meeting_url', 'shared_at', 'share_expires_at',
        'share_password_hash', 'business_id', 'project_id'],
    });
    if (!ev) return errorResponse(res, 'not_found_or_expired', 404);
    const { verifySharePassword } = require('../services/share_helper');
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
    const ev = await CalendarEvent.findOne({
      where: {
        share_token: req.params.token,
        [Op.or]: [
          { share_expires_at: null },
          { share_expires_at: { [Op.gt]: new Date() } },
        ],
      },
    });
    if (!ev) return errorResponse(res, 'not_found_or_expired', 404);
    const scope = await getUserScope(req.user.id, ev.business_id, req.user.platform_role);
    const canAccess = isMemberOrAbove(scope) || ev.created_by === req.user.id;
    return successResponse(res, {
      canAccess: !!canAccess,
      appUrl: canAccess ? `/calendar?event=${ev.id}` : null,
    });
  } catch (err) { next(err); }
});

module.exports = router;
