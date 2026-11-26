// 잠재 고객 행 만들기 — 사람 없이 들어온 문의(상담 예약·접수 양식)가 **같은 함수**로 고객을 만든다 (2026-11-26)
//   설계 docs/INTAKE_AUTO_CASE_DESIGN.md §6 «공용화는 최소» — booking 은 동작 그대로 옮겼고, 고객으로 저장(sale_save)은 범위 밖.
// ★ 찾기는 `saleCommon.findExistingByContact` 가 먼저다 — 이 함수는 «없을 때 만들기» 만 한다.
// ★ 요금제 한도(add_prospect)는 트랜잭션 밖에서 `prospectAllowed` 로 먼저 본다(booking 순서 그대로).
// ★ 만든 뒤 캐시 무효화·영업 단계·client:new 신호는 커밋 뒤 `afterProspectCreated` — 트랜잭션이 되돌려지면 보내지 않는다.
const { Client } = require('../models');

/** 한도 — { ok, quota? } (quota 는 화면의 한도 안내 모양) */
async function prospectAllowed(businessId) {
  const planEngine = require('./plan');
  const can = await planEngine.can(businessId, 'add_prospect');
  if (can.ok) return { ok: true };
  return { ok: false, quota: planEngine.buildQuotaError(can, businessId) };
}

/**
 * 고객 행 하나 — 호출부 트랜잭션 안에서.
 * @param {object} p { businessId, name, email, phone?, company?, salesSource, assignedMemberId? }
 */
async function createProspectRow(p, { transaction } = {}) {
  const email = p.email || null;   // booking 이 넘기던 값 그대로(검증은 호출부 — 설문 validateAnswers · 예약 라우트)
  return Client.create({
    business_id: p.businessId,
    display_name: String(p.name || '').trim().slice(0, 100) || String(email || '').split('@')[0],
    ...(p.company ? { company_name: String(p.company).trim().slice(0, 200) || null } : {}),
    ...(p.phone ? { phone: String(p.phone).trim().slice(0, 40) || null } : {}),
    invite_email: email,
    kind: 'customer',
    status: 'prospect',
    sales_source: p.salesSource,
    ...(p.assignedMemberId ? { assigned_member_id: p.assignedMemberId } : {}),
    last_touch_at: new Date(),
  }, { transaction });
}

/** 커밋 뒤 — 한도 캐시 · 영업 단계 «문의» · 다른 창 목록 신호 */
async function afterProspectCreated(client, { reason, sourceRef }) {
  try { require('./plan').invalidateBusinessCache(client.business_id); } catch { /* 캐시일 뿐이다 */ }
  try {
    const { setStage } = require('./salesStage');
    await setStage(client, 'inquiry', { origin: 'auto', reason, sourceRef });
  } catch (e) { console.warn('[prospect] 단계 전이 실패:', e.message); }
  if (global.__planqIo) global.__planqIo.to(`business:${client.business_id}`).emit('client:new', { id: client.id, business_id: client.business_id });
}

module.exports = { prospectAllowed, createProspectRow, afterProspectCreated };
