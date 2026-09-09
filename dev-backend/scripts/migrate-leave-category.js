/**
 * leave_grants / leave_requests 에 `category` 추가 — 휴가 종류별 부여·잔여 (2026-09-09)
 *
 *   Irene: "관리자가 멤버에게 휴가 연차나 등등 **종류별로** 제공하는 거 어떻게 줘?"
 *   여태 부여는 "그 해 며칠" 한 통뿐이라 연차 15일과 병가 5일을 구분할 수 없었다.
 *
 * ★ 기존 행은 전부 'annual' 이 된다 — 지금까지 부여·신청한 것은 전부 연차였다.
 *   DEFAULT 'annual' + NOT NULL 이라 백필이 따로 필요 없다(ALTER 가 채운다).
 * ★ 멱등 — 이미 있으면 건너뛴다. 여러 번 돌려도 안전하다.
 * ★ **코드 배포 전에** 돌린다. 컬럼이 없는 상태로 새 코드가 뜨면 조회가 500 이 된다.
 *
 * 실행: node scripts/migrate-leave-category.js
 */
require('dotenv').config();
const { sequelize } = require('../config/database');

const ENUM_DEF = "ENUM('annual','sick','family','other') NOT NULL DEFAULT 'annual'";

async function hasColumn(table, column) {
  const [rows] = await sequelize.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, column] },
  );
  return Number(rows[0].n) > 0;
}

async function addIfMissing(table, column) {
  if (await hasColumn(table, column)) {
    console.log(`  · ${table}.${column} — 이미 있음(건너뜀)`);
    return false;
  }
  await sequelize.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${ENUM_DEF}`);
  console.log(`  ✅ ${table}.${column} 추가 (기존 행은 전부 'annual')`);
  return true;
}

(async () => {
  try {
    await sequelize.authenticate();
    console.log('── 휴가 종류(category) 마이그레이션 ──');
    await addIfMissing('leave_grants', 'category');
    await addIfMissing('leave_requests', 'category');

    // 확인 — 실제로 붙었고 값이 채워졌는가
    for (const t of ['leave_grants', 'leave_requests']) {
      const [rows] = await sequelize.query(
        `SELECT category, COUNT(*) AS n FROM \`${t}\` GROUP BY category`,
      );
      const total = rows.reduce((s, r) => s + Number(r.n), 0);
      console.log(`  ${t}: ${total}행 · ${rows.map(r => `${r.category}=${r.n}`).join(' ') || '(비어 있음)'}`);
      const orphan = rows.find(r => r.category === null);
      if (orphan) throw new Error(`${t} 에 category NULL 행이 ${orphan.n}건 있다 — NOT NULL 이어야 한다`);
    }
    console.log('완료.');
    process.exit(0);
  } catch (e) {
    console.error('🔴 실패:', e.message);
    process.exit(1);
  }
})();
