// #379 역방향 동기화 스키마 — 멱등. 배포 파이프에서 반복 실행돼도 안전하다.
//   ① file_folders.gdrive_folder_id  (이동 매핑)
//   ② gdrive_sync_logs               (동기화 원장 — 운영 안정성 원칙 6)
const { sequelize } = require('../config/database');

async function hasColumn(table, col) {
  const [r] = await sequelize.query(
    `SELECT COUNT(*) n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:t AND COLUMN_NAME=:c`,
    { replacements: { t: table, c: col } });
  return Number(r[0].n) > 0;
}
async function hasTable(table) {
  const [r] = await sequelize.query(
    `SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:t`,
    { replacements: { t: table } });
  return Number(r[0].n) > 0;
}

(async () => {
  let changed = 0;
  if (await hasColumn('file_folders', 'gdrive_folder_id')) {
    console.log('✓ file_folders.gdrive_folder_id 이미 존재 — skip');
  } else {
    await sequelize.query('ALTER TABLE file_folders ADD COLUMN gdrive_folder_id VARCHAR(128) NULL');
    await sequelize.query('CREATE INDEX idx_ff_gdrive ON file_folders (gdrive_folder_id)');
    console.log('+ file_folders.gdrive_folder_id 추가'); changed++;
  }
  if (await hasTable('gdrive_sync_logs')) {
    console.log('✓ gdrive_sync_logs 이미 존재 — skip');
  } else {
    const { GdriveSyncLog } = require('../models');
    await GdriveSyncLog.sync();
    console.log('+ gdrive_sync_logs 생성'); changed++;
  }
  console.log(`[migrate-gdrive-sync] 완료 — 변경 ${changed}건 (멱등)`);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
