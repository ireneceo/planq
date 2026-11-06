// 회사 공용 메일함의 «책임자» — email_accounts.responsible_user_id. 멱등.
//
// Fable 설계 (2026-11-06, DESIGN-READY):
//   · 한 사람 · 회사 공용 메일함만. NULL = 지정 안 함 = 아무 표시 없음 + 지금처럼 공유 큐.
//   · owner_user_id(개인 메일 주인 = 접근 격리)와 다른 축 — 보는 권한은 그대로, 표시·확인필요 귀속만.
//   · 확인필요 귀속: 스레드 답변 담당 > 메일함 책임자(활성 멤버) > 접근자 전원 (services/mailTodoWhere).
//   · 백필 없음 — NULL 이 곧 지금 동작이다.
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
  if (await hasColumn('email_accounts', 'responsible_user_id')) {
    console.log('✓ email_accounts.responsible_user_id 이미 존재 — skip');
  } else {
    await sequelize.query('ALTER TABLE email_accounts ADD COLUMN responsible_user_id INT NULL AFTER owner_user_id');
    await sequelize.query(
      'ALTER TABLE email_accounts ADD CONSTRAINT fk_email_accounts_responsible ' +
      'FOREIGN KEY (responsible_user_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE');
    console.log('+ email_accounts.responsible_user_id 추가 (NULL = 지정 안 함, FK users SET NULL)');
    changed += 1;
  }
  const [d] = await sequelize.query('SELECT COUNT(*) c FROM email_accounts WHERE responsible_user_id IS NOT NULL AND owner_user_id IS NOT NULL');
  console.log(`· 검산: 개인 메일함에 책임자가 있는 행 ${d[0].c} (0 이어야 함)`);
  console.log(`[migrate-mail-responsible] 완료 — 변경 ${changed}건 (멱등)`);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
