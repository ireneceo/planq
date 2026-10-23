// 2026-10-23 문서 공동 편집자 (docs/DOC_COEDITORS_DESIGN.md · Fable DESIGN-OK) — 멱등.
//
//   ① post_editors 표 (CREATE TABLE IF NOT EXISTS) + UNIQUE(post_id,user_id) + idx user_id + FK 2(posts·users CASCADE)
//   ② notifications.event_kind · notification_prefs.event_kind 끝에 'doc_editor' append
//      ★ 표마다 **지금 DB 의 Type 문자열** 끝에 붙인다 — 두 알림 표는 값 순서가 다르다.
//   ③ 백필 — **`--apply` 일 때만**. 옛 문서를 실제로 고친 적 있는 사람(post_revisions.editor_user_id ∪ posts.editor_id,
//      ≠ 작성자, 지금 그 워크스페이스 활성 멤버·비고객·비AI·계정 active)을 공동 편집자로(added_by NULL). 알림 없음.
//      기본은 넣을 수만 센다(dry). 두 번 돌려도 같은 결과(INSERT IGNORE).
//   ★ ①② 는 **코드보다 먼저** 돈다(배포 슬롯 PM2 reload 앞) — 편집 판정·문서 상세가 이 표를 읽는다.
//      ③ 은 ①② 직후 같은 슬롯에서 `--apply` 로 — 안 돌리면 옛 문서를 고치던 멤버가 갑자기 못 고친다.
//   롤백: 코드 revert 만. 표·ENUM 값 잔존은 무해.
//
//   사용: node scripts/migrate-post-editors.js [--dry] [--apply]
require('dotenv').config();
const { sequelize } = require('../config/database');

const DRY = process.argv.includes('--dry');
const APPLY = process.argv.includes('--apply');
const TAG = '[migrate-post-editors]';
const ENUM_TARGETS = [
  { table: 'notifications', column: 'event_kind', value: 'doc_editor' },
  { table: 'notification_prefs', column: 'event_kind', value: 'doc_editor' },
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
  const [t] = await sequelize.query("SHOW TABLES LIKE 'post_editors'");
  if (t.length) { console.log(`${TAG} post_editors 이미 있음 — skip`); return false; }
  const sql = `CREATE TABLE IF NOT EXISTS post_editors (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    post_id INT NOT NULL,
    user_id INT NOT NULL,
    added_by INT NULL,
    created_at DATETIME NOT NULL,
    UNIQUE KEY post_editors_post_id_user_id (post_id, user_id),
    INDEX post_editors_user_id (user_id),
    CONSTRAINT post_editors_post_fk FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT post_editors_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
  if (DRY) { console.log(`${TAG} (dry) CREATE TABLE post_editors`); return true; }
  await sequelize.query(sql);
  console.log(`${TAG} post_editors 생성`);
  return true;
}

// 옛 문서를 실제로 고친 사람 — 원천 둘(이력 편집자 ∪ 마지막 편집자)뿐. 읽을 수 있던 전원을 넣으면 새 규칙이 거짓이 된다.
const CANDIDATES_SQL = `
  SELECT DISTINCT c.post_id, c.user_id FROM (
    SELECT pr.post_id, pr.editor_user_id AS user_id FROM post_revisions pr WHERE pr.editor_user_id IS NOT NULL
    UNION
    SELECT p2.id AS post_id, p2.editor_id AS user_id FROM posts p2 WHERE p2.editor_id IS NOT NULL
  ) c
  JOIN posts p ON p.id = c.post_id AND p.author_id <> c.user_id
  JOIN business_members bm ON bm.business_id = p.business_id AND bm.user_id = c.user_id
    AND bm.removed_at IS NULL AND bm.role IN ('owner','admin','member')
  JOIN users u ON u.id = c.user_id AND u.status = 'active'
  LEFT JOIN post_editors pe ON pe.post_id = c.post_id AND pe.user_id = c.user_id
  WHERE pe.id IS NULL`;

async function backfill() {
  const [t] = await sequelize.query("SHOW TABLES LIKE 'post_editors'");
  if (!t.length) { console.log(`${TAG} 백필: 표가 아직 없음(dry) — 건너뜀`); return 0; }
  const [rows] = await sequelize.query(CANDIDATES_SQL);
  const posts = new Set(rows.map((r) => r.post_id)).size;
  if (!APPLY) { console.log(`${TAG} 백필 후보 ${rows.length}행 · 문서 ${posts}건 (넣으려면 --apply)`); return 0; }
  if (!rows.length) { console.log(`${TAG} 백필 0행 (멱등 확인)`); return 0; }
  await sequelize.query(`INSERT IGNORE INTO post_editors (post_id, user_id, added_by, created_at)
    SELECT x.post_id, x.user_id, NULL, NOW() FROM (${CANDIDATES_SQL}) x`);
  console.log(`${TAG} 백필 ${rows.length}행 · 문서 ${posts}건`);
  return rows.length;
}

async function verify() {
  const [t] = await sequelize.query("SHOW TABLES LIKE 'post_editors'");
  if (!t.length) throw new Error('post_editors 없음');
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
  changed += await backfill();
  console.log(changed === 0 ? `${TAG} 변경 0 (멱등 확인)` : `${TAG} ${DRY ? '변경 예정' : '변경'} ${changed}건`);
  await sequelize.close();
}

main().catch(async (e) => { console.error(e); try { await sequelize.close(); } catch { /* */ } process.exit(1); });
