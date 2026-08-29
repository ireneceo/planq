// #235 Phase 1 — 메일 업무 자동추출 스키마. 멱등.
//
// Fable 판정 (2026-08-29):
//   · 단위는 **계정 컬럼** `auto_extract_scope`. 기존 `notify_scope` 의 정확한 미러라
//     사용자에게 이미 익숙한 어휘("답변 필요만 / 확인 권장까지")를 그대로 쓴다.
//   · 탭 단위 컬럼을 따로 만들지 않는다 — 탭은 reply_needed/status 의 **파생 뷰**라
//     스레드가 탭을 옮기면 의미가 깨진다.
//   · default 'off' — 제품 opt-in. env 킬스위치를 만들지 않는다(계정 컬럼 자체가 스위치).
//
//   · `email_threads.last_extracted_email_message_id` — 채팅의 last_extracted_message_id 미러.
//     없으면 수신할 때마다 스레드 전체를 다시 추출한다.
const { sequelize } = require('../config/database');

async function hasColumn(table, col) {
  const [r] = await sequelize.query(
    `SELECT COUNT(*) n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:t AND COLUMN_NAME=:c`,
    { replacements: { t: table, c: col } });
  return Number(r[0].n) > 0;
}

(async () => {
  let changed = 0;
  if (await hasColumn('email_accounts', 'auto_extract_scope')) {
    console.log('✓ email_accounts.auto_extract_scope 이미 존재 — skip');
  } else {
    await sequelize.query(
      "ALTER TABLE email_accounts ADD COLUMN auto_extract_scope " +
      "ENUM('off','reply_needed','recommended') NOT NULL DEFAULT 'off'");
    console.log("+ email_accounts.auto_extract_scope 추가 (default 'off' — opt-in)");
    changed += 1;
  }
  if (await hasColumn('email_threads', 'last_extracted_email_message_id')) {
    console.log('✓ email_threads.last_extracted_email_message_id 이미 존재 — skip');
  } else {
    await sequelize.query('ALTER TABLE email_threads ADD COLUMN last_extracted_email_message_id INT NULL');
    console.log('+ email_threads.last_extracted_email_message_id 추가');
    changed += 1;
  }

  // 검산 — 기본값이 off 가 아니면 배포 즉시 전 계정에서 자동추출이 돈다(비용 사고).
  const [d] = await sequelize.query(
    "SELECT COUNT(*) c FROM email_accounts WHERE auto_extract_scope <> 'off'");
  console.log(`· 검산: off 가 아닌 계정 ${d[0].c}곳 (신규 배포 직후엔 0 이어야 함)`);
  const [t] = await sequelize.query(
    "SHOW COLUMNS FROM email_accounts LIKE 'auto_extract_scope'");
  const def = t[0] && t[0].Default;
  console.log(`· 검산: 기본값 = ${def}`);
  if (def !== 'off') { console.error("FATAL 기본값이 off 가 아니다 — 전 계정에서 자동추출이 돈다"); process.exit(1); }

  console.log(`[migrate-mail-auto-extract] 완료 — 변경 ${changed}건 (멱등)`);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
