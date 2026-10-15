// email_threads.triage_criterion VARCHAR(40) NULL + 인덱스 (business_id, triage_criterion) — 멱등. 2026-10-15.
//   «왜 이 폴더에 왔나» 를 말하는 기준 id(services/mailCriteriaCatalog.js). 설정 화면의 적중 수·끄기 소급의 근거.
//   백필 없음 — NULL = 옛 판정(«기준 모름»). 설계 docs/MAIL_CRITERIA_DESIGN.md §6.3.
// 롤백: additive 컬럼이라 옛 코드에 무해. **코드만 되돌리고 컬럼은 남긴다**
//   (models/EmailThread.js 선언까지 되돌리면 sync 가 컬럼을 DROP 한다).
require('dotenv').config();
const { sequelize } = require('../config/database');
async function col() {
  const [r] = await sequelize.query(`SELECT COLUMN_TYPE t FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_threads' AND COLUMN_NAME = 'triage_criterion'`);
  return r[0] ? r[0].t : null;
}
async function idx() {
  const [r] = await sequelize.query(`SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_threads' AND INDEX_NAME = 'email_threads_biz_criterion'`);
  return r.length > 0;
}
(async () => {
  try {
    if (!(await col())) {
      await sequelize.query('ALTER TABLE email_threads ADD COLUMN triage_criterion VARCHAR(40) NULL AFTER uncertain_reason');
      console.log('[migrate-mail-criteria] triage_criterion 추가');
    } else console.log('[migrate-mail-criteria] triage_criterion 이미 있음 — skip');
    if (!(await idx())) {
      await sequelize.query('CREATE INDEX email_threads_biz_criterion ON email_threads (business_id, triage_criterion)');
      console.log('[migrate-mail-criteria] 인덱스 추가');
    } else console.log('[migrate-mail-criteria] 인덱스 이미 있음 — skip');
    const t = await col();
    if (!t || !/varchar\(40\)/i.test(t) || !(await idx())) { console.error('[migrate-mail-criteria] 검증 실패', t); process.exit(1); }
    console.log('[migrate-mail-criteria] OK', t);
    await sequelize.close(); process.exit(0);
  } catch (e) { console.error('[migrate-mail-criteria] 실패:', e.message); process.exit(1); }
})();
