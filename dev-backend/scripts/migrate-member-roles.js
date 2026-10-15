// 2026-10-15 역할 사전 (docs/MEMBER_ROLES_DESIGN.md · Fable 설계) — 멱등.
//
//   ① member_roles 표 (CREATE TABLE IF NOT EXISTS) + UNIQUE(business_id,name) + 정렬 인덱스
//   ② project_members.role 컬럼 DEFAULT '기타' → NULL 허용·DEFAULT NULL
//   ③ (표를 이번에 만들었거나 표가 비어 있을 때만, 또는 --backfill) 워크스페이스마다
//      - 쓰인 글자(project_members.role · business_members.default_role) 흡수 — 잡값 5종(기타·팀원·오너·owner·member)은 빼고
//        그 칸을 NULL 로
//      - 공통 기본 세트 7개(워크스페이스 언어) 추가 — 이미 같은 글자가 있으면 건너뜀
//      ★ 매 배포 다시 돌면 사용자가 지운 기본 역할을 되살리므로 ③ 은 처음 한 번만이다.
//   ★ 코드보다 먼저 돈다(배포 슬롯 PM2 reload 앞) — 모델·라우트가 이 표를 쓴다.
//   롤백: 코드 revert. 표 잔존 무해. NULL 로 바꾼 잡값은 되돌리지 않는다(화면엔 빈칸).
//
//   사용: node scripts/migrate-member-roles.js [--dry] [--backfill]
require('dotenv').config();
const { sequelize } = require('../config/database');
const { DEFAULTS, JUNK } = require('../services/memberRoles');

const DRY = process.argv.includes('--dry');
const FORCE_BACKFILL = process.argv.includes('--backfill');
const TAG = '[migrate-member-roles]';

async function ensureTable() {
  const [t] = await sequelize.query("SHOW TABLES LIKE 'member_roles'");
  if (t.length) { console.log(`${TAG} member_roles 이미 있음 — skip`); return false; }
  const sql = `CREATE TABLE IF NOT EXISTS member_roles (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    business_id INT NOT NULL,
    name VARCHAR(30) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_by INT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY member_roles_biz_name_unique (business_id, name),
    INDEX member_roles_biz_sort (business_id, sort_order),
    CONSTRAINT member_roles_business_fk FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT member_roles_user_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
  if (DRY) { console.log(`${TAG} (dry) CREATE TABLE member_roles`); return true; }
  await sequelize.query(sql);
  console.log(`${TAG} member_roles 만듦`);
  return true;
}

async function relaxColumnDefault() {
  const [rows] = await sequelize.query("SHOW COLUMNS FROM project_members LIKE 'role'");
  const col = rows[0];
  if (!col) throw new Error('project_members.role 없음');
  if (col.Null === 'YES' && col.Default == null) { console.log(`${TAG} project_members.role 이미 NULL 기본 — skip`); return; }
  const sql = 'ALTER TABLE project_members MODIFY COLUMN role VARCHAR(50) NULL DEFAULT NULL';
  if (DRY) { console.log(`${TAG} (dry) ${sql}`); return; }
  await sequelize.query(sql);
  console.log(`${TAG} project_members.role → NULL 기본`);
}

const junkList = [...JUNK];

async function backfill(tableReady) {
  // 잡값 → NULL (대소문자·앞뒤 공백 무시)
  const junkSql = junkList.map(() => '?').join(',');
  const [[pmJunk]] = await sequelize.query(
    `SELECT COUNT(*) c FROM project_members WHERE LOWER(TRIM(role)) IN (${junkSql})`, { replacements: junkList });
  const [[bmJunk]] = await sequelize.query(
    `SELECT COUNT(*) c FROM business_members WHERE LOWER(TRIM(default_role)) IN (${junkSql})`, { replacements: junkList });
  console.log(`${TAG} 잡값 → 비움: project_members ${pmJunk.c} · business_members ${bmJunk.c}`);
  if (!DRY) {
    await sequelize.query(`UPDATE project_members SET role = NULL WHERE LOWER(TRIM(role)) IN (${junkSql})`, { replacements: junkList });
    await sequelize.query(`UPDATE business_members SET default_role = NULL WHERE LOWER(TRIM(default_role)) IN (${junkSql})`, { replacements: junkList });
    // 빈 글자도 NULL 로 맞춘다
    await sequelize.query("UPDATE project_members SET role = NULL WHERE role IS NOT NULL AND TRIM(role) = ''");
    await sequelize.query("UPDATE business_members SET default_role = NULL WHERE default_role IS NOT NULL AND TRIM(default_role) = ''");
  }

  const [bizs] = await sequelize.query('SELECT id, default_language, owner_id FROM businesses');
  let added = 0;
  for (const b of bizs) {
    const [used] = await sequelize.query(
      `SELECT TRIM(x.r) AS name, MIN(x.o) AS o FROM (
         SELECT pm.role AS r, pm.id AS o FROM project_members pm JOIN projects p ON p.id = pm.project_id
          WHERE p.business_id = :biz AND pm.role IS NOT NULL
         UNION ALL
         SELECT bm.default_role AS r, bm.id AS o FROM business_members bm
          WHERE bm.business_id = :biz AND bm.default_role IS NOT NULL
       ) x WHERE TRIM(x.r) <> '' GROUP BY TRIM(x.r) ORDER BY o`,
      { replacements: { biz: b.id } });
    const lang = String(b.default_language || '').startsWith('en') ? 'en' : 'ko';
    const wanted = [];
    const seen = new Set();
    for (const n of DEFAULTS[lang]) { seen.add(n.toLowerCase()); wanted.push(n); }
    for (const u of used) {
      const name = String(u.name).replace(/\s+/g, ' ').slice(0, 30);
      const k = name.toLowerCase();
      if (!name || JUNK.has(k) || seen.has(k)) continue;
      seen.add(k); wanted.push(name);
    }
    const [have] = tableReady
      ? await sequelize.query('SELECT LOWER(name) k FROM member_roles WHERE business_id = :biz', { replacements: { biz: b.id } })
      : [[]];   // --dry 에서 표가 아직 없을 때
    const haveSet = new Set(have.map((r) => r.k));
    let order = have.length;
    for (const name of wanted) {
      if (haveSet.has(name.toLowerCase())) continue;
      if (!DRY) {
        await sequelize.query(
          `INSERT IGNORE INTO member_roles (business_id, name, sort_order, created_by, created_at, updated_at)
           VALUES (:biz, :name, :o, :by, NOW(), NOW())`,
          { replacements: { biz: b.id, name, o: order, by: b.owner_id || null } });
      }
      order += 1; added += 1;
    }
  }
  console.log(`${TAG} 워크스페이스 ${bizs.length}곳 · 사전에 ${added}개 ${DRY ? '(dry) 넣을 예정' : '넣음'}`);
}

(async () => {
  try {
    const created = await ensureTable();
    await relaxColumnDefault();
    // 흡수·시드 = 표를 이번에 만들었거나 **표가 통째로 비어 있을 때**(sync-database 가 빈 표를 먼저 만든 경우 — Fable 게이트 실측).
    //   한 워크스페이스라도 행이 있으면 건너뛴다 — 사용자가 지운 기본 역할을 매 배포 되살리지 않는다.
    let empty = created;
    if (!created) {
      const [[n]] = await sequelize.query('SELECT COUNT(*) c FROM member_roles');
      empty = Number(n.c) === 0;
    }
    if (empty || FORCE_BACKFILL) await backfill(!(DRY && created));
    else console.log(`${TAG} 흡수·시드는 표가 비어 있을 때만(다시 하려면 --backfill) — skip`);
    if (!DRY) {
      const [[c]] = await sequelize.query("SELECT COUNT(*) c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'member_roles'");
      if (Number(c.c) !== 1) throw new Error('member_roles 재조회 실패');
    }
    console.log(`${TAG} 완료`);
    process.exit(0);
  } catch (e) {
    console.error(`${TAG} 실패:`, e.message);
    process.exit(1);
  }
})();
