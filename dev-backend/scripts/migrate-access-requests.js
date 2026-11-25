// 열람 요청 (2026-11-25, 멱등) — files.hide_existence · posts.hide_existence (기본 0) + access_requests 표.
//   설계 docs/FILE_SEARCH_DISCOVERY_DESIGN.md §2·§3.
//   ★ PM2 reload 전: 새 코드의 File·Post 모델이 hide_existence 를 SELECT 한다 — 컬럼이 없으면 파일·문서 조회가 500.
//   컬럼 추가만(기본 0 = 지금과 같음) · 기존 행 값 불변. 롤백은 코드만(컬럼·표는 남겨도 무해 — 옛 코드는 안 읽는다).
const { sequelize } = require('../config/database');

async function addCol(table) {
  const [cols] = await sequelize.query(`SHOW COLUMNS FROM \`${table}\` LIKE 'hide_existence'`);
  if (cols.length) { console.log(`[access-requests] ${table}.hide_existence 이미 있음 — skip`); return; }
  await sequelize.query(`ALTER TABLE \`${table}\` ADD COLUMN hide_existence TINYINT(1) NOT NULL DEFAULT 0`);
  console.log(`[access-requests] ${table}.hide_existence 추가`);
}

async function run() {
  await addCol('files');
  await addCol('posts');
  const AccessRequest = require('../models/AccessRequest');
  await AccessRequest.sync();   // 없을 때만 만든다(alter 없음)
  console.log('[access-requests] access_requests 표 확인');
}

run()
  .then(() => process.exit(0))
  .catch((e) => { console.error('[access-requests] 실패:', e); process.exit(1); });
