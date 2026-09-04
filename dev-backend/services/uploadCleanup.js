// 휴지통 자동 비우기 cron — 보존기간(30일)이 지난 삭제 파일의 **바이트를 제거**한다.
//
// 정책:
//   - 사용자 삭제 = 휴지통행(routes/files.js trashFile). deleted_at 만 찍고 바이트는 그대로 둔다.
//   - 30일이 지나면 여기서 영구 삭제 — **services/filePurge.js 의 같은 함수**를 부른다.
//   - 행은 남긴다(purged_at 이 찍힌다). 무엇이 언제 사라졌는지는 감사 기록이다.
//     휴지통 목록은 purged_at IS NULL 로 걸러 이 행들을 보이지 않게 한다.
//
// ★ 여기가 한 번 갈라졌던 자리다: 옛 조건이 `ref_count <= 0` 이었는데, 휴지통 도입으로
//   삭제가 ref_count 를 줄이지 않게 되면서 **이 cron 이 휴지통을 영영 비우지 못하는** 상태가
//   됐다. 조건을 "보존기간 지남 + 아직 안 지워짐" 으로 바꾸고 삭제 자체는 단일 착지점에 위임한다.
//
// 멱등: 같은 날 여러 번 호출돼도 안전 (purged_at 이 찍힌 행은 다시 안 잡힌다).
// 안전: 한 row 실패해도 나머지 계속 진행.

const { Op } = require('sequelize');
const logger = require('../lib/logger');

// ★ 2026-09-04 — 보관기간을 요금제에서 읽도록 옮기는 중이다. **1단계는 삭제 동작을 바꾸지 않는다.**
//   `RETENTION_PURGE_APPLY=1` 이 없으면 오늘과 완전히 같은 30일 술어로 지우고, 플랜 기준으로는
//   무엇이 달라지는지 **델타만 센다**(would_purge_earlier / would_keep_longer).
//   운영 리포트가 실측과 맞는 것을 확인한 뒤 플래그를 켜면 그때부터 플랜 기준으로 지운다.
const LEGACY_DAYS = 30;

async function runUploadCleanup(today = new Date()) {
  const { File } = require('../models');
  const { resolveRetention, isExpired } = require('./retentionPolicy');
  const applyPlan = process.env.RETENTION_PURGE_APPLY === '1';
  const cutoff = new Date(today);
  cutoff.setDate(today.getDate() - LEGACY_DAYS);

  // 후보를 넓게 가져와 워크스페이스별 보관기간으로 판정한다(플랜 기준이 30일보다 길 수도 짧을 수도 있다).
  const candidates = await File.findAll({
    where: { deleted_at: { [Op.ne]: null }, purged_at: null },
    limit: 2000,
    order: [['deleted_at', 'ASC']],
  });

  const retCache = new Map();
  const retFor = async (bizId) => {
    if (!retCache.has(bizId)) retCache.set(bizId, await resolveRetention(bizId, 'trash'));
    return retCache.get(bizId);
  };

  const delta = { would_purge_earlier: 0, would_keep_longer: 0, skipped: {} };
  const expired = [];
  for (const f of candidates) {
    const legacyDue = new Date(f.deleted_at) < cutoff;
    const ret = await retFor(f.business_id);
    if (!ret.ok) {
      // 못 읽으면 보존 — 사유를 센다. 레거시 술어로는 지울 수 있어도 플랜 기준은 판단 불가다.
      delta.skipped[ret.reason] = (delta.skipped[ret.reason] || 0) + 1;
      if (!applyPlan && legacyDue) expired.push(f);
      continue;
    }
    const planDue = isExpired(f.purge_after, f.deleted_at, ret.days, today);
    if (planDue && !legacyDue) delta.would_purge_earlier += 1;
    if (!planDue && legacyDue) delta.would_keep_longer += 1;
    if (applyPlan ? planDue : legacyDue) expired.push(f);
    if (expired.length >= 500) break;   // 한 번에 너무 많이 삭제 안 하게 (운영 디스크 IO 보호)
  }

  const { sequelize } = require('../config/database');
  const { purgeFile } = require('./filePurge');
  let removed = 0; let failed = 0;
  for (const f of expired) {
    const t = await sequelize.transaction();
    try {
      await purgeFile(f, t);
      await t.commit();
      removed += 1;
    } catch (e) {
      await t.rollback().catch(() => {});
      failed += 1;
      logger.warn({ file_id: f.id, err: e.message }, 'trash purge failed');
    }
  }
  // 델타 — 플랜 기준으로 바꾸면 무엇이 달라지는가. 플래그를 켜기 전에 이 숫자를 본다.
  return { scanned: expired.length, removed, failed, mode: applyPlan ? 'plan' : 'legacy_30d', delta };
}

module.exports = { runUploadCleanup };
