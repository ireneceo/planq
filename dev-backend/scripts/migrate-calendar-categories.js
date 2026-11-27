#!/usr/bin/env node
// 일정 분류 커스텀(2026-11-27) — calendar_categories 표 + calendar_events.category_id + 씨앗 + 백필. 멱등.
//
//   설계: docs/CALENDAR_CATEGORIES_DESIGN.md §1
//
// ★ **코드 배포 전에** 돌린다. 칸이 없는 채 새 코드가 뜨면 일정 목록이 `Unknown column category_id` 로 500 이다.
//
// ── 무엇을 하나 ───────────────────────────────────────────────────────────
//   ① calendar_categories 표(없으면)
//   ② calendar_events.category_id INT NULL + 인덱스(business_id, category_id) + FK(RESTRICT)
//   ③ 모든 워크스페이스에 시스템 분류 5개(meeting·work·deadline·personal·other) — 없을 때만
//   ④ 백필: category_id IS NULL 인 일정 → 같은 business 의 code = category 행
//   옛 category(ENUM)는 **값을 바꾸지 않는다**(거울로 유지 — 롤백·옛 번들 호환). 스크립트가 전후 분포를 대조한다.
//
// 사용:  node scripts/migrate-calendar-categories.js         (적용)
//        node scripts/migrate-calendar-categories.js --dry   (무엇을 할지만 출력)
require('dotenv').config();
const { sequelize } = require('../config/database');

const DRY = process.argv.includes('--dry');
const log = (...a) => console.log('[calendar-categories]', ...a);
const SYSTEM = [['meeting', 0], ['work', 1], ['deadline', 2], ['personal', 3], ['other', 4]];
const IDX = 'calendar_events_biz_category';
const FK = 'calendar_events_category_id_fk';

const TABLE_SQL = `CREATE TABLE IF NOT EXISTS calendar_categories (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL,
  code VARCHAR(20) NULL,
  name VARCHAR(30) NULL,
  color VARCHAR(7) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_by INT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY calendar_categories_biz_code (business_id, code),
  KEY calendar_categories_biz_active (business_id, is_active, sort_order),
  CONSTRAINT calendar_categories_business_fk FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT calendar_categories_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

async function distribution() {
  const [rows] = await sequelize.query('SELECT category, COUNT(*) n FROM calendar_events GROUP BY category ORDER BY category');
  return JSON.stringify(rows.map((r) => [r.category, Number(r.n)]));
}

(async () => {
  try {
    const [[tbl]] = await sequelize.query("SHOW TABLES LIKE 'calendar_categories'");
    const [[col]] = await sequelize.query("SHOW COLUMNS FROM calendar_events WHERE Field = 'category_id'");
    const [idx] = await sequelize.query(`SHOW INDEX FROM calendar_events WHERE Key_name = '${IDX}'`);
    const [fk] = await sequelize.query(
      "SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'calendar_events' AND CONSTRAINT_NAME = ?",
      { replacements: [FK] });
    const [[{ biz }]] = await sequelize.query('SELECT COUNT(*) biz FROM businesses');

    if (DRY) {
      log('--dry — 실행할 것:');
      log(tbl ? '  ① (건너뜀 — 표 있음)' : '  ① CREATE TABLE calendar_categories');
      log(col ? '  ② 칸 (건너뜀)' : '  ② ALTER TABLE calendar_events ADD COLUMN category_id INT NULL');
      log(idx.length ? '  ② 인덱스 (건너뜀)' : `  ② CREATE INDEX ${IDX}`);
      log(fk.length ? '  ② FK (건너뜀)' : `  ② ADD CONSTRAINT ${FK}`);
      log(`  ③ 워크스페이스 ${biz}개 × 시스템 5개 (없는 것만)`);
      if (col) {
        const [[{ n }]] = await sequelize.query('SELECT COUNT(*) n FROM calendar_events WHERE category_id IS NULL');
        log(`  ④ 백필 대상 ${n}건`);
      } else log('  ④ 백필 — 칸을 만든 뒤 전부');
      process.exit(0);
    }

    const before = await distribution();
    log('적용 전 category 분포:', before);

    if (!tbl) { await sequelize.query(TABLE_SQL); log('① 표 생성'); } else log('① 건너뜀 — 표 있음');
    if (!col) { await sequelize.query('ALTER TABLE calendar_events ADD COLUMN category_id INT NULL DEFAULT NULL AFTER category'); log('② 칸 추가'); } else log('② 칸 건너뜀');
    if (!idx.length) { await sequelize.query(`CREATE INDEX ${IDX} ON calendar_events (business_id, category_id)`); log('② 인덱스 추가'); } else log('② 인덱스 건너뜀');
    if (!fk.length) {
      await sequelize.query(`ALTER TABLE calendar_events ADD CONSTRAINT ${FK} FOREIGN KEY (category_id) REFERENCES calendar_categories(id) ON DELETE RESTRICT ON UPDATE CASCADE`);
      log('② FK 추가');
    } else log('② FK 건너뜀');

    let seeded = 0;
    for (const [code, order] of SYSTEM) {
      const [r] = await sequelize.query(
        `INSERT IGNORE INTO calendar_categories (business_id, code, name, color, is_active, sort_order, created_at, updated_at)
         SELECT b.id, ?, NULL, NULL, 1, ?, NOW(), NOW() FROM businesses b`,
        { replacements: [code, order] });
      seeded += Number(r?.affectedRows || 0);
    }
    log(`③ 시스템 분류 새로 심음 ${seeded}행`);

    const [bf] = await sequelize.query(
      `UPDATE calendar_events e JOIN calendar_categories c ON c.business_id = e.business_id AND c.code = e.category
       SET e.category_id = c.id WHERE e.category_id IS NULL`);
    log(`④ 백필 ${Number(bf?.affectedRows || 0)}건`);

    const after = await distribution();
    const [[{ left }]] = await sequelize.query('SELECT COUNT(*) \`left\` FROM calendar_events WHERE category_id IS NULL');
    const [[{ mismatch }]] = await sequelize.query(
      `SELECT COUNT(*) mismatch FROM calendar_events e JOIN calendar_categories c ON c.id = e.category_id
       WHERE c.business_id <> e.business_id OR (c.code IS NOT NULL AND c.code <> e.category) OR (c.code IS NULL AND e.category <> 'other')`);
    const [[{ perBiz }]] = await sequelize.query(
      'SELECT COUNT(*) perBiz FROM (SELECT b.id FROM businesses b LEFT JOIN calendar_categories c ON c.business_id = b.id AND c.code IS NOT NULL GROUP BY b.id HAVING COUNT(c.id) <> 5) x');
    log('적용 후 category 분포:', after);
    log(`검사: 남은 NULL ${left} · 분류/거울 어긋남 ${mismatch} · 시스템 5개가 아닌 워크스페이스 ${perBiz}`);
    if (before !== after || Number(left) || Number(mismatch) || Number(perBiz)) {
      console.error('[calendar-categories] 실패: 위 검사 중 0 이 아닌 값이 있다');
      process.exit(1);
    }
    log('완료');
    process.exit(0);
  } catch (e) {
    console.error('[calendar-categories] 실패:', e.message);
    process.exit(1);
  }
})();
