// feedback_items.kind ENUM('feedback','inquiry') NOT NULL DEFAULT 'feedback' — 멱등. 2026-09-21.
//   Irene: "문의인지 피드백인지 관리되게 해. 알아보기 쉽게." 로그인 사용자의 문의도 이 원장에 쌓인다.
//   기존 행은 전부 'feedback'(기본값) — 백필 없음. 재조회로 판정하고 미충족이면 exit 1.
// 롤백: additive 컬럼이라 옛 코드에 무해. **코드만 되돌리고 컬럼은 남긴다**
//   (models/FeedbackItem.js 선언까지 되돌리면 sync 가 컬럼을 DROP 해 문의/피드백 구분이 사라진다).
require('dotenv').config();
const { sequelize } = require('../config/database');
async function has() {
  const [r] = await sequelize.query(`SELECT COLUMN_TYPE t FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'feedback_items' AND COLUMN_NAME = 'kind'`);
  return r[0] ? r[0].t : null;
}
(async () => {
  try {
    if (!(await has())) {
      await sequelize.query("ALTER TABLE feedback_items ADD COLUMN kind ENUM('feedback','inquiry') NOT NULL DEFAULT 'feedback' AFTER parent_id");
      console.log('[migrate-feedback-kind] kind 추가');
    } else console.log('[migrate-feedback-kind] kind 이미 있음 — skip');
    const t = await has();
    if (!t || !/'feedback'/.test(t) || !/'inquiry'/.test(t)) { console.error('[migrate-feedback-kind] 검증 실패', t); process.exit(1); }
    console.log('[migrate-feedback-kind] OK', t);
    await sequelize.close(); process.exit(0);
  } catch (e) { console.error('[migrate-feedback-kind] 실패:', e.message); process.exit(1); }
})();
