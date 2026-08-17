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
const calendarSync = require('../calendarSync');

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

  // #126 보안 — 개인(L1)·팀비공개(L2)·personal 일정은 워크스페이스 gcal(owner primary) push 대상 제외(유출 차단).
  //   Meet 자동발급도 워크스페이스 gcal 에 이벤트를 만들므로, 개인 일정엔 발급 금지(조용한 유출 대신 명시적 거부).
  const evVisibility = VISIBILITY_SET.has(params.visibility) ? params.visibility : 'business';
  const evVlevel = ['L1', 'L2', 'L3', 'L4'].includes(params.vlevel) ? params.vlevel : null;
  const isPrivateEvt = gcal.isPrivateForGcal({ visibility: evVisibility, vlevel: evVlevel });
  if (params.autoCreateMeeting && isPrivateEvt) return fail('cannot_create_meeting_for_private_event', 400);

  // ── Google Meet 자동 생성 — **트랜잭션 밖에서** 먼저 시도한다 (운영 피드백 #242, Fable 설계 게이트 2026-07-31).
  //   옛 구현은 이 블록을 tx 안에 두고 실패 시 `t.rollback()` + 502 로 **일정 생성을 통째로 되돌렸다**.
  //   그래서 워크스페이스 토큰에 캘린더 쓰기 권한이 없으면(운영 실사례) 사용자가 Meet 을 켠 순간
  //   일정이 아예 안 만들어졌다. 부가 기능이 본 기능을 죽인 것이다.
  //   같은 파일 아래 일반 push 는 원래부터 best-effort 였고, calendarSync.js 주석이 그 근거를 명시한다 —
  //   "구글 한 곳이 죽었다고 PlanQ 일정 저장을 되돌리면 사용자가 일을 못 한다." 정책을 그쪽으로 통일한다.
  //   실패는 삼키지 않는다: meetWarning 코드를 응답에 실어 프론트가 "일정은 저장됐지만 링크 실패" 를 알린다.
  //   (구글 네트워크 I/O 동안 tx 를 잡고 있던 기존 냄새도 같이 해소된다.)
  let finalMeetingUrl = params.meetingUrl?.trim() || null;
  let finalMeetingProvider = PROVIDER_SET.has(params.meetingProvider) ? params.meetingProvider : null;
  let finalGcalEventId = null;
  let meetWarning = null;
  //   ★ 소스는 **개인 연동 우선 → 워크스페이스 폴백**(calendarSync.resolveMeetSource).
  //     옛 코드는 워크스페이스 토큰만 봐서, 개인 연동만 한 직원은 Meet 을 만들 수 없었고
  //     만들어진 회의의 호스트는 항상 owner 였다.
  let meetSource = null;
  let meetGcalEventId = null;
  if (params.autoCreateMeeting) {
    meetSource = await calendarSync.resolveMeetSource({ businessId, userId: subjectId });
    if (!meetSource.kind) {
      // 권한이 없는 게 이미 확인되면 구글을 부르지 않는다 — 어차피 403 이고, 헛 왕복만 남는다.
      meetWarning = meetSource.reason;
    } else {
      try {
        const meeting = await calendarSync.createMeeting(meetSource, {
          title,
          summary: title,
          description: params.description?.trim() || null,
          location: params.location?.trim() || null,
          startAt: sd,
          endAt: ed,
          rrule: params.rrule?.trim() || null,
        });
        if (meeting?.meetUrl) {
          finalMeetingUrl = meeting.meetUrl;
          finalMeetingProvider = 'google_meet';
          meetGcalEventId = meeting.id || null;
          // 옛 단일 컬럼(gcal_event_id)은 **워크스페이스 축**이다(calendarSync 가 workspace 링크에만
          // 채운다). 개인 캘린더에 만든 회의를 여기에 넣으면 삭제·오버레이 경로가 엉뚱한 캘린더를 본다.
          if (meetSource.kind === 'workspace') finalGcalEventId = meetGcalEventId;
        }
      } catch (e) {
        console.error('[createMeeting]', e.message);
        await calendarSync.recordMeetError(meetSource, e);   // 설정 화면에 재연결 필요 표시
        meetSource = null;
        meetWarning = 'gcal_meeting_create_failed';
      }
    }
  }

  const t = await sequelize.transaction();
  let event;
  try {
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
      visibility: evVisibility,
      vlevel: evVlevel,
      // 일정 단위 구글 연동 체크 — 팀/개인 각각, 기본 ON ("디폴트는 다 연동 체크" 유지).
      gcal_sync_workspace: params.gcalSyncWorkspace === undefined ? true : !!params.gcalSyncWorkspace,
      gcal_sync_personal: params.gcalSyncPersonal === undefined ? true : !!params.gcalSyncPersonal,
      target_member_ids: Array.isArray(params.targetMemberIds) ? params.targetMemberIds.map(Number).filter(Boolean) : null,
      target_client_ids: Array.isArray(params.targetClientIds) ? params.targetClientIds.map(Number).filter(Boolean) : null,
      created_by: subjectId,
      created_via: params.createdVia || null,   // provenance 표시 전용(예: 'cue')
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

  // ── PlanQ → Google Calendar push (일반 일정) — 워크스페이스 gcal 연동 시. Meet 은 위에서 이미 push.
  //   best-effort: Google 실패해도 PlanQ 일정은 유지(이미 커밋). gcal_event_id 저장 → 오버레이 중복 차단·수정/삭제 동기화 연결.
  //   #126 보안 — 개인(L1)·팀 비공개(L2)·personal 일정은 push 금지(owner 구글캘린더 유출 차단).
  // 목적지 결정(팀/개인)·토글·권한은 전부 services/calendarSync 단일 착지점에 있다.
  //
  // ★ Meet 으로 만든 구글 이벤트를 **링크 테이블에 먼저 등록**한다(event.id 가 필요해 커밋 후).
  //   등록하면 아래 reconcile 이 그 목적지를 "이미 있음" 으로 보고 insert 대신 update 한다.
  //   옛 코드는 링크를 안 만들고 `if (!finalGcalEventId)` 로 reconcile 자체를 건너뛰었는데,
  //   그 결과 ① Meet 을 켜면 **개인 캘린더 동기화가 통째로 죽었고**(워크스페이스에만 올라갔다)
  //   ② 다음 수정 때 reconcile 이 워크스페이스에 **두 번째 이벤트를 만들어** Meet 사본이 고아가 됐다.
  //   링크를 만들면 두 문제가 동시에 사라지므로 게이트를 제거하고 항상 reconcile 한다.
  if (meetSource && meetSource.kind && meetGcalEventId) {
    try {
      await calendarSync.linkMeeting(event.id, meetSource, meetGcalEventId, businessId);
    } catch (e) {
      console.warn('[linkMeeting create]', e.message);
    }
  }
  try {
    const r = await calendarSync.reconcile(event, { businessId, userId: actor.userId || event.created_by });
    if (r.errors.length) console.warn('[calendarSync create]', JSON.stringify(r.errors).slice(0, 300));
  } catch (e) {
    // best-effort: Google 실패해도 PlanQ 일정은 유지(이미 커밋). 조용히 넘기지는 않는다.
    console.warn('[calendarSync create] reconcile 실패:', e.message);
  }

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
        titleSpec: { feature: 'calendar', action: 'calendar_invite', subject: event.title }, body: `"${event.title}"${startStr ? ` · ${startStr}` : ''}`,
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
  // meetWarning — Meet 링크만 실패한 경우. 일정 생성은 성공(201)이고, 프론트가 이 코드로 경고를 띄운다.
  return done({ event, full, meetWarning });
}

module.exports = { createEvent };
