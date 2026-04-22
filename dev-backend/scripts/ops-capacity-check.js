// OPS 용량 체크 스크립트 (주 1회)
// 가입자 수 + 총 스토리지 사용량 → 임계치별 Stage 판정 → 로그 + 알림
// 실행: node scripts/ops-capacity-check.js
// PM2: pm2 register via ecosystem.config.js (cron_restart)

const { Business, BusinessStorageUsage, OpsCapacityLog } = require('../models');
const { sequelize } = require('../config/database');
const { Op } = require('sequelize');

// docs/OPS_ROADMAP.md 에 정의된 임계치
const STAGES = [
  { stage: 1, businesses: 100, bytes: 50 * 1024 * 1024 * 1024 },               // 50GB
  { stage: 2, businesses: 500, bytes: 500 * 1024 * 1024 * 1024 },              // 500GB
  { stage: 3, businesses: 2000, bytes: 5 * 1024 * 1024 * 1024 * 1024 },        // 5TB
  { stage: 4, businesses: 5000, bytes: 10 * 1024 * 1024 * 1024 * 1024 }        // 10TB (참고용)
];

function determineStage(bizCount, bytesUsed) {
  let reached = 0;
  for (const s of STAGES) {
    if (bizCount >= s.businesses || bytesUsed >= s.bytes) reached = s.stage;
  }
  return reached;
}

async function run() {
  try {
    const bizCount = await Business.count();
    const usages = await BusinessStorageUsage.findAll();
    const totalBytes = usages.reduce((sum, u) => sum + Number(u.bytes_used), 0);
    const totalFiles = usages.reduce((sum, u) => sum + u.file_count, 0);

    // provider 비중
    const [providerRows] = await sequelize.query(
      "SELECT storage_provider, COUNT(*) as n FROM files WHERE deleted_at IS NULL GROUP BY storage_provider"
    );
    const byProvider = { planq: 0, gdrive: 0 };
    for (const r of providerRows) {
      if (byProvider[r.storage_provider] !== undefined) byProvider[r.storage_provider] = Number(r.n);
    }

    const stage = determineStage(bizCount, totalBytes);

    // 이전 스냅샷 비교
    const prev = await OpsCapacityLog.findOne({ order: [['snapshot_at', 'DESC']] });
    const stageChanged = prev && prev.stage_reached !== stage;

    await OpsCapacityLog.create({
      snapshot_at: new Date(),
      businesses_count: bizCount,
      total_bytes_used: totalBytes,
      total_files: totalFiles,
      planq_share: byProvider.planq,
      gdrive_share: byProvider.gdrive,
      stage_reached: stage,
      notes: stageChanged ? `Stage changed ${prev.stage_reached} → ${stage}` : null
    });

    const gb = (totalBytes / (1024 * 1024 * 1024)).toFixed(2);
    const stageLabel = stage === 0 ? 'Stage 0 (OK)' : `Stage ${stage}`;
    console.log(`[OPS] biz=${bizCount} files=${totalFiles} used=${gb}GB stage=${stageLabel} providers=planq:${byProvider.planq}/gdrive:${byProvider.gdrive}`);

    if (stageChanged) {
      const msg = `[OPS ALERT] Stage ${prev.stage_reached} → ${stage}: businesses=${bizCount}, storage=${gb}GB. docs/OPS_ROADMAP.md 참조.`;
      console.log(msg);
      // TODO: SMTP 설정 완료 후 이메일 전송 (irene@irenewp.com)
      // require('../services/email').sendAdminAlert({ subject: 'PlanQ OPS', body: msg });
    }

    process.exit(0);
  } catch (err) {
    console.error('[OPS] capacity check failed:', err);
    process.exit(1);
  }
}

run();
