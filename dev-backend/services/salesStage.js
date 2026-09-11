// services/salesStage.js — Q sale 영업 단계가 바뀌는 **유일한 문** (docs/Q_SALE_DESIGN.md §3.2·§6.3)
//
//   컬럼 갱신 + client_stage_history 1행 + 감사 로그 + client:updated broadcast 를 한 번에 한다.
//   `client.update({ sales_stage })` 를 다른 곳에서 부르면 이력·실시간·감사가 조용히 빠진다
//   (taskTransition 과 같은 정신 — guard-invariants `salesstage` 가 막는다).
//
//   규칙 (§1.2 · §6.3):
//     · 사람(manual)은 어느 단계로든 옮길 수 있다 — 자동으로 올라간 단계를 **내리는 것도** 사람만 한다.
//     · 자동(auto)은 **올리기만** 한다. 종결(lost) 고객은 자동으로 되살리지 않고, 자동으로 종결하지도 않는다
//       (조용한 고객 ≠ 잃은 고객).
//     · 종결로 옮기는 사람 전이는 사유가 필수다. 종결에서 벗어나면 사유는 비운다(이력에는 남는다).
const { ClientStageHistory } = require('../models');
const { createAuditLog } = require('./auditService');

const STAGES = ['none', 'inquiry', 'consulting', 'proposal', 'negotiation', 'won', 'lost'];
// 자동 상향 비교용 — none/lost 는 순서 밖
const PROGRESS = ['inquiry', 'consulting', 'proposal', 'negotiation', 'won'];
const LOST_REASONS = ['price', 'timing', 'competitor', 'no_response', 'fit', 'other'];

class StageError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

/**
 * @param {import('sequelize').Model} client  Client 인스턴스 (business_id 로 이미 스코프된 것)
 * @param {string} to
 * @param {{ origin: 'manual'|'auto', by?: number|null, reason?: string|null, lostReason?: string|null,
 *           lostNote?: string|null, sourceRef?: object|null, io?: any, transaction?: any }} opts
 * @returns {Promise<{ changed: boolean, from: string, to: string }>}
 */
async function setStage(client, to, opts = {}) {
  const origin = opts.origin === 'auto' ? 'auto' : 'manual';
  if (!STAGES.includes(to)) throw new StageError('invalid_stage');
  const from = client.sales_stage || 'none';
  if (from === to) return { changed: false, from, to };

  if (origin === 'auto') {
    if (from === 'lost' || to === 'lost') return { changed: false, from, to };
    const fi = PROGRESS.indexOf(from);
    const ti = PROGRESS.indexOf(to);
    if (ti < 0 || (fi >= 0 && ti <= fi)) return { changed: false, from, to };
  }

  const patch = { sales_stage: to, sales_stage_changed_at: new Date() };
  if (to === 'lost') {
    if (origin === 'manual' && !LOST_REASONS.includes(opts.lostReason)) throw new StageError('lost_reason_required');
    patch.lost_reason = opts.lostReason || null;
    patch.lost_note = opts.lostNote ? String(opts.lostNote).slice(0, 500) : null;
  } else if (from === 'lost') {
    patch.lost_reason = null;
    patch.lost_note = null;
  }

  const tx = opts.transaction ? { transaction: opts.transaction } : {};
  await client.update(patch, tx);
  const reason = to === 'lost'
    ? [patch.lost_reason, patch.lost_note].filter(Boolean).join(' · ') || null
    : (opts.reason ? String(opts.reason).slice(0, 500) : null);
  await ClientStageHistory.create({
    business_id: client.business_id,
    client_id: client.id,
    from_stage: from,
    to_stage: to,
    origin,
    changed_by: origin === 'manual' ? (opts.by || null) : null,
    reason,
    source_ref: opts.sourceRef || null,
  }, tx);

  createAuditLog({
    userId: opts.by || null, businessId: client.business_id,
    action: 'client.stage_change', targetType: 'client', targetId: client.id,
    oldValue: { sales_stage: from }, newValue: { sales_stage: to, origin, reason },
  });

  if (opts.io) opts.io.to(`business:${client.business_id}`).emit('client:updated', client.toJSON ? client.toJSON() : client);
  return { changed: true, from, to };
}

module.exports = { setStage, StageError, STAGES, LOST_REASONS };
