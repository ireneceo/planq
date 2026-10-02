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

async function assertMenu(p, menu, level) {
  const { getMemberMenuLevels } = require('../../../middleware/menu_permission');
  const lv = await getMemberMenuLevels(p.businessId, p.userId);
  if (!lv || lv.role === 'owner' || lv.role === 'admin') return;
  const v = lv.menus[menu] || 'write';
  if (v === 'none' || (level === 'write' && v !== 'write')) throw err('PERMISSION_DENIED', `menu_${level === 'write' ? 'read_only' : 'hidden'}:${menu}`);
}

function parseIso(s, field) {
  const d = new Date(String(s || ''));
  if (Number.isNaN(d.getTime())) throw err('VALIDATION_ERROR', 'invalid_datetime', { fields: { [field]: s } });
  return d;
}

const eventItem = (e) => ({
  event_id: e.id,
  title: e.title,
  start_at: iso(e.start_at),
  end_at: iso(e.end_at),
  all_day: !!e.all_day,
  location: e.location || null,
  project: e.Project ? { project_id: e.Project.id, name: e.Project.name } : null,
  meeting_url: e.meeting_url || null,
  recurring: !!e.rrule,
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
  if (!base) return { items: [], total: 0, truncated: false };
  const rows = await CalendarEvent.findAll({
    where: { [Op.and]: [base, { business_id: p.businessId }, { [Op.or]: [
      { start_at: { [Op.lt]: to }, end_at: { [Op.gt]: from } },
      { rrule: { [Op.ne]: null }, start_at: { [Op.lt]: to } },   // 반복 원본은 시작이 범위 전이어도 걸린다
    ] }] },
    include: [{ model: Project, attributes: ['id', 'name'], required: false }],
    order: [['start_at', 'ASC']], limit: 101,
  });
  const items = rows.slice(0, 100).map(eventItem);
  return { items, total: items.length, truncated: rows.length > 100, note: 'recurring events are returned once (not expanded)' };
}

// ── create_event ───────────────────────────────────────────
async function createEvent(p, a, actor) {
  const start = parseIso(a.start_at, 'start_at');
  const end = parseIso(a.end_at, 'end_at');
  if (end < start) throw err('VALIDATION_ERROR', 'end_before_start');
  const eventActions = require('../../actions/event_actions');
  const r = await eventActions.createEvent(actor, {
    businessId: p.businessId,
    title: a.title,
    description: a.description || null,
    location: a.location || null,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    allDay: !!a.all_day,
    projectId: a.project_id || null,
    // 기본은 나만 보기 — AI 가 만든 일정을 팀 전체에 바로 뿌리지 않는다. 팀 공개는 사용자가 말했을 때만.
    visibility: a.visibility === 'team' ? 'business' : 'personal',
    vlevel: a.visibility === 'team' ? 'L3' : 'L1',
    category: 'work',
    createdVia: 'agent',
  });
  if (!r.ok) throw fromActionFailure(r);
  const ev = r.data?.event || r.data;
  const { CalendarEvent, Project } = require('../../../models');
  const full = await CalendarEvent.findOne({ where: { id: ev.id, business_id: p.businessId }, include: [{ model: Project, attributes: ['id', 'name'], required: false }] });
  return { event: eventItem(full), created: true };
}

module.exports = { listEvents, createEvent };
