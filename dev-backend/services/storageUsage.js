// storageUsage — 워크스페이스 자체(planq) 스토리지 사용량의 원자적 증감.
//
// files.js 의 인라인 트랜잭션 패턴(BusinessStorageUsage 행 FOR UPDATE lock → 쿼터 재검증 →
// invalidateBusinessCache)을 첨부(message/task) 라우트가 공유하도록 추출.
//   - 비용폭탄 재게이트(2026-07-03): 첨부 업로드가 30s getUsage 캐시 + 10/분 리미터 사이에서
//     동시 요청 시 쿼터를 넘겨 집계되던 race + delete 미반영(단조 증가 → 잠금) 근본해결.
//   - files.js 자체는 기존 인라인 로직 유지(회귀위험 회피). 정책(Math.max 0 하한)은 동일.
const { sequelize } = require('../config/database');
const { BusinessStorageUsage } = require('../models');
const planEngine = require('./plan');

// InnoDB 데드락/락대기 타임아웃 판별 — findOrCreate(INSERT) + 직후 FOR UPDATE 조합이 신규
//   워크스페이스 최초 동시 업로드에서 상호 락 대기로 얽힐 수 있어, 짧게 재시도해 흡수한다.
function isTransientLockError(e) {
  const code = e && (e.parent || e.original || {}).code;
  return code === 'ER_LOCK_DEADLOCK' || code === 'ER_LOCK_WAIT_TIMEOUT';
}

async function _attemptReserve(businessId, bytes) {
  const t = await sequelize.transaction();
  try {
    await BusinessStorageUsage.findOrCreate({
      where: { business_id: businessId },
      defaults: { business_id: businessId, bytes_used: 0, file_count: 0, storage_provider: 'planq' },
      transaction: t,
    });
    const usage = await BusinessStorageUsage.findOne({
      where: { business_id: businessId },
      lock: t.LOCK.UPDATE,
      transaction: t,
    });
    const limit = await planEngine.getLimit(businessId, 'storage_bytes');
    if (limit !== Infinity && Number(usage.bytes_used) + bytes > limit) {
      await t.rollback();
      return { ok: false, reason: 'storage_quota_exceeded', limit, current: Number(usage.bytes_used) };
    }
    usage.bytes_used = Number(usage.bytes_used) + bytes;
    usage.file_count = Number(usage.file_count) + 1;
    await usage.save({ transaction: t });
    await t.commit();
    planEngine.invalidateBusinessCache(businessId);
    return { ok: true };
  } catch (e) {
    try { await t.rollback(); } catch (_) { /* already settled */ }
    throw e;
  }
}

// 자체 스토리지 업로드 확정 — usage 행을 lock 하고 쿼터를 재검증한 뒤 원자적으로 증가.
//   반환: { ok: true } | { ok: false, reason: 'storage_quota_exceeded', limit, current }
//   호출측은 반드시 물리 파일 저장/DB 레코드 생성 "직전"에 호출하고, ok:false 면 임시파일 정리.
//   throw 도 발생 가능(재시도 소진 등) → 호출측은 try/catch 로 임시파일 정리 후 재던짐.
async function reservePlanqUpload(businessId, sizeBytes) {
  const bytes = Number(sizeBytes || 0);
  // 최초 행 INSERT 경합은 재시도 시 이미 행이 존재해 락 얽힘이 해소된다. 최대 3회.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await _attemptReserve(businessId, bytes);
    } catch (e) {
      if (isTransientLockError(e) && attempt < 2) {
        await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
}

// 자체 스토리지 파일 삭제 — usage 반환(감소). files.js softDeleteFile 과 동일 하한 정책.
//   물리 파일을 실제로 제거(단독 소유)한 경우에만 호출해야 double-decrement 를 피한다.
//   count: 한 번에 여러 파일을 반환할 때 file_count 감소량(대량 삭제용). 기본 1.
//   ⚠ 자체 트랜잭션을 열므로 다른 트랜잭션(같은 BusinessStorageUsage 행 FOR UPDATE) 안에서
//     호출하면 self-deadlock. 반드시 상위 트랜잭션 commit "후"에 호출할 것.
async function releasePlanqUpload(businessId, sizeBytes, count = 1) {
  const bytes = Number(sizeBytes || 0);
  const cnt = Number(count || 0);
  const t = await sequelize.transaction();
  try {
    const usage = await BusinessStorageUsage.findOne({
      where: { business_id: businessId },
      lock: t.LOCK.UPDATE,
      transaction: t,
    });
    if (usage) {
      usage.bytes_used = Math.max(0, Number(usage.bytes_used) - bytes);
      usage.file_count = Math.max(0, Number(usage.file_count) - cnt);
      await usage.save({ transaction: t });
    }
    await t.commit();
    planEngine.invalidateBusinessCache(businessId);
    return { ok: true };
  } catch (e) {
    try { await t.rollback(); } catch (_) { /* already settled */ }
    throw e;
  }
}

module.exports = { reservePlanqUpload, releasePlanqUpload };
