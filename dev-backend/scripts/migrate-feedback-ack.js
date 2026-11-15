// feedback_items.ack_sent_at DATETIME NULL — 멱등. 2026-11-15.
//   접수 확인(고정 문구) 알림을 보낸 시각 — services/feedbackAck. 설계 docs/FEEDBACK_AUTOREPLY_BOARD_DESIGN.md §1.
//   백필 없음(NULL = 안 보냄 · 옛 건에 소급 발송하지 않는다 — 접수 순간에만 보낸다).
//   배포는 sync(alter)가 먼저 칸을 만들 수 있다 — 있으면 건너뛰고 형만 검증한다. 코드보다 먼저(배포 슬롯).
// 롤백: additive 컬럼이라 옛 코드에 무해. **코드만 되돌리고 컬럼은 남긴다**
//   (models/FeedbackItem.js 선언까지 되돌리면 sync 가 컬럼을 DROP 한다).
require('dotenv').config();
const { sequelize } = require('../config/database');
async function typeOf(col) {
  const [r] = await sequelize.query(`SELECT COLUMN_TYPE t FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'feedback_items' AND COLUMN_NAME = :col`, { replacements: { col } });
  return r[0] ? r[0].t : null;
}
(async () => {
  try {
    if (await typeOf('ack_sent_at')) console.log('[migrate-feedback-ack] ack_sent_at 이미 있음 — skip');
    else { await sequelize.query('ALTER TABLE feedback_items ADD COLUMN ack_sent_at DATETIME NULL'); console.log('[migrate-feedback-ack] ack_sent_at 추가'); }
    const t = await typeOf('ack_sent_at');
    if (!t || !/datetime/i.test(t)) { console.error('[migrate-feedback-ack] 검증 실패', t); process.exit(1); }
    console.log('[migrate-feedback-ack] OK');
    await sequelize.close(); process.exit(0);
  } catch (e) { console.error('[migrate-feedback-ack] 실패:', e.message); process.exit(1); }
})();
