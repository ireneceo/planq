// 내 명함 — name_cards · saved_name_cards 표 만들기. 멱등. 2026-10-17. 설계 docs/BUSINESS_CARD_DESIGN.md
//
// 모델이 두 표를 읽으므로 **PM2 reload 전**(배포 슬롯). 만든 뒤 information_schema 로 다시 확인하고 없으면 exit 1.
// 롤백: 새 표라 옛 코드에 무해하다. 코드만 되돌리고 표는 남긴다(사람들의 명함·보관본이 들어 있다).
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
    await sequelize.query(`CREATE TABLE IF NOT EXISTS name_cards (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      label VARCHAR(60) NOT NULL,
      source_business_id INT NULL,
      name VARCHAR(100) NULL, name_en VARCHAR(100) NULL,
      job_title VARCHAR(100) NULL, department VARCHAR(100) NULL, company VARCHAR(150) NULL,
      intro VARCHAR(500) NULL,
      mobile VARCHAR(40) NULL, phone VARCHAR(40) NULL, fax VARCHAR(40) NULL,
      email VARCHAR(150) NULL, website VARCHAR(300) NULL, address VARCHAR(300) NULL,
      links JSON NULL, accent_color VARCHAR(7) NULL,
      has_photo TINYINT(1) NOT NULL DEFAULT 0, photo_ver INT NOT NULL DEFAULT 0,
      public_token VARCHAR(32) NOT NULL,
      is_public TINYINT(1) NOT NULL DEFAULT 1,
      sort_order INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
      UNIQUE KEY name_cards_public_token (public_token),
      KEY name_cards_user_id_sort_order (user_id, sort_order),
      CONSTRAINT name_cards_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await sequelize.query(`CREATE TABLE IF NOT EXISTS saved_name_cards (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      source_card_id INT NULL,
      snapshot JSON NOT NULL,
      source_updated_at DATETIME NULL,
      has_photo TINYINT(1) NOT NULL DEFAULT 0,
      memo VARCHAR(500) NULL,
      created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
      UNIQUE KEY saved_name_cards_user_id_source_card_id (user_id, source_card_id),
      CONSTRAINT saved_name_cards_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT saved_name_cards_source_fk FOREIGN KEY (source_card_id) REFERENCES name_cards(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    for (const t of ['name_cards', 'saved_name_cards']) {
      if (!(await hasTable(t))) { console.error(`[migrate-name-cards] 검증 실패 — ${t} 없음`); process.exit(1); }
    }
    console.log('[migrate-name-cards] OK — name_cards · saved_name_cards');
    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error('[migrate-name-cards] 실패:', e.message);
    process.exit(1);
  }
})();
