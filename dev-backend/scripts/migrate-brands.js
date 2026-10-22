// 브랜드 — brands · name_card_brands 표 만들기 + 워크스페이스마다 기본 브랜드 1행 시드(멱등). 2026-10-22
//   설계 docs/NAME_CARD_V2_DESIGN.md 6절 결정 1·2(Fable). 배포 슬롯: PM2 reload 전(모델이 표를 읽는다).
//   시드: 삭제 안 된 워크스페이스 중 brands(owner_kind='business') 0건인 곳에 brand_name || name 으로 is_default=1 행.
//     tagline·logo 도 옛 칸에서 복사 — 이후 정본은 brands, 옛 칸은 services/brands.js 가 쓰는 사본이다.
//   다시 돌리면 0건. 롤백: 코드만 되돌리고 표는 남긴다(옛 칸이 사본이라 옛 코드는 그대로 돈다).
require('dotenv').config();
const { sequelize } = require('../config/database');

async function hasTable(name) {
  const [rows] = await sequelize.query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    { replacements: [name] });
  return rows.length > 0;
}

(async () => {
  try {
    await sequelize.query(`CREATE TABLE IF NOT EXISTS brands (
      id INT AUTO_INCREMENT PRIMARY KEY,
      owner_kind ENUM('business','user') NOT NULL,
      business_id INT NULL, user_id INT NULL,
      name VARCHAR(100) NOT NULL, name_en VARCHAR(100) NULL,
      tagline VARCHAR(200) NULL, tagline_en VARCHAR(200) NULL,
      logo_url VARCHAR(500) NULL, links JSON NULL,
      is_default TINYINT(1) NOT NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 0,
      created_by INT NULL,
      created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
      KEY brands_biz_sort (business_id, sort_order),
      KEY brands_user_sort (user_id, sort_order),
      CONSTRAINT brands_biz_fk FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
      CONSTRAINT brands_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await sequelize.query(`CREATE TABLE IF NOT EXISTS name_card_brands (
      card_id INT NOT NULL, brand_id INT NOT NULL, sort_order INT NOT NULL DEFAULT 0,
      PRIMARY KEY (card_id, brand_id),
      KEY name_card_brands_brand (brand_id),
      CONSTRAINT ncb_card_fk FOREIGN KEY (card_id) REFERENCES name_cards(id) ON DELETE CASCADE,
      CONSTRAINT ncb_brand_fk FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    for (const t of ['brands', 'name_card_brands']) {
      if (!(await hasTable(t))) { console.error(`[migrate-brands] 검증 실패 — ${t} 없음`); process.exit(1); }
    }
    // ★ sequelize 의 raw INSERT 는 [insertId, affectedRows] 를 준다 — 첫 값은 건수가 아니다(memory feedback_sequelize_insert_returns_id_first)
    const [, affected] = await sequelize.query(`
      INSERT INTO brands (owner_kind, business_id, name, name_en, tagline, tagline_en, logo_url, is_default, sort_order, created_by, created_at, updated_at)
      SELECT 'business', b.id, LEFT(COALESCE(NULLIF(TRIM(b.brand_name), ''), b.name), 100), LEFT(b.brand_name_en, 100),
             LEFT(b.brand_tagline, 200), LEFT(b.brand_tagline_en, 200), b.brand_logo_url, 1, 0, b.owner_id, NOW(), NOW()
        FROM businesses b
       WHERE NOT EXISTS (SELECT 1 FROM brands x WHERE x.owner_kind = 'business' AND x.business_id = b.id)`);
    console.log(`[migrate-brands] OK — 표 2 · 기본 브랜드 시드 ${Number(affected) || 0}행`);
    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error('[migrate-brands] 실패:', e.message);
    process.exit(1);
  }
})();
