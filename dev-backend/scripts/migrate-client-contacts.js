// 고객 담당자 — clients.job_title·department 칸 + client_contacts 표. 멱등. 2026-10-22
//   설계 docs/NAME_CARD_V3_STRATEGY.md 9절 결정 2. 모델(Client·ClientContact)이 SELECT 하므로 PM2 reload 전 — 칸이 없으면 고객 조회 전부 500.
//   ★ name_cards 표가 먼저 있어야 한다(source_card_id FK — migrate-name-cards.js 다음 슬롯). files 는 원래 있다.
//   운영 sync-database(alter) 가 먼저 돌아 표·칸을 만들었으면 여기서는 건너뛰고 검증만 한다.
//   롤백: 코드만 되돌리고 표·칸은 남긴다(모델 선언까지 되돌리면 sync 가 칸을 DROP 해 담당자·직함이 사라진다).
require('dotenv').config();
const { sequelize } = require('../config/database');

async function has(sql, rep) { const [rows] = await sequelize.query(sql, { replacements: rep }); return rows.length > 0; }
const hasCol = (t, c) => has(`SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?`, [t, c]);
const hasTable = (t) => has(`SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME=?`, [t]);

(async () => {
  try {
    for (const c of ['job_title', 'department']) {
      if (!(await hasCol('clients', c))) {
        await sequelize.query(`ALTER TABLE clients ADD COLUMN ${c} VARCHAR(100) NULL`);
        console.log(`[migrate-client-contacts] clients.${c} 추가`);
      }
    }
    if (!(await hasTable('client_contacts'))) {
      await sequelize.query(`CREATE TABLE client_contacts (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        business_id INT NOT NULL,
        client_id INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        name_en VARCHAR(100) NULL,
        job_title VARCHAR(100) NULL,
        department VARCHAR(100) NULL,
        email VARCHAR(200) NULL,
        mobile VARCHAR(40) NULL,
        phone VARCHAR(40) NULL,
        fax VARCHAR(40) NULL,
        address VARCHAR(300) NULL,
        memo VARCHAR(500) NULL,
        photo_file_id INT NULL,
        source ENUM('manual','name_card','photo','mail','chat') NOT NULL DEFAULT 'manual',
        source_card_id INT NULL,
        created_by INT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        KEY client_contacts_biz_email (business_id, email),
        KEY client_contacts_client (client_id),
        CONSTRAINT client_contacts_biz_fk FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
        CONSTRAINT client_contacts_client_fk FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
        CONSTRAINT client_contacts_photo_fk FOREIGN KEY (photo_file_id) REFERENCES files(id) ON DELETE SET NULL,
        CONSTRAINT client_contacts_card_fk FOREIGN KEY (source_card_id) REFERENCES name_cards(id) ON DELETE SET NULL,
        CONSTRAINT client_contacts_user_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      console.log('[migrate-client-contacts] client_contacts 표 만듦');
    } else console.log('[migrate-client-contacts] client_contacts 이미 있음 — skip');
    const ok = (await hasCol('clients', 'job_title')) && (await hasCol('clients', 'department')) && (await hasTable('client_contacts'));
    if (!ok) { console.error('[migrate-client-contacts] 검증 실패'); process.exit(1); }
    console.log('[migrate-client-contacts] OK');
    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error('[migrate-client-contacts] 실패:', e.message);
    process.exit(1);
  }
})();
