/**
 * 휴가 종류를 워크스페이스 데이터로 — leave_types 표 + leave_grants/leave_requests.leave_type_id (2026-10-22)
 * 설계 docs/LEAVE_TYPES_DESIGN.md §4.
 *
 * ★ 멱등 — 단계마다 «이미 됐으면 건너뜀». 끊겨도 다시 돌리면 된다.
 * ★ **코드 배포 전에** 돌린다(모델이 leave_type_id 를 선언한다 — 컬럼이 없으면 조회가 500).
 * ★ 백필은 category 와 code 가 같은 글자라 조인이 곧 매핑이다. leave_type(유급/무급 박제)은 건드리지 않는다 —
 *   검증 ③ 이 그 분포가 한 건도 안 바뀌었는지 본다.
 *
 * 실행: node scripts/migrate-leave-types.js
 * 롤백(코드만 되돌릴 때 — 옛 코드는 leave_type_id 를 모르고 INSERT 한다):
 *       node scripts/migrate-leave-types.js --rollback-nullable
 */
require('dotenv').config();
const { sequelize } = require('../config/database');

const SYSTEM = [
  ['annual', 'paid', 0], ['sick', 'paid', 1], ['family', 'paid', 2], ['other', 'paid', 3], ['unpaid', 'unpaid', 4],
];
const TABLES = ['leave_grants', 'leave_requests'];
/** 옛 category ENUM 값 — 이 밖의 종류는 이중 기록이 'other' 다(services/leaveTypes.legacyCategoryOf 와 같은 규칙) */
const LEGACY = new Set(['annual', 'sick', 'family', 'other']);

async function one(sql, rep = []) {
  const [rows] = await sequelize.query(sql, { replacements: rep });
  return rows;
}
async function hasTable(t) {
  return Number((await one('SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [t]))[0].n) > 0;
}
async function column(t, c) {
  return (await one('SELECT IS_NULLABLE nl FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?', [t, c]))[0] || null;
}
async function hasIndex(t, name) {
  return Number((await one('SELECT COUNT(*) n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?', [t, name]))[0].n) > 0;
}
async function hasFk(t, name) {
  return Number((await one("SELECT COUNT(*) n FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_NAME=? AND CONSTRAINT_TYPE='FOREIGN KEY'", [t, name]))[0].n) > 0;
}
/** 안 채워진 행 — NULL 이거나(새 칸) sync 가 먼저 만든 NOT NULL 칸의 0 처럼 이 워크스페이스 종류를 가리키지 않는 값 */
const UNFILLED = (a) => `(${a}.leave_type_id IS NULL OR NOT EXISTS (SELECT 1 FROM leave_types u WHERE u.id = ${a}.leave_type_id AND u.business_id = ${a}.business_id))`;
const dist = async (t, col) => Object.fromEntries((await one(`SELECT ${col} k, COUNT(*) n FROM \`${t}\` GROUP BY ${col}`)).map((r) => [String(r.k), Number(r.n)]));

async function rollbackNullable() {
  for (const t of TABLES) {
    const c = await column(t, 'leave_type_id');
    if (c && c.nl === 'NO') { await sequelize.query(`ALTER TABLE \`${t}\` MODIFY leave_type_id INT NULL`); console.log(`  ↩ ${t}.leave_type_id → NULL 허용`); }
    else console.log(`  · ${t}.leave_type_id — 이미 NULL 허용이거나 없음`);
  }
}

(async () => {
  try {
    await sequelize.authenticate();
    if (process.argv.includes('--rollback-nullable')) { await rollbackNullable(); process.exit(0); }
    console.log('── 휴가 종류(leave_types) 마이그레이션 ──');
    // 1. 표
    if (!(await hasTable('leave_types'))) {
      await sequelize.query(`CREATE TABLE leave_types (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        business_id INT NOT NULL,
        code VARCHAR(20) NULL,
        name VARCHAR(50) NULL,
        pay ENUM('paid','unpaid') NOT NULL DEFAULT 'paid',
        default_days DECIMAL(4,1) NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        sort_order INT NOT NULL DEFAULT 0,
        created_by INT NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        UNIQUE KEY leave_types_biz_code (business_id, code),
        KEY leave_types_biz_active (business_id, is_active, sort_order),
        CONSTRAINT leave_types_business_fk FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
        CONSTRAINT leave_types_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      console.log('  ✅ leave_types 표 생성');
    } else console.log('  · leave_types — 이미 있음');
    // 2. 컬럼(NULL 허용으로 먼저)
    for (const t of TABLES) {
      if (!(await column(t, 'leave_type_id'))) {
        await sequelize.query(`ALTER TABLE \`${t}\` ADD COLUMN leave_type_id INT NULL`);
        console.log(`  ✅ ${t}.leave_type_id 추가`);
      }
    }
    const before = {};
    for (const t of TABLES) before[t] = { cat: await dist(t, 'category'), ...(t === 'leave_requests' ? { pay: await dist(t, 'leave_type') } : {}) };
    // 3. 시드 — 행이 있는 워크스페이스만(나머지는 화면이 처음 열 때 만든다)
    const bizRows = await one('SELECT DISTINCT business_id b FROM leave_grants UNION SELECT DISTINCT business_id b FROM leave_requests');
    let seeded = 0;
    for (const { b } of bizRows) {
      for (const [code, pay, ord] of SYSTEM) {
        const [, n] = await sequelize.query(
          `INSERT INTO leave_types (business_id, code, name, pay, default_days, is_active, sort_order, created_at, updated_at)
           SELECT ?, ?, NULL, ?, NULL, 1, ?, NOW(), NOW() FROM DUAL
            WHERE NOT EXISTS (SELECT 1 FROM leave_types WHERE business_id = ? AND code = ?)`,
          { replacements: [b, code, pay, ord, b, code] },
        );
        seeded += Number(n) || 0;
      }
    }
    // 4. 백필 — «안 채워진 행» = NULL **또는 이 워크스페이스의 종류를 가리키지 않는 값**.
    //   ★ 2026-10-22 운영 실측: 배포가 sync-database(alter)를 이 슬롯보다 먼저 돌려, 모델대로
    //   leave_grants.leave_type_id 를 NOT NULL 로 먼저 만들었다 → 기존 행이 0 으로 채워져
    //   «IS NULL 만 채우기» 가 건너뛰고 검증이 «종류별 건수 불일치» 로 멈췄다. 순서는 배포 스크립트에서
    //   sync 앞으로 옮겼고, 이미 그 상태가 된 DB 도 여기서 채운다(채워진 정상 행은 조건에 안 걸린다).
    let filled = 0;
    for (const t of TABLES) {
      const [, meta] = await sequelize.query(
        `UPDATE \`${t}\` x JOIN leave_types lt ON lt.business_id = x.business_id AND lt.code = x.category
            SET x.leave_type_id = lt.id
          WHERE ${UNFILLED('x')}`,
      );
      filled += Number(meta?.affectedRows ?? meta) || 0;
    }
    // 5. 검증
    for (const t of TABLES) {
      const nulls = Number((await one(`SELECT COUNT(*) n FROM \`${t}\` x WHERE ${UNFILLED('x')}`))[0].n);
      if (nulls) throw new Error(`${t} 에 leave_type_id 가 비었거나 이 워크스페이스 종류가 아닌 행 ${nulls}건`);
      // ★ 비교는 «옛 category 축» 으로 접어서 한다 — 새 코드는 커스텀(code NULL)·무급휴가(code unpaid) 행에
      //   category='other' 를 이중 기록한다(설계 §3.2). 글자 그대로 비교하면 그런 행이 한 건이라도 생긴 뒤
      //   **두 번째 배포부터** 이 검사가 거짓 실패해 배포가 멈춘다(Fable 2026-10-22 실측 SLOT EXIT 1).
      const folded = {};
      for (const r of await one(`SELECT lt.code k, COUNT(*) n FROM \`${t}\` x JOIN leave_types lt ON lt.id = x.leave_type_id GROUP BY lt.code`)) {
        const k = LEGACY.has(r.k) ? r.k : 'other';
        folded[k] = (folded[k] || 0) + Number(r.n);
      }
      const byCode = Object.fromEntries((await one(`SELECT COALESCE(lt.code,'(custom)') k, COUNT(*) n FROM \`${t}\` x JOIN leave_types lt ON lt.id = x.leave_type_id GROUP BY lt.code`)).map((r) => [String(r.k), Number(r.n)]));
      const cat = await dist(t, 'category');
      const norm = (o) => JSON.stringify(Object.entries(o).filter(([, n]) => n > 0).sort());
      if (norm(cat) !== norm(folded)) {
        throw new Error(`${t} 종류별 건수 불일치 category=${JSON.stringify(cat)} type(옛 축)=${JSON.stringify(folded)}`);
      }
      const cross = Number((await one(`SELECT COUNT(*) n FROM \`${t}\` x JOIN leave_types lt ON lt.id = x.leave_type_id WHERE lt.business_id <> x.business_id`))[0].n);
      if (cross) throw new Error(`${t} 에 다른 워크스페이스 종류를 가리키는 행 ${cross}건`);
      if (t === 'leave_requests' && JSON.stringify(before[t].pay) !== JSON.stringify(await dist(t, 'leave_type'))) throw new Error('유급/무급 박제 분포가 바뀌었다');
      console.log(`  ${t}: ${Object.values(cat).reduce((s, n) => s + n, 0)}행 · ${Object.entries(byCode).map(([k, n]) => `${k}=${n}`).join(' ') || '(비어 있음)'}`);
    }
    const bad = await one('SELECT business_id, COUNT(*) n FROM leave_types WHERE code IS NOT NULL GROUP BY business_id HAVING n <> 5');
    if (bad.length) throw new Error(`시스템 종류가 5종이 아닌 워크스페이스 ${bad.length}곳`);
    // 6. NOT NULL + FK + 인덱스
    for (const t of TABLES) {
      if ((await column(t, 'leave_type_id')).nl === 'YES') await sequelize.query(`ALTER TABLE \`${t}\` MODIFY leave_type_id INT NOT NULL`);
      const fk = `${t}_leave_type_fk`;
      if (!(await hasFk(t, fk))) await sequelize.query(`ALTER TABLE \`${t}\` ADD CONSTRAINT ${fk} FOREIGN KEY (leave_type_id) REFERENCES leave_types(id)`);
    }
    if (!(await hasIndex('leave_grants', 'leave_grant_biz_user_year_type'))) {
      await sequelize.query('ALTER TABLE leave_grants ADD INDEX leave_grant_biz_user_year_type (business_id, user_id, year, leave_type_id)');
    }
    console.log(`  워크스페이스 ${bizRows.length} · 시드 ${seeded} · 백필 ${filled}`);
    console.log('완료.');
    process.exit(0);
  } catch (e) {
    console.error('🔴 실패:', e.message);
    process.exit(1);
  }
})();
