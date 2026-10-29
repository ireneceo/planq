// feedback_items.ai_triage JSON · ai_triage_verdict ENUM · ai_triage_at DATETIME — 멱등. 2026-10-29.
//   접수 즉시 AI 원인 조사 결과 칸(docs/FEEDBACK_AI_TRIAGE_DESIGN.md). 백필 없음(NULL = «조사 전»).
//   배포는 sync(alter)가 먼저 칸을 만들 수 있다 — 있으면 건너뛰고 형만 검증한다.
// 롤백: additive 컬럼이라 옛 코드에 무해. **코드만 되돌리고 컬럼은 남긴다**
//   (models/FeedbackItem.js 선언까지 되돌리면 sync 가 컬럼을 DROP 한다).
require('dotenv').config();
const { sequelize } = require('../config/database');
const VERDICT_ENUM = "ENUM('already_fixed','needs_fix','needs_decision','not_dev','unclear','failed')";
const COLS = [
  ['ai_triage', 'JSON NULL', /json/i],
  ['ai_triage_verdict', `${VERDICT_ENUM} NULL`, /^enum\('already_fixed','needs_fix','needs_decision','not_dev','unclear','failed'\)$/i],
  ['ai_triage_at', 'DATETIME NULL', /datetime/i],
];
async function typeOf(col) {
  const [r] = await sequelize.query(`SELECT COLUMN_TYPE t FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'feedback_items' AND COLUMN_NAME = :col`, { replacements: { col } });
  return r[0] ? r[0].t : null;
}
(async () => {
  try {
    for (const [col, ddl] of COLS) {
      if (await typeOf(col)) { console.log(`[migrate-feedback-triage] ${col} 이미 있음 — skip`); continue; }
      await sequelize.query(`ALTER TABLE feedback_items ADD COLUMN ${col} ${ddl}`);
      console.log(`[migrate-feedback-triage] ${col} 추가`);
    }
    for (const [col, , re] of COLS) {
      const t = await typeOf(col);
      if (!t || !re.test(t)) { console.error('[migrate-feedback-triage] 검증 실패', col, t); process.exit(1); }
    }
    const [[n]] = await sequelize.query('SELECT COUNT(*) n FROM feedback_items WHERE ai_triage_at IS NOT NULL');
    console.log('[migrate-feedback-triage] OK · 조사된 건', n.n);
    await sequelize.close(); process.exit(0);
  } catch (e) { console.error('[migrate-feedback-triage] 실패:', e.message); process.exit(1); }
})();
