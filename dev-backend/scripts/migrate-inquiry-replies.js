// contact_inquiry_replies 표 — 문의에 PlanQ 가 직접 보낸 회신 기록. 멱등. 2026-11-15.
//   설계 docs/INQUIRY_DIRECT_REPLY_DESIGN.md (Fable DESIGN: FIX 반영). 쓰는 문 services/inquiryReply 하나.
//   sync-database 가 모델로 먼저 만들 수 있다 — 그러면 «이미 있음» 으로 끝나고 FK·색인만 확인한다.
//   코드보다 먼저(PM2 reload 전) — 관리자 문의 목록이 이 표를 센다(reply_count). 롤백은 코드만(표는 남겨도 무해).
require('dotenv').config();
const { sequelize } = require('../config/database');

async function tableExists() {
  const [r] = await sequelize.query("SHOW TABLES LIKE 'contact_inquiry_replies'");
  return r.length > 0;
}
async function fkCount() {
  const [r] = await sequelize.query(`SELECT REFERENCED_TABLE_NAME t, DELETE_RULE d FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'contact_inquiry_replies'`);
  return r;
}
(async () => {
  try {
    if (await tableExists()) {
      console.log('[migrate-inquiry-replies] 표 이미 있음 — 만들기 건너뜀');
    } else {
      await sequelize.query(`CREATE TABLE contact_inquiry_replies (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        inquiry_id INT NOT NULL,
        sent_by_user_id INT NULL,
        to_email VARCHAR(200) NOT NULL,
        subject VARCHAR(300) NOT NULL,
        body TEXT NOT NULL,
        locale VARCHAR(8) NULL,
        status ENUM('sending','sent','failed','skipped') NOT NULL DEFAULT 'sending',
        error_message VARCHAR(1000) NULL,
        sent_at DATETIME NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        KEY cir_inquiry_created (inquiry_id, created_at),
        KEY cir_sender_created (sent_by_user_id, created_at),
        CONSTRAINT cir_inquiry_fk FOREIGN KEY (inquiry_id) REFERENCES contact_inquiries(id) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT cir_sender_fk FOREIGN KEY (sent_by_user_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      console.log('[migrate-inquiry-replies] 표 만듦');
    }
    if (!(await tableExists())) { console.error('[migrate-inquiry-replies] 검증 실패: 표 없음'); process.exit(1); }
    const fks = await fkCount();
    const inq = fks.find(f => f.t === 'contact_inquiries');
    if (!inq) { console.error('[migrate-inquiry-replies] 검증 실패: contact_inquiries FK 없음', JSON.stringify(fks)); process.exit(1); }
    console.log(`[migrate-inquiry-replies] OK (FK ${fks.map(f => `${f.t}:${f.d}`).join(', ')})`);
    await sequelize.close(); process.exit(0);
  } catch (e) { console.error('[migrate-inquiry-replies] 실패:', e.message); process.exit(1); }
})();
