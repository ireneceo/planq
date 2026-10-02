// 무료 업무체계 자가진단(#426) — 스키마. 멱등. 2026-10-02.
//   ① contact_inquiries.kind ENUM 끝에 'diagnosis' append (옛 값 순서 유지)
//   ② diagnosis_responses 표 신설(없을 때만)
// **코드 배포 전에** 실행한다 — 이메일을 남긴 진단이 kind='diagnosis' 로 문의를 만드는데 ENUM 에 없으면 실패한다.
// 롤백: additive — 코드만 되돌리고 스키마는 남긴다.
require('dotenv').config();
const { sequelize } = require('../config/database');

async function colType(table, col) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, col] });
  return rows[0] ? String(rows[0].COLUMN_TYPE) : null;
}
async function hasTable(t) {
  const [rows] = await sequelize.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', { replacements: [t] });
  return rows.length > 0;
}

(async () => {
  try {
    let k = await colType('contact_inquiries', 'kind');
    if (!k) throw new Error('contact_inquiries.kind 없음');
    if (!k.includes("'diagnosis'")) {
      const vals = k.replace(/^enum\(/i, '').replace(/\)$/, '');
      await sequelize.query(`ALTER TABLE contact_inquiries MODIFY COLUMN kind ENUM(${vals},'diagnosis') NOT NULL`);
      console.log('[migrate-diagnosis] contact_inquiries.kind 에 diagnosis 추가');
    } else console.log('[migrate-diagnosis] kind diagnosis 이미 있음 — skip');
    if (!(await hasTable('diagnosis_responses'))) {
      await require('../models').DiagnosisResponse.sync();
      console.log('[migrate-diagnosis] diagnosis_responses 생성');
    } else console.log('[migrate-diagnosis] diagnosis_responses 이미 있음 — skip');
    if (!(await colType('diagnosis_responses', 'claim_hash'))) {
      await sequelize.query('ALTER TABLE diagnosis_responses ADD COLUMN claim_hash VARCHAR(64) NULL');
      console.log('[migrate-diagnosis] diagnosis_responses.claim_hash 추가');
    }
    k = await colType('contact_inquiries', 'kind');
    const miss = [];
    if (!k.includes("'diagnosis'")) miss.push('kind diagnosis');
    if (!(await hasTable('diagnosis_responses'))) miss.push('diagnosis_responses');
    if (!(await colType('diagnosis_responses', 'claim_hash'))) miss.push('claim_hash');
    if (miss.length) { console.error('[migrate-diagnosis] 검증 실패:', miss.join(', ')); process.exit(1); }
    console.log('[migrate-diagnosis] OK');
    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error('[migrate-diagnosis] 실패:', e.message);
    process.exit(1);
  }
})();
