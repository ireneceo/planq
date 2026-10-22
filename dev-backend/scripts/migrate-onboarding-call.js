// 화상 업무설계·사용안내 신청 — 스키마. 멱등. 2026-10-22 (docs/ONBOARDING_CALL_DESIGN.md · Fable 설계 PASS).
//   ① contact_inquiries.kind ENUM 끝에 'onboarding_call' append (옛 값 순서 유지)
//   ② contact_inquiries.details JSON NULL (희망 시간·인원·도구 등 — 신청 당시 플랜·체험 종료일 박제)
//   ③ 인덱스 (business_id, kind, status) — /status 의 «열린 신청» 1회 COUNT
// **코드 배포 전에** 실행한다 — 모델이 details 를 SELECT 하므로 칸이 없으면 문의 화면·접수가 500 이다.
// 롤백: additive — 코드만 되돌리고 스키마는 남긴다.
require('dotenv').config();
const { sequelize } = require('../config/database');

async function colType(table, col) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, col] });
  return rows[0] ? String(rows[0].COLUMN_TYPE) : null;
}
async function hasIndex(table, name) {
  const [rows] = await sequelize.query(
    'SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?',
    { replacements: [table, name] });
  return rows.length > 0;
}

(async () => {
  try {
    const kind = await colType('contact_inquiries', 'kind');
    if (!kind) throw new Error('contact_inquiries.kind 없음');
    if (!kind.includes("'onboarding_call'")) {
      const vals = kind.replace(/^enum\(/i, '').replace(/\)$/, '');
      await sequelize.query(`ALTER TABLE contact_inquiries MODIFY kind ENUM(${vals},'onboarding_call') NOT NULL DEFAULT 'general'`);
      console.log('[migrate-onboarding-call] kind 에 onboarding_call 추가');
    } else console.log('[migrate-onboarding-call] kind onboarding_call 이미 있음 — skip');

    if (!(await colType('contact_inquiries', 'details'))) {
      await sequelize.query('ALTER TABLE contact_inquiries ADD COLUMN details JSON NULL');
      console.log('[migrate-onboarding-call] details 추가');
    } else console.log('[migrate-onboarding-call] details 이미 있음 — skip');

    if (!(await hasIndex('contact_inquiries', 'contact_inquiries_business_kind_status'))) {
      await sequelize.query('CREATE INDEX contact_inquiries_business_kind_status ON contact_inquiries (business_id, kind, status)');
      console.log('[migrate-onboarding-call] 인덱스 추가');
    } else console.log('[migrate-onboarding-call] 인덱스 이미 있음 — skip');

    const after = await colType('contact_inquiries', 'kind');
    if (!after.includes("'onboarding_call'") || !(await colType('contact_inquiries', 'details'))) {
      console.error('[migrate-onboarding-call] 검증 실패'); process.exit(1);
    }
    console.log('[migrate-onboarding-call] OK');
    process.exit(0);
  } catch (e) {
    console.error('[migrate-onboarding-call] 실패:', e.message);
    process.exit(1);
  }
})();
