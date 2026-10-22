// 2026-10-22 인사이트 글 SNS 발송 단계 1 (docs/SNS_PUBLISH_DESIGN.md) — 멱등.
//
//   ① help_articles.og_image_path (글별 링크 미리보기 이미지 — uploads 아래 상대 경로)
//   ② social_accounts · social_posts · social_post_logs 표 (CREATE TABLE IF NOT EXISTS)
//      단계 1 은 계정 연결이 없어 social_accounts 는 비어 있다 — 표만 먼저 둔다(Fable 판정: 표 생성 가능).
//   ★ **코드보다 먼저** 돈다(배포 슬롯 PM2 reload 앞) — HelpArticle 모델이 og_image_path 를 SELECT 한다.
//   롤백: 코드 revert 만. 표·칸 잔존은 무해.
//
//   사용: node scripts/migrate-social.js [--dry]
require('dotenv').config();
const { sequelize } = require('../config/database');

const DRY = process.argv.includes('--dry');
const TAG = '[migrate-social]';
const PROVIDERS = "'linkedin','facebook','instagram','threads','youtube','naver','kakao'";

async function addColumn(table, column, ddl) {
  const [rows] = await sequelize.query(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, { replacements: [column] });
  if (rows.length) { console.log(`${TAG} ${table}.${column} 이미 있음 — skip`); return false; }
  const sql = `ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${ddl}`;
  if (DRY) { console.log(`${TAG} (dry) ${sql}`); return true; }
  await sequelize.query(sql);
  console.log(`${TAG} ${table}.${column} 추가`);
  return true;
}

async function ensureTable(name, ddl) {
  const [t] = await sequelize.query(`SHOW TABLES LIKE '${name}'`);
  if (t.length) { console.log(`${TAG} ${name} 이미 있음 — skip`); return false; }
  if (DRY) { console.log(`${TAG} (dry) CREATE TABLE ${name}`); return true; }
  await sequelize.query(ddl);
  console.log(`${TAG} ${name} 생성`);
  return true;
}

const TABLES = [
  ['social_accounts', `CREATE TABLE IF NOT EXISTS social_accounts (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    provider ENUM(${PROVIDERS}) NOT NULL,
    external_id VARCHAR(120) NOT NULL,
    display_name VARCHAR(200) NULL,
    avatar_url VARCHAR(500) NULL,
    access_token_enc TEXT NULL,
    refresh_token_enc TEXT NULL,
    token_expires_at DATETIME NULL,
    status ENUM('active','expired','revoked','error') NOT NULL DEFAULT 'active',
    last_error VARCHAR(500) NULL,
    connected_by INT NULL,
    connected_at DATETIME NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY social_accounts_provider_external (provider, external_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`],
  ['social_posts', `CREATE TABLE IF NOT EXISTS social_posts (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    article_id INT NOT NULL,
    account_id INT NULL,
    provider ENUM(${PROVIDERS}) NOT NULL,
    angle INT NOT NULL DEFAULT 1,
    kind ENUM('text','image','carousel','video') NOT NULL DEFAULT 'image',
    body TEXT NULL,
    first_comment TEXT NULL,
    link_url VARCHAR(500) NULL,
    media JSON NULL,
    status ENUM('draft','approved','scheduled','sending','sent','failed','canceled') NOT NULL DEFAULT 'draft',
    scheduled_at DATETIME NULL,
    sent_at DATETIME NULL,
    approved_by INT NULL,
    approved_at DATETIME NULL,
    external_post_id VARCHAR(200) NULL,
    external_url VARCHAR(500) NULL,
    error_message VARCHAR(500) NULL,
    metrics JSON NULL,
    metrics_at DATETIME NULL,
    created_by INT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    INDEX social_posts_article (article_id, provider),
    INDEX social_posts_status (status, scheduled_at),
    CONSTRAINT social_posts_article_fk FOREIGN KEY (article_id) REFERENCES help_articles(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT social_posts_account_fk FOREIGN KEY (account_id) REFERENCES social_accounts(id) ON DELETE SET NULL ON UPDATE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`],
  ['social_post_logs', `CREATE TABLE IF NOT EXISTS social_post_logs (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    post_id INT NOT NULL,
    from_status VARCHAR(20) NULL,
    to_status VARCHAR(20) NULL,
    action VARCHAR(40) NOT NULL,
    status_code INT NULL,
    message VARCHAR(500) NULL,
    user_id INT NULL,
    created_at DATETIME NOT NULL,
    INDEX social_post_logs_post (post_id, created_at),
    CONSTRAINT social_post_logs_post_fk FOREIGN KEY (post_id) REFERENCES social_posts(id) ON DELETE CASCADE ON UPDATE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`],
];

async function verify() {
  const [c] = await sequelize.query("SHOW COLUMNS FROM help_articles LIKE 'og_image_path'");
  if (!c.length) throw new Error('help_articles.og_image_path 없음');
  for (const [name] of TABLES) {
    const [t] = await sequelize.query(`SHOW TABLES LIKE '${name}'`);
    if (!t.length) throw new Error(`${name} 없음`);
  }
}

(async () => {
  try {
    await addColumn('help_articles', 'og_image_path', 'VARCHAR(255) NULL');
    for (const [name, ddl] of TABLES) await ensureTable(name, ddl);
    if (!DRY) await verify();
    console.log(`${TAG} 완료${DRY ? ' (dry)' : ''}`);
    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error(`${TAG} 실패:`, e.message);
    await sequelize.close().catch(() => {});
    process.exit(1);
  }
})();
