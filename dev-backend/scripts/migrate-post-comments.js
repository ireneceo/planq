// 2026-10-15 문서 댓글 (docs/DOC_COMMENTS_DESIGN.md) — 멱등.
//
//   ① post_comments 표 (CREATE TABLE IF NOT EXISTS) + 인덱스 2 + FK 2(posts·users CASCADE)
//   ② notifications.event_kind · notification_prefs.event_kind 끝에 'doc_comment' append
//      ★ 표마다 **지금 DB 의 Type 문자열** 끝에 붙인다 — 두 알림 표는 값 순서가 다르다(share_expiry).
//   ★ **코드보다 먼저** 돈다(배포 슬롯 PM2 reload 앞) — 문서 상세가 이 표를 센다.
//   롤백: 코드 revert 만. 표·ENUM 값 잔존은 무해.
//
//   사용: node scripts/migrate-post-comments.js [--dry]
require('dotenv').config();
const { sequelize } = require('../config/database');

const DRY = process.argv.includes('--dry');
const TAG = '[migrate-post-comments]';
const ENUM_TARGETS = [
  { table: 'notifications', column: 'event_kind', value: 'doc_comment' },
  { table: 'notification_prefs', column: 'event_kind', value: 'doc_comment' },
];

function parseEnum(type) {
  const m = String(type).match(/^enum\((.*)\)$/i);
  if (!m) return null;
  return [...m[1].matchAll(/'((?:[^']|'')*)'/g)].map((x) => x[1].replace(/''/g, "'"));
}

async function appendEnum({ table, column, value }) {
  const [rows] = await sequelize.query(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, { replacements: [column] });
  if (!rows.length) { console.log(`${TAG} ${table}.${column} 없음 — skip`); return false; }
  const col = rows[0];
  const values = parseEnum(col.Type);
  if (!values) throw new Error(`${table}.${column} 가 ENUM 이 아니다: ${col.Type}`);
  if (values.includes(value)) { console.log(`${TAG} ${table}.${column} 에 '${value}' 이미 있음 — skip`); return false; }
  const next = [...values, value].map((v) => `'${v.replace(/'/g, "''")}'`).join(',');
  const nullClause = col.Null === 'NO' ? 'NOT NULL' : 'NULL';
  const defClause = col.Default != null ? ` DEFAULT '${String(col.Default).replace(/'/g, "''")}'` : '';
  const sql = `ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` ENUM(${next}) ${nullClause}${defClause}, ALGORITHM=INPLACE, LOCK=NONE`;
  if (DRY) { console.log(`${TAG} (dry) ${sql}`); return true; }
  await sequelize.query(sql);
  console.log(`${TAG} ${table}.${column} +'${value}'`);
  return true;
}

async function ensureTable() {
  const [t] = await sequelize.query("SHOW TABLES LIKE 'post_comments'");
  if (t.length) { console.log(`${TAG} post_comments 이미 있음 — skip`); return false; }
  const sql = `CREATE TABLE IF NOT EXISTS post_comments (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    post_id INT NOT NULL,
    business_id INT NOT NULL,
    user_id INT NOT NULL,
    content TEXT NOT NULL,
    visibility ENUM('internal','shared') NOT NULL DEFAULT 'internal',
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    INDEX post_comments_post_id_created_at (post_id, created_at),
    INDEX post_comments_business_id (business_id),
    CONSTRAINT post_comments_post_fk FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT post_comments_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
  if (DRY) { console.log(`${TAG} (dry) CREATE TABLE post_comments`); return true; }
  await sequelize.query(sql);
  console.log(`${TAG} post_comments 생성`);
  return true;
}

async function verify() {
  const [t] = await sequelize.query("SHOW TABLES LIKE 'post_comments'");
  if (!t.length) throw new Error('post_comments 없음');
  for (const e of ENUM_TARGETS) {
    const [rows] = await sequelize.query(`SHOW COLUMNS FROM \`${e.table}\` LIKE ?`, { replacements: [e.column] });
    if (!rows.length || !parseEnum(rows[0].Type).includes(e.value)) throw new Error(`${e.table}.${e.column} 에 '${e.value}' 없음`);
  }
}

async function main() {
  let changed = 0;
  if (await ensureTable()) changed += 1;
  for (const e of ENUM_TARGETS) if (await appendEnum(e)) changed += 1;
  if (!DRY) await verify();
  console.log(changed === 0 ? `${TAG} 변경 0 (멱등 확인)` : `${TAG} ${DRY ? '변경 예정' : '변경'} ${changed}건`);
  await sequelize.close();
}

main().catch(async (e) => { console.error(e); try { await sequelize.close(); } catch { /* */ } process.exit(1); });
