// AI 에이전트 도구 — 일정 (#439 M2-a, 설계 §6.3).
//
//   읽기는 캘린더 화면과 같은 술어(access_scope.calendarListWhere), 생성은 행동 계층(event_actions.createEvent)만.
//   ★ 참석자 지정은 두지 않는다 — 참석자에게 초대 알림이 나가므로 MEDIUM 이고, M2-b 에서 확인 2단계와 같이 연다.
//   ★ 반복 일정은 전개하지 않는다 — 원본 1건을 recurring:true 로 돌려준다(전개는 캘린더 라우트 안에 있어 아직 함수가 아니다).
const { Op } = require('sequelize');
const cfg = require('../../agent_oauth/config');
const { err, fromActionFailure } = require('../errors');

const iso = (v) => (v ? new Date(v).toISOString() : null);
const MAX_DAYS = 62;

// 메뉴 Layer 판정은 services/agent/menu 한 벌.
const { assertMenu } = require('../menu');
const DESC_MAX = 1000;
const { allDayDates, allDayRange, allDayLastDateOf } = require('../../../utils/allDayDate');

function parseIso(s, field) {
  const d = new Date(String(s || ''));
  if (Number.isNaN(d.getTime())) throw err('VALIDATION_ERROR', 'invalid_datetime', { fields: { [field]: s } });
  return d;
}

const eventItem = (e, withDesc = false) => ({
  event_id: e.id,
  title: e.title,
  start_at: iso(e.start_at),
  end_at: iso(e.end_at),
  all_day: !!e.all_day,
  // 종일은 날짜로도 준다 — start_at(UTC 자정)을 모델이 사용자 시간대로 바꾸면 «전날» 이라고 말한다(utils/allDayDate)
  ...(e.all_day ? (() => { const d = allDayDates(e); return { date: d.date, end_date: d.last_date }; })() : {}),
  location: e.location || null,
  project: e.Project ? { project_id: e.Project.id, name: e.Project.name } : null,
  meeting_url: e.meeting_url || null,
  recurring: !!e.rrule,
  ...(withDesc ? { description: e.description ? String(e.description).slice(0, DESC_MAX) : null, truncated_fields: e.description && String(e.description).length > DESC_MAX ? ['description'] : [] } : {}),
  url: `${cfg.APP_URL}/calendar?event=${e.id}`,
});

// ── list_events ────────────────────────────────────────────
async function listEvents(p, a) {
  await assertMenu(p, 'qcalendar', 'read');
  const from = parseIso(a.from, 'from');
  const to = parseIso(a.to, 'to');
  if (to <= from) throw err('VALIDATION_ERROR', 'to_before_from');
  if ((to - from) / 86400000 > MAX_DAYS) throw err('VALIDATION_ERROR', `range_over_${MAX_DAYS}_days`);
  const { CalendarEvent, Project } = require('../../../models');
  const { getUserScope, calendarListWhere } = require('../../../middleware/access_scope');
  const scope = await getUserScope(p.userId, p.businessId, p.platformRole);
  const base = await calendarListWhere(p.userId, p.businessId, scope);
  const empty = { items: [], total: 0, has_more: false, next_page: null, truncated: false };
  if (!base) return empty;
  const conds = [base, { business_id: p.businessId }, { [Op.or]: [
    { start_at: { [Op.lt]: to }, end_at: { [Op.gt]: from } },
    { rrule: { [Op.ne]: null }, start_at: { [Op.lt]: to } },   // 반복 원본은 시작이 범위 전이어도 걸린다
  ] }];
  // M3-a(설계 §4.3) — 프로젝트·고객·제목으로 좁히기. 고객은 참석자(client_id 로 저장된다)로 본다 — 이름 추측 없음.
  if (a.project_id) conds.push({ project_id: a.project_id });
  if (a.client_id) {
    const { CalendarEventAttendee } = require('../../../models');
    const att = await CalendarEventAttendee.findAll({ where: { client_id: a.client_id }, attributes: ['event_id'] });
    const ids = [...new Set(att.map((x) => x.event_id))];
    if (!ids.length) return empty;
    conds.push({ id: { [Op.in]: ids } });
  }
  const q = String(a.query || '').normalize('NFC').trim();
  if (q) conds.push({ title: { [Op.like]: `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` } });
  const rows = await CalendarEvent.findAll({
    where: { [Op.and]: conds },
    include: [{ model: Project, attributes: ['id', 'name'], required: false }],
    order: [['start_at', 'ASC'], ['id', 'ASC']], limit: 101,
  });
  // 날짜 범위가 곧 페이지다(62일 상한) — has_more 는 범위 안에서 100건을 넘을 때만. 다음은 범위를 좁혀 다시 부른다.
  const items = rows.slice(0, 100).map((e) => eventItem(e, !!a.include_description));
  const more = rows.length > 100;
  return { items, total: items.length, has_more: more, next_page: null, truncated: more, note: 'recurring events are returned once (not expanded). If has_more, call again with a narrower from/to range.' };
}

// ── create_event ───────────────────────────────────────────
async function createEvent(p, a, actor) {
  let start, end;
  if (a.all_day) {
    // 종일 입력 = 문자열 앞 10자(날짜)만. 시각·오프셋은 무시 — «쓴 날짜 그대로» 가 뜻이다
    //   (ChatGPT 는 `2026-10-08T00:00:00+09:00` 처럼 사용자 오프셋을 붙인다 → Date 로 읽으면 전날 15:00Z).
    const sd = /^\d{4}-\d{2}-\d{2}/.exec(String(a.start_at || ''));
    const ed = /^\d{4}-\d{2}-\d{2}/.exec(String(a.end_at || ''));
    if (!sd) throw err('VALIDATION_ERROR', 'invalid_date', { fields: { start_at: a.start_at } });
    if (!ed) throw err('VALIDATION_ERROR', 'invalid_date', { fields: { end_at: a.end_at } });
    // end 가 날짜(10자)면 마지막 날(포함). 시각이 붙어 있으면 반올림으로 읽는다 — ChatGPT 의 배타적 end
    //   (`다음날T00:00:00+09:00`)를 하루로 흡수한다(Fable 2026-10-07 권고 ①). 아무도 «포함» 을 T00:00 으로 쓰지 않는다.
    const endStr = String(a.end_at);
    const last = endStr.length === 10 ? ed[0] : (allDayLastDateOf(new Date(endStr), sd[0]) || ed[0]);
    if (last < sd[0]) throw err('VALIDATION_ERROR', 'end_before_start');
    ({ start_at: start, end_at: end } = allDayRange(sd[0], last));
  } else {
    start = parseIso(a.start_at, 'start_at');
    end = parseIso(a.end_at, 'end_at');
  }
  if (end < start) throw err('VALIDATION_ERROR', 'end_before_start');
  // M3-c 출처(설계 §6) — 일정 표에는 출처 칸이 없다 → 읽을 수 있는 메일·업무임을 확인한 뒤 설명 끝에 원본 링크 한 줄.
  //   프로젝트는 모델이 안 줬을 때만 그 스레드·업무의 프로젝트를 승계한다(PlanQ 가 건 연결).
  const { resolveSource, sourceLine } = require('./sources');
  const src = await resolveSource(p, a.source, ['mail', 'task']);
  let description = a.description || null;
  let projectId = a.project_id || null;
  if (src) {
    const line = await sourceLine(p, src.kind === 'mail' ? 'mail' : 'task', src.url);
    description = description ? `${description}\n\n${line}` : line;
    if (!projectId) projectId = (src.kind === 'mail' ? src.thread.project_id : src.task.project_id) || null;
  }
  const eventActions = require('../../actions/event_actions');
  const r = await eventActions.createEvent(actor, {
    businessId: p.businessId,
    title: a.title,
    description,
    location: a.location || null,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    allDay: !!a.all_day,
    projectId,
    // 기본은 나만 보기 — AI 가 만든 일정을 팀 전체에 바로 뿌리지 않는다. 팀 공개는 사용자가 말했을 때만.
    visibility: a.visibility === 'team' ? 'business' : 'personal',
    vlevel: a.visibility === 'team' ? 'L3' : 'L1',
    category: a.category || 'work',
    // 0 = 알림 없음(null), 생략 = 화면과 같은 기본(하루 전) — event_actions 가 undefined/null 을 구분한다
    ...(a.reminder_minutes !== undefined ? { reminderMinutes: a.reminder_minutes > 0 ? a.reminder_minutes : null } : {}),
    ...(a.task_id ? { taskId: a.task_id } : {}),
    ...(a.meeting_url ? { meetingUrl: a.meeting_url, meetingProvider: 'manual' } : {}),
    // 2026-10-12 — 참석자(이 워크스페이스 멤버·고객만 — 행동 계층이 다시 거른다) · Google Meet 자동 생성(화면 버튼과 같은 길)
    attendees: [
      ...(a.attendee_user_ids || []).map((user_id) => ({ user_id })),
      ...(a.attendee_client_ids || []).map((client_id) => ({ client_id })),
    ],
    autoCreateMeeting: !!a.create_meeting,
    createdVia: p.provider === 'cue' ? 'cue' : 'agent',
  });
  if (!r.ok) throw fromActionFailure(r);
  const ev = r.data?.event || r.data;
  const { CalendarEvent, Project } = require('../../../models');
  const full = await CalendarEvent.findOne({ where: { id: ev.id, business_id: p.businessId }, include: [{ model: Project, attributes: ['id', 'name'], required: false }] });
  // Meet 이 실패해도 일정은 만들어졌다 — 이유를 돌려준다(카드·모델이 «링크는 못 만들었다» 를 말한다)
  return { event: eventItem(full), created: true, ...(r.data?.meetWarning ? { meet_warning: r.data.meetWarning } : {}) };
}

// ─────────────────────────────────────────────
// 2026-10-12 Cue 범위 확장(docs/CUE_REGISTRY_FOLD_DESIGN.md C) — 참석자·Meet·일정 수정·Meet 추가·여러 건 옮기기.
//   쓰기는 전부 행동 계층(event_actions)으로. 이 파일은 읽기·미리보기만 한다(가드 agentsurface).
// ─────────────────────────────────────────────
async function workspaceTz(p) {
  const { Business } = require('../../../models');
  const biz = await Business.findByPk(p.businessId, { attributes: ['timezone'] });
  return biz?.timezone || 'Asia/Seoul';
}

/** 이 사람에게 **보이는** 일정 한 건 — 캘린더 목록과 같은 술어. 안 보이면 NOT_FOUND(있는지도 말하지 않는다). */
async function loadVisibleEvent(p, eventId) {
  const rows = await loadVisibleEvents(p, [eventId]);
  if (!rows.length) throw err('NOT_FOUND', 'event_not_found');
  return rows[0];
}
async function loadVisibleEvents(p, ids) {
  const { CalendarEvent } = require('../../../models');
  const { getUserScope, calendarListWhere } = require('../../../middleware/access_scope');
  const scope = await getUserScope(p.userId, p.businessId, p.platformRole);
  const base = await calendarListWhere(p.userId, p.businessId, scope);
  if (!base) return [];
  return CalendarEvent.findAll({ where: { [Op.and]: [base, { business_id: p.businessId }, { id: { [Op.in]: ids } }] } });
}

/** 옮기거나 고칠 수 없는 이유 — 실행(event_actions.updateEvent)과 같은 순서. null = 가능 */
async function editBlockReason(p, e, { timeChange = true } = {}) {
  const { BusinessMember } = require('../../../models');
  const bm = await BusinessMember.findOne({ where: { user_id: p.userId, business_id: p.businessId } });
  const { canEditEvent } = require('../../calendarPermission');
  if (!bm || !canEditEvent(e, bm, p.userId)) return 'only_creator_or_owner';
  if (e.rrule && !e.recurrence_parent_id) return 'recurring_use_calendar';
  if (timeChange && e.booking_status) return 'booking_use_actions';
  return null;
}

/** 참석자 이름 — 이 워크스페이스 멤버·고객만. 모르는 id 는 거절한다(행동 계층은 조용히 버리므로 미리보기가 말한다). */
async function attendeeNames(p, userIds = [], clientIds = []) {
  const { BusinessMember, Client, User } = require('../../../models');
  const { getMemberNameMap } = require('../../displayName');
  // 계정이 살아 있는 멤버만(참석자 행은 users 를 참조한다 — 고아 멤버십 행을 그대로 넘기면 저장이 깨진다)
  const members = userIds.length ? await BusinessMember.findAll({ where: { business_id: p.businessId, user_id: userIds, removed_at: null }, attributes: ['user_id', 'role'],
    include: [{ model: User, as: 'user', attributes: ['id', 'name'], required: true }] }) : [];
  const okUsers = members.filter((m) => m.role !== 'ai' && m.role !== 'client').map((m) => m.user_id);
  const clients = clientIds.length ? await Client.findAll({ where: { business_id: p.businessId, id: clientIds }, attributes: ['id', 'display_name', 'company_name', 'user_id'] }) : [];
  const unknown = [...userIds.filter((id) => !okUsers.includes(id)).map((id) => `user:${id}`), ...clientIds.filter((id) => !clients.some((c) => c.id === id)).map((id) => `client:${id}`)];
  if (unknown.length) throw err('VALIDATION_ERROR', 'unknown_attendees', { unknown, hint: 'Use search_members / search_clients for ids in this workspace.' });
  const nm = await getMemberNameMap(p.businessId, okUsers);
  return {
    members: okUsers.map((id) => ({ user_id: id, name: nm.get(id)?.name || nm.get(id)?.name_localized || members.find((m) => m.user_id === id)?.user?.name || `#${id}` })),
    clients: clients.map((c) => ({ client_id: c.id, name: c.display_name || c.company_name || `#${c.id}`, has_account: !!c.user_id })),
  };
}

async function meetSourceOf(p, userId) {
  const calendarSync = require('../../calendarSync');
  const src = await calendarSync.resolveMeetSource({ businessId: p.businessId, userId });
  return src.kind ? { source: src.kind } : { source: null, reason: src.reason };
}

/** create_event 미리보기 — 참석자·Meet 이 있으면 MEDIUM(알림이 나가고 구글 캘린더에 회의가 생긴다). */
async function previewCreateEvent(p, a) {
  await assertMenu(p, 'qcalendar', 'write');
  const who = await attendeeNames(p, a.attendee_user_ids || [], a.attendee_client_ids || []);
  const team = a.visibility === 'team';
  const warnings = [];
  let meet = null;
  if (a.create_meeting) {
    if (!team) throw err('VALIDATION_ERROR', 'meet_requires_team_visibility', { hint: 'Google Meet can only be created for team-visible events. Pass visibility "team" (show the user) or drop create_meeting.' });
    meet = await meetSourceOf(p, p.userId);
    if (!meet.source) warnings.push(`meet_unavailable:${meet.reason}`);
    else if (meet.source === 'workspace') warnings.push('meet_on_workspace_calendar');
  }
  const notifyMembers = who.members.filter((m) => m.user_id !== p.userId);
  return {
    event: { title: a.title, start_at: a.start_at, end_at: a.end_at, all_day: !!a.all_day, visibility: team ? 'team' : 'private', location: a.location || null },
    attendees: [...who.members.map((m) => m.name), ...who.clients.map((c) => c.name)],
    notified_count: notifyMembers.length + who.clients.filter((c) => c.has_account).length,
    meeting: meet ? { create: true, source: meet.source } : null,
    warnings,
  };
}

// ── update_event (MEDIUM) ──────────────────────────────────
function eventPatch(a) {
  return {
    ...(a.title !== undefined ? { title: a.title } : {}),
    ...(a.description !== undefined ? { description: a.description } : {}),
    ...(a.location !== undefined ? { location: a.location } : {}),
    ...(a.category !== undefined ? { category: a.category } : {}),
    ...(a.reminder_minutes !== undefined ? { reminderMinutes: a.reminder_minutes } : {}),
    ...(a.start_at !== undefined ? { startAt: a.start_at } : {}),
    ...(a.end_at !== undefined ? { endAt: a.end_at } : {}),
    ...(a.meeting_url !== undefined ? { meetingUrl: a.meeting_url } : {}),
    ...(a.task_id !== undefined ? { taskId: a.task_id } : {}),
  };
}
async function previewUpdateEvent(p, a) {
  await assertMenu(p, 'qcalendar', 'write');
  const e = await loadVisibleEvent(p, a.event_id);
  const patch = eventPatch(a);
  if (!Object.keys(patch).length) throw err('VALIDATION_ERROR', 'no_fields');
  const timeChange = a.start_at !== undefined || a.end_at !== undefined;
  const why = await editBlockReason(p, e, { timeChange });
  if (why) throw err(why === 'only_creator_or_owner' ? 'PERMISSION_DENIED' : 'CONFLICT', why);
  const eventNotify = require('../../eventNotify');
  const ids = await eventNotify.recipientIdSet(e, p.userId);
  const cur = { title: e.title, description: e.description || null, location: e.location || null, category: e.category || null,
    reminder_minutes: e.reminder_minutes ?? null, start_at: iso(e.start_at), end_at: iso(e.end_at), meeting_url: e.meeting_url || null };
  const keys = Object.keys(a).filter((k) => k in cur);
  const timeOrPlace = keys.some((k) => ['start_at', 'end_at', 'location'].includes(k));
  // 업무 연결 — 실행과 같은 판정(같은 워크스페이스 + 내가 열 수 있는 업무)을 카드 전에. 카드에는 번호 대신 제목.
  const link = {};
  if (a.task_id !== undefined) {
    const { resolveTaskLink } = require('../../eventTaskLink');
    const r = await resolveTaskLink(p.userId, p.businessId, a.task_id);
    if (!r.ok) throw err('VALIDATION_ERROR', r.code || 'invalid_task');
    const { Task } = require('../../../models');
    const titleOf = async (id) => (id ? { title: (await Task.findOne({ where: { id, business_id: p.businessId }, attributes: ['title'] }))?.title || `#${id}` } : null);
    link.before = { task_id: await titleOf(e.task_id) };
    link.after = { task_id: await titleOf(r.taskId) };
  }
  return {
    event: eventItem(e),
    before: { ...Object.fromEntries(keys.map((k) => [k, cur[k]])), ...(link.before || {}) },
    after: { ...Object.fromEntries(keys.map((k) => [k, a[k]])), ...(link.after || {}) },
    ...(timeOrPlace ? { notified_count: ids.size } : {}),
  };
}
async function updateEventTool(p, a, actor) {
  await assertMenu(p, 'qcalendar', 'write');
  const e = await loadVisibleEvent(p, a.event_id);
  const eventActions = require('../../actions/event_actions');
  const r = await eventActions.updateEvent(actor, { businessId: p.businessId, eventId: e.id, ...eventPatch(a), via: p.provider === 'cue' ? 'cue' : 'agent' });
  if (!r.ok) throw fromActionFailure(r);
  return { event: eventItem(r.data.full || r.data.event), updated: true, attendees_notified: r.data.notified || 0 };
}

// ── add_meeting_to_event (MEDIUM) ──────────────────────────
async function previewAddMeeting(p, a) {
  await assertMenu(p, 'qcalendar', 'write');
  const e = await loadVisibleEvent(p, a.event_id);
  const eventActions = require('../../actions/event_actions');
  const r = await eventActions.addMeeting({ kind: 'user', userId: p.userId, platformRole: p.platformRole }, { businessId: p.businessId, eventId: e.id, previewOnly: true });
  if (!r.ok) throw fromActionFailure(r);
  return { event: eventItem(e), meeting: { source: r.data.meetSource, replaces_existing: !!e.meeting_url } };
}
async function addMeetingTool(p, a, actor) {
  await assertMenu(p, 'qcalendar', 'write');
  const e = await loadVisibleEvent(p, a.event_id);
  const eventActions = require('../../actions/event_actions');
  const r = await eventActions.addMeeting(actor, { businessId: p.businessId, eventId: e.id });
  if (!r.ok) throw fromActionFailure(r);
  return { event: eventItem(r.data.full), meeting_url: r.data.full.meeting_url };
}

// ── reschedule_events (MEDIUM, 여러 건) ─────────────────────
async function previewRescheduleEvents(p, a) {
  await assertMenu(p, 'qcalendar', 'write');
  const tz = await workspaceTz(p);
  const { computeMove } = require('../../../utils/wallTime');
  const rows = await loadVisibleEvents(p, a.moves.map((m) => m.event_id));
  const byId = new Map(rows.map((e) => [e.id, e]));
  const eventNotify = require('../../eventNotify');
  const items = [];
  for (const m of a.moves) {
    const e = byId.get(m.event_id);
    if (!e) continue;   // 안 보이는 일정은 제목도 말하지 않는다
    const next = computeMove(e, m, tz);
    const why = await editBlockReason(p, e);
    items.push({
      event_id: e.id, title: e.title, all_day: !!e.all_day, date: m.date, ...(m.start_time ? { start_time: m.start_time } : {}),
      from_start: new Date(e.start_at).toISOString(), from_end: new Date(e.end_at).toISOString(),
      to_start: next.start_at.toISOString(), to_end: next.end_at.toISOString(),
      attendees_notified: (await eventNotify.recipientIdSet(e, p.userId)).size,
      ...(why ? { blocked: why } : {}),
    });
  }
  if (!items.length) throw err('NOT_FOUND', 'event_not_found');
  return { timezone: tz, items };
}
async function rescheduleEventsTool(p, a, actor) {
  await assertMenu(p, 'qcalendar', 'write');
  const tz = await workspaceTz(p);
  const { computeMove } = require('../../../utils/wallTime');
  const eventActions = require('../../actions/event_actions');
  const rows = await loadVisibleEvents(p, a.moves.map((m) => m.event_id));
  const byId = new Map(rows.map((e) => [e.id, e]));
  const moved = []; const failed = [];
  for (const m of a.moves) {
    const e = byId.get(m.event_id);
    if (!e) { failed.push({ event_id: m.event_id, code: 'event_not_found' }); continue; }
    const next = computeMove(e, m, tz);   // 새 시각은 서버가 다시 계산한다(카드가 보낸 값을 믿지 않는다)
    const r = await eventActions.rescheduleEvent(actor, { businessId: p.businessId, eventId: e.id, startAt: next.start_at.toISOString(), endAt: next.end_at.toISOString(), via: p.provider === 'cue' ? 'cue' : 'agent' });
    if (r.ok) moved.push(e.id); else failed.push({ event_id: e.id, code: r.code });
  }
  if (!moved.length) throw fromActionFailure({ code: failed[0]?.code || 'event_not_found', http: failed[0]?.code === 'event_not_found' ? 404 : 409 });
  return { moved_event_ids: moved, failed, event: { event_id: moved[0] } };
}

module.exports = {
  listEvents, createEvent, previewCreateEvent, previewUpdateEvent, updateEventTool, previewAddMeeting, addMeetingTool,
  previewRescheduleEvents, rescheduleEventsTool,
};
