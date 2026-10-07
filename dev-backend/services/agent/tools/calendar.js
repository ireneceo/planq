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
    createdVia: 'agent',
  });
  if (!r.ok) throw fromActionFailure(r);
  const ev = r.data?.event || r.data;
  const { CalendarEvent, Project } = require('../../../models');
  const full = await CalendarEvent.findOne({ where: { id: ev.id, business_id: p.businessId }, include: [{ model: Project, attributes: ['id', 'name'], required: false }] });
  return { event: eventItem(full), created: true };
}

module.exports = { listEvents, createEvent };
