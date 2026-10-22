// 서명 회차 — 닫기 · 자동 새 회차 (2026-10-22, Fable 설계 PASS · docs/SIGNATURE_REVISE_ROUND_DESIGN.md)
//
// 회차 = 한 문서의 서명 요청 중 아직 닫히지 않은 것(kind=sign ∧ status ∉ {canceled, superseded}).
//   서명본·잠금·진행·거래 단계가 이 회차만 본다. 닫힌 회차의 행은 status 'superseded' 로 기록에만 남는다
//   (서명 이미지·시각·IP·해시는 지우지 않는다 — 감사 증거).
//
// 닫을 수 있는 때 = 받는 쪽(them) 서명이 0. Irene: «다른 사람 서명 전에는 수정 가능, 이후는 안 되는 거고».
//   받는 쪽이 한 명이라도 서명했으면 문서는 그대로 잠기고, 고치려면 복사본으로 새로 보낸다.
// 닫는 문은 여기 하나다 — 사람이 누르는 [고쳐서 다시 보내기](closeRound) 와 새 요청 때의 자동 정리(autoSupersede) 가
//   같은 함수(supersedeRows)를 쓴다.
const { Op } = require('sequelize');
const { SignatureRequest } = require('../models');
const { createAuditLog } = require('../middleware/audit');

const CLOSED = ['canceled', 'superseded'];
const OPEN = ['pending', 'sent', 'viewed'];

/** 문서의 현재 회차 행 — lock 이면 FOR UPDATE(닫기와 서명이 엇갈리지 않게) */
async function roundRows(postId, { transaction = null, lock = false } = {}) {
  return SignatureRequest.findAll({
    where: { entity_type: 'post', entity_id: Number(postId), kind: 'sign', status: { [Op.notIn]: CLOSED } },
    order: [['id', 'ASC']],
    ...(transaction ? { transaction } : {}),
    ...(transaction && lock ? { lock: transaction.LOCK.UPDATE } : {}),
  });
}

/** 받는 쪽 서명 0 ∧ 행 1개 이상 */
function canCloseRows(rows) {
  return rows.length > 0 && !rows.some((r) => (r.party || 'them') === 'them' && r.status === 'signed');
}

async function supersedeRows(rows, { transaction, now = new Date() }) {
  const ids = rows.map((r) => r.id);
  if (!ids.length) return { ids, now };
  await SignatureRequest.update(
    { status: 'superseded', superseded_at: now },
    { where: { id: { [Op.in]: ids }, status: { [Op.notIn]: CLOSED } }, transaction },
  );
  return { ids, now };
}

/**
 * [고쳐서 다시 보내기] — 사람이 누른다. 권한(요청자 ∨ 문서 편집 가능)은 라우트가 먼저 본다.
 * @returns {{ok:true, ids:number[]} | {ok:false, code:string, status:number}}
 */
async function closeRound({ postId, businessId, userId, reason = null, transaction }) {
  const rows = await roundRows(postId, { transaction, lock: true });
  if (!rows.length) return { ok: false, code: 'no_open_round', status: 409 };
  if (!canCloseRows(rows)) return { ok: false, code: 'round_has_counterparty_signature', status: 409 };
  const { ids } = await supersedeRows(rows, { transaction });
  const frozen = rows.find((r) => r.content_hash);
  createAuditLog({
    userId, businessId, action: 'signature.round_closed',
    targetType: 'Post', targetId: Number(postId),
    metadata: { ids, frozen_content_hash: frozen ? frozen.content_hash : null, reason: reason ? String(reason).slice(0, 500) : null },
  });
  return { ok: true, ids };
}

/**
 * 새 서명 요청 직전 — 회차에 열린 행·서명 행이 하나도 없으면(거절·만료만 남음) 그 회차를 닫고 새로 시작한다(D5).
 * 안 그러면 옛 거절 행이 회차에 남아 고정본이 «고치기 전 본문» 이 된다.
 */
async function autoSupersedeStale({ postId, businessId, userId, transaction }) {
  const rows = await roundRows(postId, { transaction, lock: true });
  if (!rows.length) return { ids: [] };
  // 기간이 지난 열린 행은 «열림» 이 아니다(만료 문자열은 열람 때만 붙는다 — isExpiredNow 한 원천)
  const { isExpiredNow } = require('./signatureCore');
  if (rows.some((r) => r.status === 'signed' || (OPEN.includes(r.status) && !isExpiredNow(r)))) return { ids: [] };
  const { ids } = await supersedeRows(rows, { transaction });
  createAuditLog({
    userId, businessId, action: 'signature.round_closed',
    targetType: 'Post', targetId: Number(postId),
    metadata: { ids, auto: true },
  });
  return { ids };
}

module.exports = { roundRows, canCloseRows, closeRound, autoSupersedeStale, CLOSED_STATUSES: CLOSED };
