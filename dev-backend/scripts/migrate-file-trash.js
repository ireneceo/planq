// 파일 휴지통 스키마 — 멱등. 배포 파이프에서 반복 실행돼도 안전하다.
//   ① files.deleted_by  (누가 지웠는가 — 휴지통 표시 + 감사)
//
// 옛 행은 deleted_by 가 NULL 이다. 그때는 기록하지 않았으므로 지어내지 않는다.
// (그리고 그 파일들의 **바이트는 이미 사라졌다** — 복구 대상이 아니다.
//  복구 가능 여부는 이 컬럼이 아니라 실제 바이트 실존으로 판정한다. routes/files.js:isRestorable)
const { sequelize } = require('../config/database');

async function hasColumn(table, col) {
  const [r] = await sequelize.query(
    `SELECT COUNT(*) n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:t AND COLUMN_NAME=:c`,
    { replacements: { t: table, c: col } });
  return Number(r[0].n) > 0;
}

(async () => {
  let changed = 0;
  if (await hasColumn('files', 'deleted_by')) {
    console.log('✓ files.deleted_by 이미 존재 — skip');
  } else {
    await sequelize.query('ALTER TABLE files ADD COLUMN deleted_by INT NULL');
    console.log('+ files.deleted_by 추가'); changed++;
  }
  if (await hasColumn('files', 'purged_at')) {
    console.log('✓ files.purged_at 이미 존재 — skip');
  } else {
    await sequelize.query('ALTER TABLE files ADD COLUMN purged_at DATETIME NULL');
    console.log('+ files.purged_at 추가'); changed++;
  }
  console.log(`[migrate-file-trash] 완료 — 변경 ${changed}건 (멱등)`);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
