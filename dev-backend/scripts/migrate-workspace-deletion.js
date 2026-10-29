// 워크스페이스 삭제 — businesses 에 칸 4개 + 옛 삭제본 백필. 멱등 (매 배포 실행 안전). 2026-10-29 docs/WORKSPACE_DELETION_DESIGN.md ⑥
//
// deletion_reason 이 있어야 «계정 탈퇴로 지운 것» 과 «대표가 지운 것» 이 서로를 되살리지 않는다.
// 백필: 이 스크립트 전에는 계정 탈퇴 동반 삭제가 유일한 길이었다 → deleted_at 있는 행은 전부 account_deletion.
//   purge_after 는 채우지 않는다 — 계정 탈퇴본은 계정 익명화(anonymized_at) 뒤에만 정리 대상이다(정리 cron 술어).
//
// 롤백: 코드만 revert. 칸은 남긴다(NULL 이면 무해).
require('dotenv').config();
const { sequelize } = require('../config/database');

const COLS = [
  ['deletion_reason', "ENUM('account_deletion','owner_request') NULL"],
  ['deleted_by', 'INT NULL'],
  ['purge_after', 'DATETIME NULL'],
  ['purged_at', 'DATETIME NULL'],
];

async function columns() {
  const [rows] = await sequelize.query('SHOW COLUMNS FROM `businesses`');
  return new Set(rows.map((r) => r.Field));
}

async function run() {
  let have = await columns();
  for (const [name, def] of COLS) {
    if (have.has(name)) continue;
    await sequelize.query(`ALTER TABLE \`businesses\` ADD COLUMN \`${name}\` ${def}`);
    console.log(`[migration] businesses.${name} 추가`);
  }
  have = await columns();
  const missing = COLS.filter(([n]) => !have.has(n)).map(([n]) => n);
  if (missing.length) throw new Error(`ALTER 는 돌았는데 없다 — ${missing.join(',')}`);
  const [r] = await sequelize.query(
    "UPDATE `businesses` SET `deletion_reason`='account_deletion' WHERE `deleted_at` IS NOT NULL AND `deletion_reason` IS NULL");
  console.log(`[migration] 옛 삭제본 백필(account_deletion) ${r.affectedRows || 0}건`);
  const [[left]] = await sequelize.query(
    'SELECT COUNT(*) n FROM `businesses` WHERE `deleted_at` IS NOT NULL AND `deletion_reason` IS NULL');
  if (Number(left.n) > 0) throw new Error(`백필 뒤에도 사유 없는 삭제본 ${left.n}건`);
  console.log('[migration] businesses 삭제 칸 확인 완료');
}

run()
  .then(() => sequelize.close())
  .catch(async (e) => { console.error('[migration] businesses 삭제 칸 실패:', e.message); await sequelize.close().catch(() => {}); process.exit(1); });
