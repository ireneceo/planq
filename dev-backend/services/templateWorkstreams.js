// 업무 템플릿의 추진과제(그룹) — 저장할 때 모으고, 적용할 때 프로젝트에 찾아 쓰거나 만든다 (2026-10-27).
//
// 왜: Irene «업무 템플릿 저장할 때 추진과제(그룹)은 저장이 안되는데? … 잘 정리된 그룹들이 같이 사용되어야지».
//   템플릿 항목에 그룹 칸이 없어 프로젝트 → 템플릿 → 적용을 거치면 업무가 전부 «(그룹 없음)» 으로 떨어졌다.
// 규칙: 그룹은 **이름**으로 옮긴다(id 는 프로젝트마다 다르다). 이름 비교는 normalizeWorkstreamTitle 한 벌 —
//   적용할 프로젝트에 같은 이름이 있으면 그것을 쓰고 없으면 템플릿 순서대로 만든다(createWorkstream dedupeByName).
//   /apply 와 AI 로 고쳐 넣기(ai-create/confirm)가 같은 함수를 부른다.
const { createWorkstream, normalizeWorkstreamTitle } = require('./actions/workstream_actions');

/** 템플릿의 그룹 목록 — 저장된 순서(workstreams) 먼저, 거기 없는 항목 그룹 이름은 항목 순서로 뒤에. */
function templateGroups(template, items) {
  const out = [];
  const seen = new Set();
  const push = (g) => {
    const title = String(g?.title || '').trim().slice(0, 200);
    const key = normalizeWorkstreamTitle(title);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ title, color: g.color || null, description: g.description || null });
  };
  (Array.isArray(template?.workstreams) ? template.workstreams : []).forEach(push);
  (items || []).forEach((it) => { if (it.workstream_title) push({ title: it.workstream_title }); });
  return out;
}

/** 항목 그룹 이름 목록을 저장용 workstreams 로 — 남아 있는 이름만, 옛 순서·색 유지, 새 이름은 뒤에. */
function groupsForItems(prevGroups, items) {
  const used = new Set((items || []).map((it) => normalizeWorkstreamTitle(it.workstream_title)).filter(Boolean));
  return templateGroups({ workstreams: prevGroups }, items).filter((g) => used.has(normalizeWorkstreamTitle(g.title)));
}

/**
 * 프로젝트에 템플릿 그룹을 갖춘다 — 쓰는 그룹만(wantedKeys), 템플릿 순서대로.
 * @returns {Promise<{ idByKey: Map<string, number>, created: number }>}
 */
async function ensureTemplateGroups(actor, { projectId, businessId, groups, wantedKeys }) {
  const idByKey = new Map();
  let created = 0;
  if (!projectId) return { idByKey, created };
  for (const g of groups) {
    const key = normalizeWorkstreamTitle(g.title);
    if (wantedKeys && !wantedKeys.has(key)) continue;
    const r = await createWorkstream(actor, {
      projectId, businessId, title: g.title, color: g.color, description: g.description, dedupeByName: true,
    });
    if (!r.ok) continue;   // 권한·프로젝트 문제면 그룹 없이 넣는다(업무 생성은 막지 않는다)
    idByKey.set(key, Number(r.data.workstream.id));
    if (r.data.created) created += 1;
  }
  return { idByKey, created };
}

module.exports = { templateGroups, groupsForItems, ensureTemplateGroups, normalizeWorkstreamTitle };
