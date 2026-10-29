// 업무 템플릿 «디테일» 한 곳 (2026-10-29, docs/TASK_TEMPLATE_DETAIL_DESIGN.md · Fable DESIGN-READY)
//   Irene: «템플릿은 디테일 다 가져가야지.»
//   · normalizeItemDetails  화면·AI 가 보낸 항목 칸을 저장 모양으로(저장 PUT 과 AI 고쳐 넣기가 같은 함수)
//   · collectTaskExtras     프로젝트 업무 → 템플릿 저장 때 태그 이름·결과물 액션·선행 연결(같은 템플릿 안)
//   · materializeItemExtras 템플릿 적용 → 만든 업무에 태그·액션·연결을 되살린다(/apply 와 ai-create/confirm 이 같이 부른다)
//   따라가지 않는 것: 검토자·검토 정책·지정 멤버·첨부·댓글·이력·공유·상태·진행률(복사 계약 — rules/backend-routes.md).
const { Op } = require('sequelize');

const VLEVELS = ['L2', 'L3', 'L4'];             // L1(나만 보기)은 템플릿에 담지 않는다
const SECURITY = ['general', 'internal', 'confidential'];
const ACTION_KINDS = ['doc', 'event', 'mail', 'project'];
const MAX_TAGS = 10;
const MAX_ACTIONS = 30;

const intOrNull = (v) => (v === null || v === undefined || v === '' ? null : (Number.isInteger(Number(v)) ? Number(v) : null));

// 날짜 칸 — start 가 null 이면 «날짜 없음»(기간도 null). start 가 있으면 0 이상, 기간은 0 이상(없으면 1).
function normalizeSchedule(it) {
  const s = intOrNull(it.start_offset_days);
  if (s === null) return { start_offset_days: null, duration_days: null };
  const d = intOrNull(it.duration_days);
  return { start_offset_days: Math.max(0, s), duration_days: d === null ? 1 : Math.max(0, d) };
}

function normalizeTagNames(v) {
  if (!Array.isArray(v)) return null;
  const out = [...new Set(v.map((x) => String(x || '').trim().slice(0, 30)).filter(Boolean))].slice(0, MAX_TAGS);
  return out.length ? out : null;
}

function normalizeActionItems(v) {
  if (!Array.isArray(v)) return null;
  const out = v
    .filter((a) => a && ACTION_KINDS.includes(a.kind) && String(a.label || '').trim())
    .slice(0, MAX_ACTIONS)
    .map((a) => ({ kind: a.kind, label: String(a.label).trim().slice(0, 200), note: a.note ? String(a.note).slice(0, 1000) : null }));
  return out.length ? out : null;
}

function normalizeDepends(v, selfIndex) {
  if (!Array.isArray(v)) return null;
  const out = [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n !== selfIndex))].slice(0, 10);
  return out.length ? out : null;
}

/** 템플릿 항목 칸(디테일) — 저장 PUT·AI 결과가 같은 규칙으로 정리된다. */
function normalizeItemDetails(it, selfIndex) {
  // 반복 규칙은 생성 경로와 같은 관문으로 — 거절되면 버린다(업무 생성이 어차피 거절한다).
  const rr = it.recurrence_rule ? require('./rruleFromRecurrence').sanitizeRRule(it.recurrence_rule) : null;
  return {
    ...normalizeSchedule(it),
    body: it.body ? String(it.body) : null,
    is_milestone: it.is_milestone === true || it.is_milestone === 1 || it.is_milestone === '1',
    category: it.category ? String(it.category).trim().slice(0, 100) || null : null,
    vlevel: VLEVELS.includes(it.vlevel) ? it.vlevel : 'L3',
    security_level: SECURITY.includes(it.security_level) ? it.security_level : 'general',
    recurrence_rule: rr && rr.rule ? rr.rule : null,
    tag_names: normalizeTagNames(it.tag_names),
    action_items: normalizeActionItems(it.action_items),
    depends_on_indexes: normalizeDepends(it.depends_on_indexes, selfIndex),
  };
}

/**
 * 프로젝트 업무들 → 템플릿 저장용 덧붙임(태그 이름·결과물 액션·같은 템플릿 안 연결).
 * @param {Task[]} tasks 템플릿에 담을 순서대로
 * @returns {Promise<Map<taskId, { tag_names, action_items, depends_on_indexes }>>}
 */
async function collectTaskExtras(tasks, businessId) {
  const { TaskTag, TaskTagLink, TaskActionItem, TaskLink } = require('../models');
  const ids = tasks.map((t) => t.id);
  const out = new Map(ids.map((id) => [id, { tag_names: null, action_items: null, depends_on_indexes: null }]));
  if (!ids.length) return out;
  const idxOf = new Map(ids.map((id, i) => [id, i]));

  const tagLinks = await TaskTagLink.findAll({ where: { task_id: { [Op.in]: ids } }, attributes: ['task_id', 'tag_id'] });
  const tagIds = [...new Set(tagLinks.map((l) => l.tag_id))];
  const tags = tagIds.length ? await TaskTag.findAll({ where: { id: { [Op.in]: tagIds }, business_id: businessId }, attributes: ['id', 'name'] }) : [];
  const tagName = new Map(tags.map((t) => [t.id, t.name]));
  for (const l of tagLinks) {
    const n = tagName.get(l.tag_id);
    if (!n) continue;
    const e = out.get(l.task_id);
    e.tag_names = [...(e.tag_names || []), n];
  }

  const actions = await TaskActionItem.findAll({
    where: { task_id: { [Op.in]: ids }, business_id: businessId },
    order: [['order_index', 'ASC'], ['id', 'ASC']],
    attributes: ['task_id', 'kind', 'label', 'note'],
  });
  for (const a of actions) {
    const e = out.get(a.task_id);
    e.action_items = [...(e.action_items || []), { kind: a.kind, label: a.label, note: a.note || null }];
  }

  // 연결은 양방향 — 같은 템플릿에 들어간 둘 사이만, 큰 번호 쪽이 작은 번호를 가리키게 한 번만 적는다.
  const links = await TaskLink.findAll({
    where: { task_a_id: { [Op.in]: ids }, task_b_id: { [Op.in]: ids } },
    attributes: ['task_a_id', 'task_b_id'],
  });
  for (const l of links) {
    const ia = idxOf.get(l.task_a_id);
    const ib = idxOf.get(l.task_b_id);
    if (ia === undefined || ib === undefined || ia === ib) continue;
    const [lo, hi] = ia < ib ? [ia, ib] : [ib, ia];
    const e = out.get(ids[hi]);
    e.depends_on_indexes = [...new Set([...(e.depends_on_indexes || []), lo])];
  }
  return out;
}

/**
 * 만든 업무에 태그·결과물 액션·연결을 되살린다. 실패는 업무 생성을 되돌리지 않는다(경고만).
 * @param {Array<{ task, item }>} pairs item.depends_on_indexes 는 같은 pairs 안의 itemIndex 를 가리킨다
 * @param {{ businessId:number, actorUserId:number, indexOf:(item)=>number }} ctx
 * @returns {Promise<{ links:number, tags:number, actions:number }>}
 */
async function materializeItemExtras(pairs, { businessId, actorUserId, indexOf }) {
  const { TaskTag, TaskTagLink, TaskActionItem, TaskLink } = require('../models');
  const res = { links: 0, tags: 0, actions: 0 };
  const taskByIndex = new Map();
  for (const p of pairs) taskByIndex.set(indexOf(p.item), p.task.id);

  // 태그 — 같은 워크스페이스에 이름이 정확히 있는 것만(새로 만들지 않는다).
  const wantNames = [...new Set(pairs.flatMap((p) => (Array.isArray(p.item.tag_names) ? p.item.tag_names : [])))];
  const tagRows = wantNames.length
    ? await TaskTag.findAll({ where: { business_id: businessId, name: { [Op.in]: wantNames } }, attributes: ['id', 'name'] })
    : [];
  const tagIdByName = new Map(tagRows.map((t) => [t.name, t.id]));

  for (const { task, item } of pairs) {
    try {
      const tagIds = [...new Set((item.tag_names || []).map((n) => tagIdByName.get(n)).filter(Boolean))];
      if (tagIds.length) {
        await TaskTagLink.bulkCreate(tagIds.map((tag_id) => ({ task_id: task.id, tag_id })));
        res.tags += tagIds.length;
      }
      const acts = normalizeActionItems(item.action_items) || [];
      if (acts.length) {
        await TaskActionItem.bulkCreate(acts.map((a, i) => ({
          business_id: businessId, task_id: task.id, order_index: i, kind: a.kind, label: a.label,
          note: a.note, status: 'pending', created_by: actorUserId,
        })));
        res.actions += acts.length;
      }
    } catch (e) { console.warn('[templateDetails] extras', task.id, e.message); }
  }

  for (const { task, item } of pairs) {
    for (const dep of (Array.isArray(item.depends_on_indexes) ? item.depends_on_indexes : [])) {
      const other = taskByIndex.get(Number(dep));
      if (!other || other === task.id) continue;
      const [x, y] = other < task.id ? [other, task.id] : [task.id, other];
      try {
        const [, isNew] = await TaskLink.findOrCreate({
          where: { task_a_id: x, task_b_id: y },
          defaults: { task_a_id: x, task_b_id: y, link_type: 'related', created_by: actorUserId },
        });
        if (isNew) res.links += 1;
      } catch (e) { console.warn('[templateDetails] link', x, y, e.message); }
    }
  }
  return res;
}

/**
 * AI 업무 추가 확정(ai-create/confirm)에서 후보가 템플릿 디테일을 들고 왔을 때 createTask 에 더할 칸.
 * 일반 AI 후보에는 이 칸들이 없으므로 빈 객체 → 종전 동작 그대로.
 */
function candidateTaskFields(c, projectId) {
  const out = {};
  if (c.body) out.body = String(c.body);
  if (c.is_milestone === true) out.isMilestone = true;
  if (c.category) out.category = String(c.category).trim().slice(0, 100) || null;
  if (VLEVELS.includes(c.vlevel) && c.vlevel !== 'L3') out.vlevel = c.vlevel === 'L2' && !projectId ? 'L3' : c.vlevel;
  if (SECURITY.includes(c.security_level) && c.security_level !== 'general') out.securityLevel = c.security_level;
  return out;
}

module.exports = { candidateTaskFields, normalizeItemDetails, normalizeSchedule, collectTaskExtras, materializeItemExtras, VLEVELS };
