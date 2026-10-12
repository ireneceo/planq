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
  let sd = parseDate(params.startAt);
  let ed = parseDate(params.endAt);
  if (!sd || !ed) return fail('start_at and end_at are required');
  if (ed < sd) return fail('end_at must be after start_at');
  // 종일은 날짜다 — UTC 자정 부호화로 한 번 정한다(utils/allDayDate · docs/ALLDAY_EVENT_DATE_DESIGN.md).
  //   화면(기기 자정)·AI(오프셋)·음성·옛 번들이 무엇을 보내도 같은 날짜가 된다. 원문 문자열을 넘겨 «쓴 날짜» 를 살린다.
  if (params.allDay) {
    const norm = require('../../utils/allDayDate').normalizeAllDay(params.startAt, params.endAt);
    if (!norm) return fail('start_at and end_at are required');
    sd = norm.start_at; ed = norm.end_at;
  }

  // project_id — 같은 business 여야 함
  let projectId = null;
  if (params.projectId) {
    const prj = await Project.findOne({ where: { id: params.projectId, business_id: businessId } });
    if (!prj) return fail('invalid_project');
    projectId = prj.id;
  }
  // task_id — 같은 business + 만드는 사람이 열 수 있는 업무만(services/eventTaskLink — 수정 라우트와 같은 함수)
  const taskLink = await require('../eventTaskLink').resolveTaskLink(subjectId, businessId, params.taskId);
  if (!taskLink.ok) return fail(taskLink.code);

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

  // ★ 지정 수신자는 **이 워크스페이스 소속**만 남긴다. 클라이언트가 준 정수를 그대로 저장하면
  //   알림이 다른 워크스페이스 사람에게 나간다(Fable 게이트 2026-09-05 F1 실측).
  //   판정은 middleware/access_scope 한 곳 — 수정 라우트·알림 크론도 같은 함수를 부른다.
  const { filterWorkspaceMemberIds } = require('../../middleware/access_scope');
  const targetMemberIds = Array.isArray(params.targetMemberIds)
    ? await filterWorkspaceMemberIds(businessId, params.targetMemberIds)
    : null;

  const t = await sequelize.transaction();
  let event;
  try {
    event = await CalendarEvent.create({
      business_id: businessId,
      project_id: projectId,
      task_id: taskLink.skip ? null : taskLink.taskId,
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
      // ★ 기본값 **1일 전**(2026-09-05). 여태 기본이 없어서 운영 일정 20건 중 3건만 알림이 켜져
      //   있었고 **알림이 한 번도 나간 적이 없다**(Fable 실측). 만드는 사람이 매번 고르게 두면
      //   아무도 안 고른다 — 기본을 켜고, 끄고 싶으면 끄게 한다.
      //   ★ `null` 은 **사용자가 고른 "알림 없음"** 이다(드로어가 그렇게 보낸다). undefined(값을 안 보냄)
      //     와 구분해야 해서 모델 defaultValue 를 쓰지 않는다 — 모델에 두면 그 구분이 사라진다.
      reminder_minutes: params.reminderMinutes === undefined
        ? 1440
        : (Number.isFinite(Number(params.reminderMinutes)) && Number(params.reminderMinutes) > 0
          ? Math.min(10080, Number(params.reminderMinutes))  // max 1주 (7 * 24 * 60)
          : null),
      visibility: evVisibility,
      vlevel: evVlevel,
      // 일정 단위 구글 연동 체크 — 팀/개인 각각, 기본 ON ("디폴트는 다 연동 체크" 유지).
      gcal_sync_workspace: params.gcalSyncWorkspace === undefined ? true : !!params.gcalSyncWorkspace,
      gcal_sync_personal: params.gcalSyncPersonal === undefined ? true : !!params.gcalSyncPersonal,
      target_member_ids: targetMemberIds,
      target_client_ids: Array.isArray(params.targetClientIds) ? params.targetClientIds.map(Number).filter(Boolean) : null,
      created_by: subjectId,
      created_via: params.createdVia || null,   // provenance 표시 전용(예: 'cue')
      //   ★ 외부 AI 앱(MCP 에이전트)이 만든 것은 'agent' — 옛: null 이라 화면이 사람이 만든 것과 구분 못 했다(0-J).
      ...(params.createdVia ? {} : (actor?.channel?.kind === 'agent' ? { created_via: 'agent' } : {})),
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

    // 미팅자료(#411) — 파일 또는 문서를 **가리키기만** 한다. 바이트는 복사하지 않는다.
    //   ★ 참석자와 **같은 방식으로 워크스페이스 축을 검증한다** — 남의 워크스페이스 파일·문서를
    //     일정에 붙이면 그 일정을 보는 사람에게 남의 자료가 새는 문이 된다.
    //     «id 를 받았으니 붙인다» 가 아니라 «이 워크스페이스 것인가» 를 DB 에 되묻는다.
    //   판정은 services/eventAttachments 한 곳 — 상세에서 붙이는 문(routes/calendar_materials.js)과 같은 함수.
    const arows = await require('../eventAttachments').attachableRows({
      atts: params.attachments, businessId, userId: subjectId, eventId: event.id, transaction: t,
    });
    if (arows.length) {
      const { CalendarEventAttachment } = require('../../models');
      await CalendarEventAttachment.bulkCreate(arows, { transaction: t });
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

  // 알림 — 참석자(멤버 + 계정 있는 고객, 본인 제외)에게 초대 알림. 받는 사람·보내는 일은 services/eventNotify 한 곳(#462).
  //   사람이 «참석자에게 알림 보내기» 를 끄면(params.notify.send === false) 보내지 않는다. 고르지 않으면(옛 화면·AI) 보낸다.
  try {
    if (!params.notify || params.notify.send !== false) {
      await require('../eventNotify').sendInvite({
        event: full, businessId, actorUserId: actor.userId || subjectId, message: params.notify?.message || null,
      });
    }
  } catch (e) { console.warn('[notify event invite]', e.message); }

  // socket — business room (Q Calendar 페이지가 듣는다). CLAUDE.md §16.
  const io = getIO();
  if (io) {
    // 신호만(id·소속) — 행 전체를 방에 뿌리면 «나만 보기» 일정의 설명·미팅자료가 전원에게 갔다(2026-09-27 점검).
    io.to(`business:${businessId}`).emit('event:created', { id: full.id, business_id: full.business_id, project_id: full.project_id || null });
  }

  // 표시명 적용은 라우트가 응답 직전에 하지 않는다 — 옛 라우트도 안 했다(생성 응답은 raw). 무변경.
  // 업무 «결과물 액션» 에서 왔으면 그 액션에 건다 — 판정은 taskActionItems.fulfill 한 곳(담당자·같은 워크스페이스·볼 수 있는 일정).
  //   실패해도 일정은 이미 만들어졌다 — warnings 로 화면에 알린다.
  const warnings = [];
  if (params.fromActionId) {
    const r = await require('../taskActionItems').fulfill(
      { userId: subjectId, platformRole: subj.platformRole, req: actor.req },
      { actionId: params.fromActionId, businessId, entityType: 'calendar_event', entityId: event.id, source: 'create' },
    ).catch((e) => { console.warn('[event_actions.fromAction]', e.message); return { ok: false, code: 'error' }; });
    if (!r.ok) warnings.push('action_link_failed');
  }
  // meetWarning — Meet 링크만 실패한 경우. 일정 생성은 성공(201)이고, 프론트가 이 코드로 경고를 띄운다.
  return done({ event, full, meetWarning, warnings });
}

/** 이미 있는 일정을 고친다 — Cue·외부 AI 의 «일정 수정» (2026-10-12, docs/CUE_REGISTRY_FOLD_DESIGN.md C).
 *
 *   화면의 수정(PUT /api/calendar/by-business/:biz/:id)과 **같은 판정**을 지난다:
 *     멤버(고객·AI 불가) · qcalendar 쓰기 · services/calendarPermission.canEditEvent(작성자 또는 owner/admin,
 *     남의 «나만 보기» 불가) · 종일은 날짜 부호화 · 시간이 바뀌면 알림 발송 기록 리셋 · 감사 event.updated ·
 *     구글 반영(calendarSync.reconcile) · 신호만 방송.
 *   ★ 상담 예약은 시간을 여기서 바꾸지 않는다(409 booking_use_actions) — 제목·메모 같은 우리 쪽 정리는 된다(PUT 과 같다).
 *   ★ 반복 일정 원본은 고치지 않는다(409 recurring_use_calendar) — 회차 하나/이후/전체 범위는 화면의 물음이 정한다.
 *   ★ 시간·장소가 실제로 바뀌면 기존 참석자에게 변경 알림을 보낸다(services/eventNotify — 화면에서 «보내기» 를 고른 수정과 같다).
 *     사람이 카드에서 확인했으므로 기본은 보낸다. params.notify === false 면 보내지 않는다.
 *   참석자·공개 범위·반복은 이 문으로 바꾸지 않는다(2차 — 일정 PUT 전체를 행동 계층으로 옮길 때).
 *
 * @param params { businessId, eventId, title?, description?, location?, category?, reminderMinutes?, startAt?, endAt?, meetingUrl?, notify?, via? }
 */
async function updateEvent(actor, params = {}) {
  const subj = await resolveSubject(actor);
  if (!subj.ok) return subj;
  const subjectId = subj.subjectId;
  const businessId = Number(params.businessId);
  if (!businessId) return fail('business_id required');

  const bm = await BusinessMember.findOne({ where: { user_id: subjectId, business_id: businessId } });
  if (!bm || bm.role === 'ai' || bm.role === 'client') return fail('forbidden', 403);
  const menu = await assertMenuWrite(subjectId, businessId, 'qcalendar', subj.platformRole);
  if (!menu.ok) return menu;

  const event = await CalendarEvent.findOne({ where: { id: Number(params.eventId) || 0, business_id: businessId } });
  if (!event) return fail('event_not_found', 404);
  const calendarPermission = require('../calendarPermission');
  if (!calendarPermission.canEditEvent(event, bm, subjectId)) {
    return fail(calendarPermission.editDenyReason(event, bm, subjectId), 403);
  }
  if (event.rrule && !event.recurrence_parent_id) return fail('recurring_use_calendar', 409);
  const timeChange = params.startAt !== undefined || params.endAt !== undefined;
  if (event.booking_status && timeChange) return fail('booking_use_actions', 409);

  const updates = {};
  if (params.title !== undefined) {
    const title = String(params.title || '').trim();
    if (!title) return fail('title is required');
    updates.title = title.slice(0, 300);
  }
  if (params.description !== undefined) updates.description = params.description ? String(params.description).trim() || null : null;
  if (params.location !== undefined) updates.location = params.location ? String(params.location).trim() || null : null;
  if (params.category !== undefined) {
    if (!CATEGORY_SET.has(params.category)) return fail('invalid category');
    updates.category = params.category;
  }
  if (params.meetingUrl !== undefined) {
    updates.meeting_url = params.meetingUrl ? String(params.meetingUrl).trim() : null;
    updates.meeting_provider = updates.meeting_url ? 'manual' : null;
  }
  if (params.reminderMinutes !== undefined) {
    const v = Number(params.reminderMinutes);
    updates.reminder_minutes = Number.isFinite(v) && v > 0 ? Math.min(10080, v) : null;
    updates.reminder_sent_at = null;
  }
  if (timeChange) {
    let sd = params.startAt !== undefined ? parseDate(params.startAt) : event.start_at;
    let ed = params.endAt !== undefined ? parseDate(params.endAt) : event.end_at;
    if (!sd || !ed) return fail('invalid_dates');
    if (ed < sd) return fail('end_at must be after start_at');
    if (event.all_day) {
      const norm = require('../../utils/allDayDate').normalizeAllDay(
        params.startAt !== undefined ? params.startAt : event.start_at,
        params.endAt !== undefined ? params.endAt : event.end_at);
      if (!norm) return fail('invalid_dates');
      sd = norm.start_at; ed = norm.end_at;
    }
    updates.start_at = sd; updates.end_at = ed; updates.reminder_sent_at = null;
  }
  // 업무 연결 — 화면 수정 라우트(PUT /calendar)·만들기와 같은 판정 한 곳(services/eventTaskLink)
  if (params.taskId !== undefined) {
    const link = await require('../eventTaskLink').resolveTaskLink(subjectId, businessId, params.taskId);
    if (!link.ok) return fail(link.code || 'invalid_task');
    if (!link.skip) updates.task_id = link.taskId;
  }
  if (!Object.keys(updates).length) return fail('no_fields');

  const eventNotify = require('../eventNotify');
  const beforeSnap = { start_at: event.start_at, end_at: event.end_at, all_day: event.all_day, location: event.location };
  const priorIds = await eventNotify.recipientIdSet(event, subjectId);
  const oldValue = { title: event.title, start_at: event.start_at, end_at: event.end_at, location: event.location };
  await event.update(updates);

  await createAuditLog({
    user_id: subjectId,
    business_id: businessId,
    action: 'event.updated',
    target_type: 'calendar_event',
    target_id: event.id,
    old_value: oldValue,
    new_value: { ...updates, via: params.via || (actor.kind === 'cue' ? 'cue' : actor?.channel?.kind || 'user') },
    ip_address: actor.req?.ip || null,
  });
  try {
    const r = await calendarSync.reconcile(event, { businessId, userId: subjectId });
    if (r.errors.length) console.warn('[calendarSync updateEvent]', JSON.stringify(r.errors).slice(0, 300));
  } catch (e) { console.warn('[calendarSync updateEvent] reconcile 실패:', e.message); }

  const full = await CalendarEvent.findByPk(event.id, { include: INCLUDE_DETAIL });
  let notified = 0;
  if (params.notify !== false && eventNotify.scheduleChanged(beforeSnap, full)) {
    try {
      notified = await eventNotify.sendChange({ event: full, before: beforeSnap, businessId, actorUserId: subjectId, message: null, priorIds, ioApp: actor.req?.app || null });
      if (notified) createAuditLog({ user_id: subjectId, business_id: businessId, action: 'event.change_notified', target_type: 'calendar_event', target_id: event.id, new_value: { recipients: notified }, ip_address: actor.req?.ip || null });
    } catch (e) { console.warn('[notify event update]', e.message); }
  }

  const io = getIO();
  if (io) io.to(`business:${businessId}`).emit('event:updated', { id: event.id, business_id: event.business_id, project_id: event.project_id || null });
  return done({ event, full, old: oldValue, notified });
}

/** 시간만 옮긴다 — updateEvent 의 시간 부분(Cue «일정 옮기기» 여러 건). 판정·알림·감사는 updateEvent 와 같다. */
async function rescheduleEvent(actor, params = {}) {
  return updateEvent(actor, { businessId: params.businessId, eventId: params.eventId, startAt: params.startAt, endAt: params.endAt, via: params.via, notify: params.notify });
}

/** 이미 있는 일정에 Google Meet 을 만든다(또는 다시 만든다) — 화면 [Meet 만들기](POST /:id/meeting)와 Cue·외부 AI 가 같은 함수.
 *   소스는 일정 작성자의 개인 연동 우선 → 워크스페이스 폴백(calendarSync.resolveMeetSource, 목적지 축과 같다).
 *   ★ 개인(L1·L2) 일정을 워크스페이스(=오너 캘린더) 소스로 만들지 않는다 — 새 일정 만들기와 같은 #126 규칙.
 */
async function addMeeting(actor, params = {}) {
  const subj = await resolveSubject(actor);
  if (!subj.ok) return subj;
  const subjectId = subj.subjectId;
  const businessId = Number(params.businessId);
  const bm = await BusinessMember.findOne({ where: { user_id: subjectId, business_id: businessId } });
  if (!bm || bm.role === 'ai' || bm.role === 'client') return fail('forbidden', 403);
  const event = await CalendarEvent.findOne({ where: { id: Number(params.eventId) || 0, business_id: businessId } });
  if (!event) return fail('event_not_found', 404);
  const calendarPermission = require('../calendarPermission');
  if (!calendarPermission.canEditEvent(event, bm, subjectId)) {
    return fail(calendarPermission.editDenyReason(event, bm, subjectId), 403);
  }
  const meetSource = await calendarSync.resolveMeetSource({ businessId, userId: event.created_by || subjectId });
  if (!meetSource.kind) return fail(meetSource.reason, 400);
  if (meetSource.kind === 'workspace' && gcal.isPrivateForGcal({ visibility: event.visibility, vlevel: event.vlevel })) {
    return fail('cannot_create_meeting_for_private_event', 400);
  }
  if (params.previewOnly) return done({ event, meetSource: meetSource.kind });

  let meeting;
  try {
    meeting = await calendarSync.createMeeting(meetSource, {
      title: event.title, summary: event.title, description: event.description, location: event.location,
      startAt: event.start_at, endAt: event.end_at, rrule: event.rrule || undefined,
    });
  } catch (e) {
    console.error('[addMeeting]', e.message);
    await calendarSync.recordMeetError(meetSource, e);
    return fail('gcal_meeting_create_failed', 502);
  }
  if (!meeting?.meetUrl) return fail('meet_url_not_returned', 502);

  // 옛 회의 정리 — 소스 불문 기존 Meet 링크 + 링크가 관리하지 않는 옛 단일 컬럼만(팀 동기화 사본은 건드리지 않는다).
  let cleared = [];
  try { cleared = await calendarSync.clearMeetings(event.id, businessId); } catch (e) { console.warn('[clearMeetings]', e.message); }
  const { CalendarEventGcalLink } = require('../../models');
  const managedWs = await CalendarEventGcalLink.findOne({ where: { event_id: event.id, target: 'workspace' } });
  const legacyOrphan = event.gcal_event_id
    && event.gcal_event_id !== meeting.id
    && !cleared.some((c) => c.gcal_event_id === event.gcal_event_id)
    && !(managedWs && managedWs.gcal_event_id === event.gcal_event_id);
  if (legacyOrphan) {
    try {
      const oldToken = await gcal.getTokenForBusiness(businessId);
      if (oldToken && gcal.hasWriteScope(oldToken.scope)) await gcal.deleteEvent(await gcal.getCalendarClient(oldToken), event.gcal_event_id, { calendarId: 'primary' });   // 링크 없는 옛 사본 = 늘 primary
    } catch (e) { console.warn('[gcal cleanup old event]', e.message); }
  }
  await event.update({
    meeting_url: meeting.meetUrl,
    meeting_provider: 'google_meet',
    gcal_event_id: meetSource.kind === 'workspace' ? (meeting.id || null) : (managedWs ? managedWs.gcal_event_id : null),
  });
  try { await calendarSync.linkMeeting(event.id, meetSource, meeting.id, businessId); } catch (e) { console.warn('[linkMeeting addMeeting]', e.message); }
  await createAuditLog({
    user_id: subjectId, business_id: businessId, action: 'event.meeting_created',
    target_type: 'calendar_event', target_id: event.id,
    new_value: { meeting_url: meeting.meetUrl, meeting_provider: 'google_meet' }, ip_address: actor.req?.ip || null,
  });
  const full = await CalendarEvent.findByPk(event.id, { include: INCLUDE_DETAIL });
  const io = getIO();
  if (io) io.to(`business:${businessId}`).emit('event:updated', { id: event.id, business_id: event.business_id, project_id: event.project_id || null });
  return done({ event, full, meetSource: meetSource.kind });
}

module.exports = { createEvent, updateEvent, rescheduleEvent, addMeeting };
