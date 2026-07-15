// 일정(캘린더 이벤트) 행동 계층 — 사람도 Cue 도 **같은 문**을 지난다.
//
// 왜 있는가:
//   일정 생성이 routes/calendar.js 에만 인라인이었다. 그래서 라우트를 통과하지 않는 실행자(Cue·워커)는
//   메뉴 권한(qcalendar)·감사·알림·socket broadcast 를 통째로 우회할 수 있었다. #81 Cue 대화형 실행이
//   일정을 잡으려면 이 문이 있어야 한다.
//
// 계약 (task_actions.js 와 동일):
//   actor  = { kind:'user'|'cue', userId, onBehalfOfUserId?, platformRole?, req? }
//   params = camelCase 필드 (라우트가 snake_case body 를 파싱해서 넘긴다)
//   반환   = { ok:true, data:{ event, full } } | { ok:false, code, http }
//
// 이 파일이 책임지지 않는 것: HTTP 파싱·응답 직렬화·인증. 그건 라우트의 몫이다.

const { sequelize } = require('../../config/database');
const {
  CalendarEvent, CalendarEventAttendee,
  BusinessMember, User, Client, Project, Business,
} = require('../../models');
const { resolveSubject, assertMenuWrite, fail, done } = require('./_subject');
const { applyMemberDisplayName } = require('../displayName');
const { createAuditLog } = require('../../middleware/audit');
const gcal = require('../google_calendar');

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const CATEGORY_SET = new Set(['personal', 'work', 'meeting', 'deadline', 'other']);
const PROVIDER_SET = new Set(['google_meet', 'manual']);
const VISIBILITY_SET = new Set(['personal', 'business']);

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

function getIO() { return global.__planqIo || null; }

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/** 새 일정을 만든다. 사람도 Cue 도 이 문을 지난다.
 *
 * @param actor   { kind, userId, onBehalfOfUserId?, platformRole?, req? }
 * @param params  일정 필드 (camelCase — 라우트가 파싱해서 넘긴다)
 */
async function createEvent(actor, params = {}) {
  const subj = await resolveSubject(actor);
  if (!subj.ok) return subj;
  const subjectId = subj.subjectId;

  const businessId = Number(params.businessId);
  if (!businessId) return fail('business_id required');

  // 워크스페이스 접근권 — 멤버(owner/member/admin)만. 고객·AI 멤버는 일정 생성 불가(초대만 받는다).
  const bm = await BusinessMember.findOne({ where: { user_id: subjectId, business_id: businessId } });
  if (!bm || bm.role === 'ai') {
    // 멤버가 아니면 고객일 수 있다 — 고객은 명시적으로 다른 메시지
    const cl = await Client.findOne({ where: { user_id: subjectId, business_id: businessId } });
    if (cl) return fail('Clients cannot create events. Members may invite you as an attendee.', 403);
    return fail('forbidden', 403);
  }

  // 메뉴 권한 (신설 봉합) — 여태 라우트가 qcalendar 쓰기 권한을 안 봤다 (none 인 멤버도 일정 생성).
  const menu = await assertMenuWrite(subjectId, businessId, 'qcalendar', subj.platformRole);
  if (!menu.ok) return menu;

  const title = String(params.title || '').trim();
  if (!title) return fail('title is required');
  const sd = parseDate(params.startAt);
  const ed = parseDate(params.endAt);
  if (!sd || !ed) return fail('start_at and end_at are required');
  if (ed < sd) return fail('end_at must be after start_at');

  // project_id — 같은 business 여야 함
  let projectId = null;
  if (params.projectId) {
    const prj = await Project.findOne({ where: { id: params.projectId, business_id: businessId } });
    if (!prj) return fail('invalid_project');
    projectId = prj.id;
  }

  const t = await sequelize.transaction();
  let event;
  try {
    // Google Meet 자동 생성 — auto_create_meeting 옵션 시. 워크스페이스 gcal 연동 필요.
    let finalMeetingUrl = params.meetingUrl?.trim() || null;
    let finalMeetingProvider = PROVIDER_SET.has(params.meetingProvider) ? params.meetingProvider : null;
    let finalGcalEventId = null;
    if (params.autoCreateMeeting) {
      const gcalToken = await gcal.getTokenForBusiness(businessId);
      if (!gcalToken) { await t.rollback(); return fail('gcal_not_connected'); }
      try {
        const cal = await gcal.getCalendarClient(gcalToken);
        const meeting = await gcal.createMeetingEvent(cal, {
          summary: title,
          description: params.description?.trim() || null,
          startAt: sd,
          endAt: ed,
          rrule: params.rrule?.trim() || null,
        });
        if (meeting?.meetUrl) {
          finalMeetingUrl = meeting.meetUrl;
          finalMeetingProvider = 'google_meet';
          finalGcalEventId = meeting.id || null;
        }
      } catch (e) {
        console.error('[gcal createMeetingEvent]', e.message);
        await t.rollback();
        return fail('gcal_meeting_create_failed', 502);
      }
    }

    event = await CalendarEvent.create({
      business_id: businessId,
      project_id: projectId,
      title,
      description: params.description?.trim() || null,
      location: params.location?.trim() || null,
      start_at: sd,
      end_at: ed,
      all_day: !!params.allDay,
      category: CATEGORY_SET.has(params.category) ? params.category : 'work',
      color: (params.color && HEX_RE.test(params.color)) ? params.color : null,
      rrule: params.rrule?.trim() || null,
      meeting_url: finalMeetingUrl,
      meeting_provider: finalMeetingProvider,
      gcal_event_id: finalGcalEventId,
      reminder_minutes: Number.isFinite(Number(params.reminderMinutes)) && Number(params.reminderMinutes) > 0
        ? Math.min(10080, Number(params.reminderMinutes))  // max 1주 (7 * 24 * 60)
        : null,
      visibility: VISIBILITY_SET.has(params.visibility) ? params.visibility : 'business',
      vlevel: ['L1', 'L2', 'L3', 'L4'].includes(params.vlevel) ? params.vlevel : null,
      target_member_ids: Array.isArray(params.targetMemberIds) ? params.targetMemberIds.map(Number).filter(Boolean) : null,
      target_client_ids: Array.isArray(params.targetClientIds) ? params.targetClientIds.map(Number).filter(Boolean) : null,
      created_by: subjectId,
    }, { transaction: t });

    // attendees — user_id 는 business 멤버, client_id 는 business 고객이어야 함
    const attendees = Array.isArray(params.attendees) ? params.attendees : [];
    if (attendees.length > 0) {
      const validUserIds = new Set(
        (await BusinessMember.findAll({
          where: { business_id: businessId, user_id: attendees.map((a) => a.user_id).filter(Boolean) },
          transaction: t,
        })).map((x) => x.user_id)
      );
      const validClientIds = new Set(
        (await Client.findAll({
          where: { business_id: businessId, id: attendees.map((a) => a.client_id).filter(Boolean) },
          transaction: t,
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
  } catch (e) {
    if (!t.finished) await t.rollback();
    throw e;
  }

  // ── 부수효과 — 커밋된 뒤에만 ──
  await createAuditLog({
    user_id: subjectId,
    business_id: businessId,
    action: 'event.created',
    target_type: 'calendar_event',
    target_id: event.id,
    new_value: { title: event.title, start_at: event.start_at, end_at: event.end_at, via: actor.kind === 'cue' ? 'cue' : 'user' },
    ip_address: actor.req?.ip || null,
  });

  const full = await CalendarEvent.findByPk(event.id, { include: INCLUDE_DETAIL });

  // 알림 — 멤버 attendee 에게 (본인 제외). client attendee 는 별도 채널 (추후).
  try {
    const memberAttendeeIds = (full.attendees || [])
      .filter((a) => a.user_id && a.user_id !== subjectId)
      .map((a) => a.user_id);
    if (memberAttendeeIds.length > 0) {
      const { notifyMany } = require('../../routes/notifications');
      const biz = await Business.findByPk(businessId, { attributes: ['name', 'brand_name'] });
      const wsName = biz?.brand_name || biz?.name || null;
      const startStr = event.start_at ? new Date(event.start_at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '';
      notifyMany({
        userIds: memberAttendeeIds, businessId, eventKind: 'event',
        title: '일정 초대', body: `"${event.title}"${startStr ? ` · ${startStr}` : ''}`,
        link: `${process.env.APP_URL || 'https://dev.planq.kr'}/calendar?event=${event.id}`,
        ctaLabel: '일정 보기', workspaceName: wsName,
        actorUserId: actor.userId,
      }).catch((e) => console.warn('[notify event invite]', e.message));
    }
  } catch (e) { console.warn('[notify event invite outer]', e.message); }

  // socket — business room (Q Calendar 페이지가 듣는다). CLAUDE.md §16.
  const io = getIO();
  if (io) {
    const data = full.toJSON();
    io.to(`business:${businessId}`).emit('event:created', data);
  }

  // 표시명 적용은 라우트가 응답 직전에 하지 않는다 — 옛 라우트도 안 했다(생성 응답은 raw). 무변경.
  return done({ event, full });
}

module.exports = { createEvent };
