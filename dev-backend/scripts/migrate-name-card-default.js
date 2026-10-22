// 워크스페이스 기본 명함 — business_members.default_card_id INT NULL (FK name_cards ON DELETE SET NULL). 멱등. 2026-10-22
//   설계 docs/NAME_CARD_V2_DESIGN.md 결정 3. 모델(BusinessMember)이 SELECT 하므로 PM2 reload 전 — 없으면 멤버 조회 전부 500.
//   ★ name_cards 표가 먼저 있어야 한다(migrate-name-cards.js 다음 슬롯).
//   롤백: 코드만 되돌리고 칸은 남긴다(모델 선언까지 되돌리면 sync 가 칸을 DROP 해 사람들의 기본 명함 지정이 사라진다).
require('dotenv').config();
const { sequelize } = require('../config/database');

async function has(sql, rep) { const [rows] = await sequelize.query(sql, { replacements: rep }); return rows.length > 0; }

(async () => {
  try {
    const col = () => has(`SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='business_members' AND COLUMN_NAME='default_card_id'`);
    if (!(await col())) {
      await sequelize.query('ALTER TABLE business_members ADD COLUMN default_card_id INT NULL');
      console.log('[migrate-name-card-default] business_members.default_card_id 추가');
    } else console.log('[migrate-name-card-default] 칸 이미 있음 — skip');
    const fk = await has(`SELECT 1 FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME='bm_default_card_fk'`);
    if (!fk) {
      await sequelize.query('UPDATE business_members bm LEFT JOIN name_cards c ON c.id = bm.default_card_id SET bm.default_card_id = NULL WHERE bm.default_card_id IS NOT NULL AND c.id IS NULL');
      await sequelize.query('ALTER TABLE business_members ADD CONSTRAINT bm_default_card_fk FOREIGN KEY (default_card_id) REFERENCES name_cards(id) ON DELETE SET NULL');
      console.log('[migrate-name-card-default] FK 추가');
    }
    if (!(await col())) { console.error('[migrate-name-card-default] 검증 실패 — 칸 없음'); process.exit(1); }
    console.log('[migrate-name-card-default] OK');
    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error('[migrate-name-card-default] 실패:', e.message);
    process.exit(1);
  }
})();
