// 폴더 공유 링크 — file_folders 에 공유 칸 5개 + share_token unique. 멱등 (매 배포 실행 안전). 2026-10-29 #469
//
// sync-database 가 조용히 실패하면 새 코드가 없는 칸을 읽어 폴더 목록이 500 이 된다 —
// 그래서 PM2 reload 앞에서 이 스크립트가 한 번 더 보장하고, **다시 조회해서** 판정한다.
// 백필 없음 — 새 기능이라 옛 값이 없다(전부 NULL = 공유 안 함).
//
// 롤백: 코드만 revert. 칸은 남긴다(NULL 이면 무해).
require('dotenv').config();
const { sequelize } = require('../config/database');

const COLS = [
  ['share_token', 'VARCHAR(64) NULL'],
  ['shared_at', 'DATETIME NULL'],
  ['share_password_hash', 'VARCHAR(255) NULL'],
  ['share_expires_at', 'DATETIME NULL'],
  ['shared_by', 'INT NULL'],
];
const INDEX = 'file_folders_share_token_unique';

async function columns() {
  const [rows] = await sequelize.query('SHOW COLUMNS FROM `file_folders`');
  return new Set(rows.map((r) => r.Field));
}
async function hasIndex() {
  const [rows] = await sequelize.query('SHOW INDEX FROM `file_folders` WHERE Key_name = ?', { replacements: [INDEX] });
  return rows.length > 0;
}

async function run() {
  let have = await columns();
  for (const [name, def] of COLS) {
    if (have.has(name)) continue;
    await sequelize.query(`ALTER TABLE \`file_folders\` ADD COLUMN \`${name}\` ${def}`);
    console.log(`[migration] file_folders.${name} 추가`);
  }
  if (!(await hasIndex())) {
    await sequelize.query(`ALTER TABLE \`file_folders\` ADD UNIQUE INDEX \`${INDEX}\` (\`share_token\`)`);
    console.log(`[migration] ${INDEX} 추가`);
  }
  have = await columns();
  const missing = COLS.filter(([n]) => !have.has(n)).map(([n]) => n);
  if (missing.length || !(await hasIndex())) throw new Error(`ALTER 는 돌았는데 없다 — ${missing.join(',') || INDEX}`);
  console.log('[migration] file_folders 공유 칸 확인 완료');
  return true;
}

run()
  .then(() => sequelize.close())
  .catch(async (e) => { console.error('[migration] file_folders 공유 칸 실패:', e.message); await sequelize.close().catch(() => {}); process.exit(1); });
