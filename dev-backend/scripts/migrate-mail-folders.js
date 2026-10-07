// Q mail — 업체 보낸편지함·스팸함 가져오기 스키마. 멱등.
//   설계: docs/MAIL_SENT_SPAM_SYNC_DESIGN.md (Fable 판정 2026-10-07 절 우선)
//
//   ① email_account_folders — 계정 × 역할(sent/spam) 폴더 커서. UNIQUE(account_id, role)
//   ② email_messages.source_folder ENUM('inbox','sent','spam') NOT NULL DEFAULT 'inbox'
//      — 옛 행은 전부 'inbox' 가 된다(지금까지 INBOX 만 읽었으므로 사실 그대로다. 백필 불필요)
//   ③ email_messages.internal_only TINYINT(1) NOT NULL DEFAULT 0
//   ④ email_threads.spam_origin ENUM('provider') NULL · spam_since DATETIME NULL
//      — 옛 행은 NULL(= 사용자가 고른 스팸 또는 스팸 아님). 30일 삭제는 provider 만 본다.
//
// ★ **코드보다 먼저 돈다** — 모델이 이 컬럼들을 선언하므로 없으면 메일 조회가 500 이다.
// 롤백: 코드 롤백만으로 충분하다(새 컬럼·표는 옛 코드가 읽지 않는다). 컬럼을 지우지 않는다.
const { sequelize } = require('../config/database');

async function hasColumn(table, col) {
  const [r] = await sequelize.query(
    `SELECT COUNT(*) n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:t AND COLUMN_NAME=:c`,
    { replacements: { t: table, c: col } });
  return Number(r[0].n) > 0;
}
async function hasTable(table) {
  const [r] = await sequelize.query(
    `SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:t`,
    { replacements: { t: table } });
  return Number(r[0].n) > 0;
}

(async () => {
  let changed = 0;

  if (await hasTable('email_account_folders')) {
    console.log('✓ email_account_folders 이미 존재 — skip');
  } else {
    await sequelize.query(`
      CREATE TABLE email_account_folders (
        id INT NOT NULL AUTO_INCREMENT,
        account_id INT NOT NULL,
        role ENUM('sent','spam') NOT NULL,
        folder VARCHAR(255) NULL,
        uid_validity BIGINT NULL,
        last_uid INT NOT NULL DEFAULT 0,
        last_synced_at DATETIME NULL,
        last_error VARCHAR(1000) NULL,
        enabled TINYINT(1) NOT NULL DEFAULT 1,
        discovered_at DATETIME NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY email_account_folders_account_role (account_id, role),
        CONSTRAINT email_account_folders_account_fk FOREIGN KEY (account_id)
          REFERENCES email_accounts (id) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    console.log('+ email_account_folders 생성');
    changed += 1;
  }

  const cols = [
    ['email_messages', 'source_folder', "ALTER TABLE email_messages ADD COLUMN source_folder ENUM('inbox','sent','spam') NOT NULL DEFAULT 'inbox'"],
    ['email_messages', 'internal_only', 'ALTER TABLE email_messages ADD COLUMN internal_only TINYINT(1) NOT NULL DEFAULT 0'],
    ['email_threads', 'spam_origin', "ALTER TABLE email_threads ADD COLUMN spam_origin ENUM('provider') NULL DEFAULT NULL"],
    ['email_threads', 'spam_since', 'ALTER TABLE email_threads ADD COLUMN spam_since DATETIME NULL'],
  ];
  for (const [t, c, sql] of cols) {
    if (await hasColumn(t, c)) { console.log(`✓ ${t}.${c} 이미 존재 — skip`); continue; }
    await sequelize.query(sql);
    console.log(`+ ${t}.${c} 추가`);
    changed += 1;
  }

  // 검산 — 옛 행이 provider 스팸으로 잡혀 있으면 안 된다(30일 삭제 대상이 된다)
  const [bad] = await sequelize.query(
    "SELECT COUNT(*) c FROM email_threads WHERE spam_origin='provider' AND (spam_since IS NULL OR status <> 'spam')");
  console.log(`· 검산: provider 스팸인데 spam_since 없음/상태 불일치 ${bad[0].c}행 (0 이어야 정상)`);
  console.log(`[migrate-mail-folders] 완료 — 변경 ${changed}건 (멱등)`);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
