// feedback_items.reply_seen_at DATETIME NULL — 멱등. 2026-10-15.
//   문의·피드백 답변을 «확인필요» 와 문의·피드백 메뉴 배지에 넣는다(답 있음 ∧ reply_seen_at NULL = 안 읽은 답).
//   ★ 백필: 이 칸이 생기기 전에 받은 답은 **읽은 것으로** 둔다(reply_seen_at = responded_at, 없으면 지금).
//     안 그러면 배포하는 순간 옛 답변 전부가 모든 사람의 확인필요에 한꺼번에 뜬다.
//     백필은 칸을 **이번에 처음 만들었을 때만** 한다 — 다시 돌려도 그 사이 온 새 답을 읽음으로 덮지 않는다.
// 롤백: additive 컬럼이라 옛 코드에 무해. **코드만 되돌리고 컬럼은 남긴다**
//   (models/FeedbackItem.js 선언까지 되돌리면 sync 가 컬럼을 DROP 한다).
require('dotenv').config();
const { sequelize } = require('../config/database');
async function has() {
  const [r] = await sequelize.query(`SELECT COLUMN_TYPE t FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'feedback_items' AND COLUMN_NAME = 'reply_seen_at'`);
  return r[0] ? r[0].t : null;
}
(async () => {
  try {
    if (!(await has())) {
      await sequelize.query('ALTER TABLE feedback_items ADD COLUMN reply_seen_at DATETIME NULL AFTER responded_at');
      const [res] = await sequelize.query(`UPDATE feedback_items
          SET reply_seen_at = COALESCE(responded_at, NOW())
        WHERE admin_response IS NOT NULL AND TRIM(admin_response) <> '' AND reply_seen_at IS NULL`);
      console.log(`[migrate-feedback-reply-seen] reply_seen_at 추가 · 옛 답변 읽음 백필 ${res && res.affectedRows != null ? res.affectedRows : '?'}건`);
    } else console.log('[migrate-feedback-reply-seen] reply_seen_at 이미 있음 — skip');
    const t = await has();
    if (!t || !/datetime/i.test(t)) { console.error('[migrate-feedback-reply-seen] 검증 실패', t); process.exit(1); }
    const [[u]] = await sequelize.query(`SELECT COUNT(*) n FROM feedback_items
      WHERE admin_response IS NOT NULL AND TRIM(admin_response) <> '' AND reply_seen_at IS NULL`);
    console.log('[migrate-feedback-reply-seen] OK', t, '· 안 읽은 답', u.n);
    await sequelize.close(); process.exit(0);
  } catch (e) { console.error('[migrate-feedback-reply-seen] 실패:', e.message); process.exit(1); }
})();
