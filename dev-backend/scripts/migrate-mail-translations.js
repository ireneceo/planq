// email_messages.translations JSON NULL — 멱등. 2026-10-30 (메일 번역 저장 — services/mailTranslate).
//   기존 행은 NULL(번역한 적 없음) — 백필 없음. 재조회로 판정하고 미충족이면 exit 1.
// ★ 순서: PM2 reload 보다 먼저 — 모델이 이 칸을 선언하므로 없으면 메일 메시지 조회 전체가 500.
// 롤백: additive 컬럼이라 옛 코드에 무해. **코드만 되돌리고 컬럼은 남긴다**
//   (models/EmailMessage.js 선언까지 되돌리면 sync 가 컬럼을 DROP 해 저장된 번역이 사라진다).
require('dotenv').config();
const { sequelize } = require('../config/database');
async function has() {
  const [r] = await sequelize.query(`SELECT DATA_TYPE t FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_messages' AND COLUMN_NAME = 'translations'`);
  return r[0] ? r[0].t : null;
}
(async () => {
  try {
    if (!(await has())) {
      await sequelize.query('ALTER TABLE email_messages ADD COLUMN translations JSON NULL');
      console.log('[migrate-mail-translations] translations 추가');
    } else console.log('[migrate-mail-translations] translations 이미 있음 — skip');
    const t = await has();
    if (!t || !/json/i.test(t)) { console.error('[migrate-mail-translations] 검증 실패', t); process.exit(1); }
    console.log('[migrate-mail-translations] OK', t);
    await sequelize.close(); process.exit(0);
  } catch (e) { console.error('[migrate-mail-translations] 실패:', e.message); process.exit(1); }
})();
