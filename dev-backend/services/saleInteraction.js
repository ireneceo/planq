// services/saleInteraction.js — 상담 기록(전화·미팅·방문·메모)을 **만드는 문 하나**.
//
// 여태 생성 로직이 `routes/sale_interactions.js` POST 안에만 있었다. 문의 추가 모달에서 첫 기록을
// 같이 남기려면 그 10줄(검증 → create → touch → 감사 → broadcast)을 복사해야 했는데,
// 복사하면 한쪽만 고쳐진다(감사 누락·실시간 누락은 둘 다 "조용히" 난다 — CLAUDE.md 16번·감사 규칙).
// 그래서 **검증(interactionPatchFrom)과 생성(createInteraction)을 여기 한 곳**에 두고 둘이 부른다.
const { ClientInteraction, Project } = require('../models');
const { createAuditLog } = require('./auditService');
const { broadcast, trimOrNull, touchClient, INTERACTION_KINDS } = require('./saleCommon');
const { verifyQnoteSession } = require('./qnoteOwnership');

/** 입력 → 저장할 필드. 잘못된 값은 { error } 로 돌려준다(라우트가 400 으로 바꾼다). */
function interactionPatchFrom(body, { creating }) {
  const out = {};
  if (creating || body.kind !== undefined) {
    if (!INTERACTION_KINDS.includes(body.kind)) return { error: 'invalid_kind' };
    out.kind = body.kind;
  }
  if (body.direction !== undefined) {
    if (body.direction !== null && !['inbound', 'outbound'].includes(body.direction)) return { error: 'invalid_direction' };
    out.direction = body.direction || null;
  }
  if (creating || body.occurred_at !== undefined) {
    const d = body.occurred_at ? new Date(body.occurred_at) : new Date();
    if (Number.isNaN(d.getTime())) return { error: 'invalid_occurred_at' };
    // 미래 접점은 기록이 아니라 일정이다 — 시계 오차만 허용
    if (d.getTime() > Date.now() + 5 * 60 * 1000) return { error: 'occurred_in_future' };
    out.occurred_at = d;
  }
  if (body.duration_seconds !== undefined) {
    if (body.duration_seconds === null || body.duration_seconds === '') out.duration_seconds = null;
    else {
      const n = Math.round(Number(body.duration_seconds));
      if (!Number.isFinite(n) || n < 0 || n > 24 * 3600) return { error: 'invalid_duration' };
      out.duration_seconds = n;
    }
  }
  if (body.title !== undefined) out.title = trimOrNull(body.title, 200);
  if (body.body !== undefined) {
    const s = body.body === null ? null : String(body.body);
    if (s && s.length > 20000) return { error: 'body_too_long' };
    out.body = s && s.trim() ? s : null;
  }
  return { patch: out };
}

/**
 * 상담 기록 1건 생성 — 검증된 patch 로 create + last_touch 갱신 + 감사 + 실시간.
 *   req 는 broadcast 용(없으면 실시간만 생략된다 — 서버 내부 호출).
 * @returns {{ row }} 또는 {{ error }}
 */
async function createInteraction({ businessId, client, body, userId, req }) {
  const { patch, error } = interactionPatchFrom(body || {}, { creating: true });
  if (error) return { error };

  // ★ Q Note 에서 올라온 기록 — `source_kind` 는 **화면이 고르는 값이 아니다.**
  //   노트 번호가 실제로 그 사람 것일 때에만 'qnote' 가 된다(확인은 qnoteOwnership 한 곳).
  //   번호를 못 주면 그냥 수기 기록으로 남는다 — 거짓 출처를 원장에 적느니 출처가 없는 게 낫다.
  let source = { origin: 'manual', source_kind: 'manual', qnote_session_id: null };
  if (body && body.qnote_session_id !== undefined && body.qnote_session_id !== null) {
    const v = await verifyQnoteSession({ sessionId: body.qnote_session_id, userId, businessId });
    if (!v.ok) return { error: v.reason };
    source = { origin: 'manual', source_kind: 'qnote', qnote_session_id: Number(body.qnote_session_id) };
    // 제목·길이는 노트에서 가져온다 — 화면이 안 보냈을 때만(사용자가 고쳐 보냈으면 그것을 존중)
    if (!patch.title && v.session.title) patch.title = trimOrNull(v.session.title, 200);
    if (patch.duration_seconds === undefined && Number.isFinite(Number(v.session.duration_seconds))) {
      const d = Math.max(0, Math.min(24 * 3600, Math.round(Number(v.session.duration_seconds))));
      patch.duration_seconds = d;
    }
  }
  if (!patch.title && !patch.body) return { error: 'content_required' };

  let projectId = null;
  if (body.project_id) {
    const p = await Project.findOne({ where: { id: Number(body.project_id), business_id: businessId }, attributes: ['id'] });
    if (!p) return { error: 'invalid_project' };
    projectId = p.id;
  }
  const row = await ClientInteraction.create({
    ...patch,
    business_id: businessId, client_id: client.id, project_id: projectId,
    ...source, created_by: userId,
  });
  await touchClient(client, row.occurred_at);
  createAuditLog({
    userId, businessId, action: 'client.interaction.create',
    targetType: 'client_interaction', targetId: row.id,
    newValue: {
      client_id: client.id, kind: row.kind, occurred_at: row.occurred_at,
      source_kind: row.source_kind, qnote_session_id: row.qnote_session_id,
    },
  });
  if (req) {
    broadcast(req, businessId, 'interaction:new', { id: row.id, client_id: client.id });
    broadcast(req, businessId, 'client:updated', { id: client.id, business_id: businessId });
  }
  return { row };
}

module.exports = { interactionPatchFrom, createInteraction };
