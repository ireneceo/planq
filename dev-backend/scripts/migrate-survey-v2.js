// 설문 v2 마이그레이션 — 멱등(매 배포 실행 안전). 설계 docs/SURVEY_V2_DESIGN.md §2.3
//
//   ① posts.kind ENUM 끝에 'survey'(옛 값 순서 불변)
//   ② q_record_rows.survey_issue_id · survey_recipient_id INT NULL + 인덱스(survey_issue_id)
//   ③ survey_issues · survey_recipients · survey_rules 새 표(rules 는 Phase 2 에서 읽는다 — 배포 슬롯을 두 번 쓰지 않으려고 같이 만든다)
//   ④ clients.survey_opt_out_at DATETIME NULL (Phase 2 «더 받지 않기»)
//
//   ★ 코드 배포 **전에** 실행 — Post·QRecordRow·Client 모델이 이 칸을 SELECT 하므로 없으면 문서·표·고객 조회가 500.
//   롤백: 코드 revert(새 컬럼·표·ENUM 값 잔존은 무해).
//   사용: node scripts/migrate-survey-v2.js [--dry]
require('dotenv').config();
const { sequelize } = require('../config/database');
const DRY = process.argv.includes('--dry');
const TAG = '[migrate-survey-v2]';
const run = async (sql, label) => {
  if (DRY) { console.log(`${TAG} (dry) ${sql.replace(/\s+/g, ' ').slice(0, 220)}`); return; }
  await sequelize.query(sql);
  console.log(`${TAG} ${label}`);
};
const col = async (table, column) => {
  const [r] = await sequelize.query(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, { replacements: [column] });
  return r[0] || null;
};
const tableExists = async (table) => {
  const [r] = await sequelize.query('SHOW TABLES LIKE ?', { replacements: [table] });
  return r.length > 0;
};
const indexExists = async (table, name) => {
  const [r] = await sequelize.query(`SHOW INDEX FROM \`${table}\` WHERE Key_name = ?`, { replacements: [name] });
  return r.length > 0;
};
function parseEnum(type) {
  const m = String(type).match(/^enum\((.*)\)$/i);
  return m ? [...m[1].matchAll(/'((?:[^']|'')*)'/g)].map((x) => x[1].replace(/''/g, "'")) : null;
}
async function appendEnum(table, column, values) {
  const c = await col(table, column);
  if (!c) throw new Error(`${table}.${column} 없음`);
  const cur = parseEnum(c.Type);
  if (!cur) throw new Error(`${table}.${column} 가 ENUM 이 아니다: ${c.Type}`);
  const add = values.filter((v) => !cur.includes(v));
  if (!add.length) { console.log(`${TAG} ${table}.${column} 이미 있음 — skip`); return; }
  const next = [...cur, ...add].map((v) => `'${v.replace(/'/g, "''")}'`).join(',');
  const nullClause = c.Null === 'NO' ? 'NOT NULL' : 'NULL';
  const defClause = c.Default != null ? ` DEFAULT '${String(c.Default).replace(/'/g, "''")}'` : '';
  await run(`ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` ENUM(${next}) ${nullClause}${defClause}`, `${table}.${column} +${add.join(',')}`);
}
async function addCol(table, column, ddl) {
  if (await col(table, column)) { console.log(`${TAG} ${table}.${column} 이미 있음 — skip`); return; }
  await run(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${ddl}`, `${table}.${column}`);
}

async function main() {
  await appendEnum('posts', 'kind', ['survey']);

  await addCol('q_record_rows', 'survey_issue_id', 'INT NULL');
  await addCol('q_record_rows', 'survey_recipient_id', 'INT NULL');
  if (!(await indexExists('q_record_rows', 'q_record_rows_survey_issue_id'))) {
    await run('ALTER TABLE `q_record_rows` ADD INDEX `q_record_rows_survey_issue_id` (`survey_issue_id`)', 'q_record_rows 인덱스 survey_issue_id');
  } else console.log(`${TAG} q_record_rows 인덱스 이미 있음 — skip`);

  if (!(await tableExists('survey_issues'))) {
    await run(`CREATE TABLE \`survey_issues\` (
      \`id\` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      \`business_id\` INT NOT NULL,
      \`q_record_id\` INT NOT NULL,
      \`rule_id\` INT NULL,
      \`origin\` ENUM('manual','rule') NOT NULL DEFAULT 'manual',
      \`subject_type\` ENUM('project','client','period') NULL,
      \`subject_id\` INT NULL,
      \`period_key\` VARCHAR(16) NULL,
      \`idempotency_key\` VARCHAR(120) NOT NULL,
      \`status\` ENUM('pending_review','sent','skipped','expired','failed','blocked_quota') NOT NULL DEFAULT 'sent',
      \`title\` VARCHAR(200) NOT NULL,
      \`message\` TEXT NULL,
      \`closes_at\` DATETIME NULL,
      \`created_by\` INT NULL,
      \`approved_by\` INT NULL,
      \`approved_at\` DATETIME NULL,
      \`sent_at\` DATETIME NULL,
      \`created_at\` DATETIME NOT NULL,
      \`updated_at\` DATETIME NOT NULL,
      UNIQUE KEY \`survey_issues_idempotency_key\` (\`idempotency_key\`),
      KEY \`survey_issues_q_record_id_created_at\` (\`q_record_id\`, \`created_at\`),
      KEY \`survey_issues_business_id_status\` (\`business_id\`, \`status\`),
      CONSTRAINT \`survey_issues_business_fk\` FOREIGN KEY (\`business_id\`) REFERENCES \`businesses\` (\`id\`),
      CONSTRAINT \`survey_issues_q_record_fk\` FOREIGN KEY (\`q_record_id\`) REFERENCES \`q_records\` (\`id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`, 'survey_issues 생성');
  } else console.log(`${TAG} survey_issues 이미 있음 — skip`);

  if (!(await tableExists('survey_recipients'))) {
    // token 은 대소문자를 가리는 collation(utf8mb4_bin) — 변형 열쇠가 찾히지 않게(코드도 정확히 같을 때만 통과시킨다)
    await run(`CREATE TABLE \`survey_recipients\` (
      \`id\` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      \`issue_id\` INT NOT NULL,
      \`business_id\` INT NOT NULL,
      \`client_id\` INT NULL,
      \`email\` VARCHAR(254) NOT NULL,
      \`display_name\` VARCHAR(100) NULL,
      \`token\` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
      \`status\` ENUM('queued','sent','failed','responded') NOT NULL DEFAULT 'queued',
      \`sent_at\` DATETIME NULL,
      \`opened_at\` DATETIME NULL,
      \`responded_at\` DATETIME NULL,
      \`reminded_at\` DATETIME NULL,
      \`revoked_at\` DATETIME NULL,
      \`email_log_id\` INT NULL,
      \`created_at\` DATETIME NOT NULL,
      \`updated_at\` DATETIME NOT NULL,
      UNIQUE KEY \`survey_recipients_token\` (\`token\`),
      KEY \`survey_recipients_issue_id\` (\`issue_id\`),
      KEY \`survey_recipients_client_id_created_at\` (\`client_id\`, \`created_at\`),
      KEY \`survey_recipients_business_id_sent_at\` (\`business_id\`, \`sent_at\`),
      CONSTRAINT \`survey_recipients_issue_fk\` FOREIGN KEY (\`issue_id\`) REFERENCES \`survey_issues\` (\`id\`) ON DELETE CASCADE,
      CONSTRAINT \`survey_recipients_business_fk\` FOREIGN KEY (\`business_id\`) REFERENCES \`businesses\` (\`id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`, 'survey_recipients 생성');
  } else console.log(`${TAG} survey_recipients 이미 있음 — skip`);

  if (!(await tableExists('survey_rules'))) {
    await run(`CREATE TABLE \`survey_rules\` (
      \`id\` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      \`business_id\` INT NOT NULL,
      \`q_record_id\` INT NOT NULL,
      \`created_by\` INT NULL,
      \`trigger\` ENUM('project_closed','client_joined','schedule') NOT NULL,
      \`delay_days\` INT NOT NULL DEFAULT 3,
      \`schedule_every\` ENUM('monthly','quarterly','half_yearly','yearly') NULL,
      \`audience\` ENUM('subject','active_clients','clients_with_active_project') NOT NULL DEFAULT 'subject',
      \`send_mode\` ENUM('review','auto') NOT NULL DEFAULT 'review',
      \`min_interval_days\` INT NOT NULL DEFAULT 90,
      \`enabled\` TINYINT(1) NOT NULL DEFAULT 0,
      \`enabled_at\` DATETIME NULL,
      \`last_run_at\` DATETIME NULL,
      \`created_at\` DATETIME NOT NULL,
      \`updated_at\` DATETIME NOT NULL,
      KEY \`survey_rules_business_id_enabled\` (\`business_id\`, \`enabled\`),
      KEY \`survey_rules_q_record_id\` (\`q_record_id\`),
      CONSTRAINT \`survey_rules_business_fk\` FOREIGN KEY (\`business_id\`) REFERENCES \`businesses\` (\`id\`),
      CONSTRAINT \`survey_rules_q_record_fk\` FOREIGN KEY (\`q_record_id\`) REFERENCES \`q_records\` (\`id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`, 'survey_rules 생성');
  } else console.log(`${TAG} survey_rules 이미 있음 — skip`);

  await addCol('clients', 'survey_opt_out_at', 'DATETIME NULL');
}
main().then(() => process.exit(0)).catch((e) => { console.error(`${TAG} 실패`, e.message); process.exit(1); });
