// migrate-account-deletion.js — 계정 삭제(회원 탈퇴) 스키마 (멱등)
//   ACCOUNT_DELETION_DESIGN v3. App Store 5.1.1(v).
//   users.status ENUM 은 이미 'deleted' 포함 — 변경 불필요.
require('dotenv').config();
const { sequelize } = require('../config/database');

async function hasCol(table, col) {
  const [r] = await sequelize.query(
    `SELECT COUNT(*) c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?`,
    { replacements: [table, col] });
  return r[0].c > 0;
}
async function addCol(table, col, ddl) {
  if (await hasCol(table, col)) { console.log(`✓ ${table}.${col} 이미 존재 — skip`); return; }
  await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  console.log(`✓ ${table}.${col} 추가`);
}

(async () => {
  try {
    // users — 탈퇴 요청/예약/익명화 타임스탬프
    await addCol('users', 'deletion_requested_at', 'deletion_requested_at DATETIME NULL');
    await addCol('users', 'deletion_scheduled_at', 'deletion_scheduled_at DATETIME NULL');
    await addCol('users', 'anonymized_at', 'anonymized_at DATETIME NULL');
    // businesses — 동반 soft-delete (🔴A: 여태 soft-delete 컬럼이 없었다)
    await addCol('businesses', 'deleted_at', 'deleted_at DATETIME NULL');
    // business_members — 복구 시 "이 탈퇴로 removed 된 membership"만 되살리기 위한 구분 마커 (🔴B)
    await addCol('business_members', 'removed_reason', 'removed_reason VARCHAR(40) NULL');

    // 예약 삭제 스캔용 인덱스 (cron: status='deleted' AND deletion_scheduled_at<=NOW())
    const [idx] = await sequelize.query(
      "SELECT COUNT(*) c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND INDEX_NAME='idx_users_deletion_scheduled'");
    if (idx[0].c === 0) {
      await sequelize.query('ALTER TABLE users ADD INDEX idx_users_deletion_scheduled (deletion_scheduled_at)');
      console.log('✓ users idx_users_deletion_scheduled 추가');
    } else console.log('✓ users 예약삭제 인덱스 이미 존재 — skip');

    console.log('\n계정 삭제 스키마 마이그레이션 완료');
    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error('✗ 마이그레이션 실패:', e.message);
    process.exit(1);
  }
})();
