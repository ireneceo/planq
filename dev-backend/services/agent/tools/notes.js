// AI 에이전트 도구 — 대화 결과를 PlanQ 에 «기록» 한다 (#439 · #453 «2번»).
//
//   Irene #412·#453: 고객이 ChatGPT·Claude 에서 나눈 대화를 PlanQ 가 가져올 길은 없다 → 방향을 뒤집어
//   AI 가 대화의 **결과**를 PlanQ 원장에 쓴다. 업무 댓글(add_task_note)에 더해 고객 상담 기록·프로젝트 메모.
//
//   ★ 쓰는 문은 사람과 같다 — 상담은 services/saleInteraction.createInteraction(사람의 «상담으로 저장» 과 같은 함수),
//     프로젝트 메모는 행동 계층 project_note_actions.createProjectNote. 여기서 모델을 직접 쓰지 않는다(가드 agentsurface).
//   ★ 범위는 토큰의 워크스페이스로만 — 고객은 findClient(p.businessId, …), 프로젝트는 businessId 를 넘겨 묶는다.
//     남의 워크스페이스 id 는 NOT_FOUND(있다는 것조차 알리지 않는다).
//   ★ 메뉴 Layer — 상담은 Q sales **쓰기**(사람 라우트의 requireMenu('qsale','write') 와 같다), 프로젝트 메모는 qtask.
const cfg = require('../../agent_oauth/config');
const { err, fromActionFailure } = require('../errors');

const iso = (v) => (v ? new Date(v).toISOString() : null);

// 메뉴 Layer 판정은 services/agent/menu 한 벌(M3-a 에서 네 벌을 모았다).
const { assertMenu: menuLevel } = require('../menu');

// ── add_client_interaction ─────────────────────────────────
async function addClientInteraction(p, a, actor) {
  await menuLevel(p, 'qsale', 'write');
  const { findClient } = require('../../saleCommon');
  const client = await findClient(p.businessId, a.client_id);
  if (!client) throw err('NOT_FOUND', 'client_not_found');
  // M3-c 출처(설계 §6) — 상담 표에는 메일 칸이 없다. 읽을 수 있는 스레드임을 확인한 뒤 출처 종류(email)를 서버가 정하고
  //   본문 끝에 원본 링크 한 줄을 남긴다(«안 되면 원본 링크»). 화면이 고르는 값이 아니다(saleInteraction 의 qnote 규약과 같다).
  const { resolveSource, sourceLine } = require('./sources');
  const src = await resolveSource(p, a.source, ['mail']);
  const content = src ? `${a.content}\n\n${await sourceLine(p, 'mail', src.url)}` : a.content;
  const { createInteraction } = require('../../saleInteraction');
  const out = await createInteraction({
    businessId: p.businessId, client, userId: p.userId, req: null, channel: actor.channel,
    body: {
      kind: a.kind || 'memo',
      title: a.title || null,
      body: content,
      occurred_at: a.occurred_at || undefined,
      direction: a.direction,
      project_id: a.project_id || undefined,
    },
    verifiedSource: src ? { source_kind: 'email' } : null,
  });
  if (out.error) {
    if (out.error === 'invalid_project') throw err('NOT_FOUND', 'project_not_found');
    if (/occurred|invalid|required|too_long/.test(out.error)) throw err('VALIDATION_ERROR', out.error);
    throw err('INTERNAL', out.error);
  }
  const r = out.row;
  return {
    interaction: {
      interaction_id: r.id, client_id: client.id, kind: r.kind, title: r.title || null,
      occurred_at: iso(r.occurred_at), project_id: r.project_id || null,
      source: src ? { kind: 'mail', thread_id: src.thread.id, url: src.url } : null,
    },
    client: { client_id: client.id, name: client.display_name || client.company_name || null, url: `${cfg.APP_URL}/sale/${client.id}` },
    created: true,
  };
}

// ── add_project_note ───────────────────────────────────────
async function addProjectNote(p, a, actor) {
  await menuLevel(p, 'qtask', 'read');
  // M3-c 출처 — 읽을 수 있는 메일 스레드만(sources). 프로젝트 메모 표에는 메일 칸(email_thread_id)이 있다.
  const { resolveSource } = require('./sources');
  const src = await resolveSource(p, a.source, ['mail']);
  const actions = require('../../actions/project_note_actions');
  const r = await actions.createProjectNote(actor, {
    projectId: a.project_id, body: a.content, visibility: a.visibility || 'internal', businessId: p.businessId,
    emailThreadId: src ? src.thread.id : null,
  });
  if (!r.ok) {
    // 비멤버(403)도 NOT_FOUND 로 — 워크스페이스 밖 프로젝트의 존재를 403/404 차이로 흘리지 않는다
    if (r.code === 'not_project_member' || r.code === 'project_not_found') throw err('NOT_FOUND', 'project_not_found');
    throw fromActionFailure(r);
  }
  const n = r.data.note;
  return {
    project_note: {
      note_id: n.id, project_id: n.project_id, visibility: n.visibility, created_at: iso(n.created_at || n.createdAt),
      source: n.email_thread_id ? { kind: 'mail', thread_id: n.email_thread_id, url: `${cfg.APP_URL}/mail?thread=${n.email_thread_id}` } : null,
    },
    project: { project_id: r.data.project.id, name: r.data.project.name, url: `${cfg.APP_URL}/projects/p/${r.data.project.id}` },
    created: true,
  };
}

module.exports = { addClientInteraction, addProjectNote };
