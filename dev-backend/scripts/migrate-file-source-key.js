// 서명 완료 문서 «파일로 저장» (2026-11-27, 멱등) — files.source_key VARCHAR(100) NULL + 색인 (business_id, source_key).
//   ★ PM2 reload 전: 새 코드의 File 모델이 source_key 를 SELECT 한다 — 컬럼이 없으면 파일 조회가 전부 500.
//   컬럼 추가만(기본 NULL = 지금과 같음) · 기존 행 값 불변. 롤백은 코드만(컬럼은 남겨도 무해 — 옛 코드는 안 읽는다).
const { sequelize } = require('../config/database');

async function run() {
  const [cols] = await sequelize.query("SHOW COLUMNS FROM `files` LIKE 'source_key'");
  if (cols.length) console.log('[file-source-key] files.source_key 이미 있음 — skip');
  else {
    await sequelize.query('ALTER TABLE `files` ADD COLUMN source_key VARCHAR(100) NULL DEFAULT NULL');
    console.log('[file-source-key] files.source_key 추가');
  }
  const [idx] = await sequelize.query("SHOW INDEX FROM `files` WHERE Key_name = 'files_business_source_key'");
  if (idx.length) console.log('[file-source-key] 색인 files_business_source_key 이미 있음 — skip');
  else {
    await sequelize.query('CREATE INDEX files_business_source_key ON `files` (business_id, source_key)');
    console.log('[file-source-key] 색인 files_business_source_key 추가');
  }
}

run()
  .then(() => process.exit(0))
  .catch((e) => { console.error('[file-source-key] 실패:', e.message); process.exit(1); });
