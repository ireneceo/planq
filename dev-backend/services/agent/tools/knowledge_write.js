// AI 에이전트 도구 — Q info 항목 만들기 (2026-10-07, Fable B 판정 3 — create_knowledge_item).
//
//   쓰기는 행동 계층 kb_actions.createDocument 하나(화면 «새 정보 등록» 과 같은 함수 — 색인·태그 추출·감사·실시간).
//   scope 는 M3 선례대로 docs:write, 메뉴는 qinfo **쓰기**.
//   ★ 비밀 칸(비밀번호·토큰·API 키 같은 이름)은 받지 않는다 — 대화 내용은 외부 AI 쪽에도 남는다. 그런 값은 사람이 화면에서 넣는다.
//   ★ 공개 범위 기본은 «나만 보기»(private) — 화면 라우트의 기본값과 같다.
const cfg = require('../../agent_oauth/config');
const { err, fromActionFailure } = require('../errors');
const { assertMenu } = require('../menu');

const SCOPE_TO_VLEVEL = { private: 'L1', project: 'L2', workspace: 'L3', client: 'L4' };

async function createKnowledgeItem(p, a, actor) {
  await assertMenu(p, 'qinfo', 'write');
  const { normalizeCandidateFields } = require('../../kbFields');
  const { columns, values } = normalizeCandidateFields({ fields: a.fields || null });
  const secret = columns.filter((c) => c.type === 'secret').map((c) => c.name);
  if (secret.length) {
    throw err('VALIDATION_ERROR', 'secret_fields_not_allowed', { fields: secret, hint: 'Passwords, tokens and keys cannot be saved through the AI app. Leave these fields out; the user can add them in PlanQ.' });
  }
  const scope = a.scope || (a.project_id ? 'project' : (a.client_id ? 'client' : 'private'));
  if (scope === 'project' && !a.project_id) throw err('VALIDATION_ERROR', 'project_id_required_for_project_scope');
  if (scope === 'client' && !a.client_id) throw err('VALIDATION_ERROR', 'client_id_required_for_client_scope');
  const { Project } = require('../../../models');
  if (a.project_id && !(await Project.findOne({ where: { id: a.project_id, business_id: p.businessId }, attributes: ['id'] }))) throw err('NOT_FOUND', 'project_not_found');
  if (a.client_id) {
    const { findClient } = require('../../saleCommon');
    if (!(await findClient(p.businessId, a.client_id))) throw err('NOT_FOUND', 'client_not_found');
  }
  const actions = require('../../actions/kb_actions');
  const r = await actions.createDocument(actor, {
    businessId: p.businessId,
    input: {
      title: a.title,
      body: a.body || '',
      categories: [a.category],
      vlevel: SCOPE_TO_VLEVEL[scope],
      project_id: scope === 'project' ? a.project_id : undefined,
      client_id: scope === 'client' ? a.client_id : undefined,
      custom_columns: columns.length ? columns : undefined,
      custom_values: columns.length ? values : undefined,
    },
  });
  if (!r.ok) throw fromActionFailure(r);
  const d = r.data;
  return {
    knowledge_item: {
      kb_id: d.id, title: d.title, category: a.category, scope,
      project_id: d.project_id || null, client_id: d.client_id || null,
      fields: columns.map((c) => c.name), url: `${cfg.APP_URL}/knowledge?doc=${d.id}`,
    },
    note: scope === 'client' ? 'The selected client can see this item.' : (scope === 'private' ? 'Only you can see this item.' : undefined),
    created: true,
  };
}

module.exports = { createKnowledgeItem };
