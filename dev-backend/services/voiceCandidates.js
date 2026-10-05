// services/voiceCandidates.js — Q Note 회의에서 «목소리로 이름을 붙여도 되는 사람» (docs/VOICE_PROFILE_DESIGN.md §3-1)
//
// 한 함수다. 라이브 매칭(q-note → /api/internal/qnote/voice-candidates)과 화자 팝오버의 «사람 고르기»
// (q-note /api/sessions/{id}/speaker-candidates 가 같은 내부 라우트를 부른다)가 같은 집합을 본다.
//
//   candidates(session) =
//       녹음자 본인                                          — 항상(그 워크스페이스 멤버일 때)
//     ∪ 그 워크스페이스의 현재 멤버 (removed_at NULL · AI 제외)
//     ∪ 고객 계정 (clients.user_id 있음 · status active) — 단 세션에 연결된 고객(client_id) 또는
//       세션 프로젝트의 project_clients 에 묶인 고객만 (Irene 결정 ③ 2026-10-05)
//
// ★ 다른 워크스페이스 사람은 지문이 있어도 후보가 아니다 — 테넌트 경계는 사람이 아니라 멤버십이다.
// ★ 지문 유무는 여기서 모르고, 응답에도 싣지 않는다(§4-2). 거르는 것은 q-note 가 자기 DB 로 한다.
// ★ 녹음자가 그 워크스페이스 멤버가 아니면 빈 목록 — 세션이 이미 잘못된 상태다(fail-closed).
const { Op } = require('sequelize');
const { BusinessMember, User, Client, ProjectClient, Project } = require('../models');

async function voiceCandidates({ businessId, projectId = null, clientId = null, recorderUserId }) {
  const bizId = Number(businessId);
  const recorder = Number(recorderUserId);
  if (!bizId || !recorder) return [];

  const members = await BusinessMember.findAll({
    where: { business_id: bizId, removed_at: null, role: { [Op.ne]: 'ai' } },
    attributes: ['user_id', 'name'],
    include: [{ model: User, as: 'user', attributes: ['id', 'name', 'is_ai', 'status'], required: true }],
  });
  const active = members.filter((m) => m.user && !m.user.is_ai && m.user.status === 'active');
  if (!active.some((m) => m.user_id === recorder)) return [];

  const out = new Map();
  for (const m of active) {
    out.set(m.user_id, { user_id: m.user_id, kind: 'user', display_name: m.name || m.user.name || null });
  }

  // 고객 — 세션에 연결된 것만
  const clientIds = new Set();
  if (Number(clientId)) clientIds.add(Number(clientId));
  if (Number(projectId)) {
    // 프로젝트가 이 워크스페이스 것일 때만 따라간다 — 남의 프로젝트 id 로 고객을 끌어오지 못하게
    const project = await Project.findOne({ where: { id: Number(projectId), business_id: bizId }, attributes: ['id'] });
    if (project) {
      const links = await ProjectClient.findAll({ where: { project_id: project.id }, attributes: ['client_id'] });
      for (const l of links) if (l.client_id) clientIds.add(l.client_id);
    }
  }
  if (clientIds.size) {
    const clients = await Client.findAll({
      where: { id: [...clientIds], business_id: bizId, status: 'active', user_id: { [Op.ne]: null } },
      attributes: ['id', 'user_id', 'display_name'],
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'status'], required: false }],
    });
    for (const c of clients) {
      if (!c.user_id || out.has(c.user_id)) continue;   // 멤버이기도 하면 멤버 이름이 우선
      if (!c.user || c.user.status !== 'active') continue;
      out.set(c.user_id, { user_id: c.user_id, kind: 'client', display_name: c.display_name || (c.user && c.user.name) || null });
    }
  }
  return [...out.values()];
}

module.exports = { voiceCandidates };
