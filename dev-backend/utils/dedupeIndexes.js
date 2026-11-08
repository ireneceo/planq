// 같은 인덱스 중복 정리 — sync-database.js(alter) 뒤에 부른다 (2026-11-08 서버 확장성 점검).
//
// 왜: Sequelize `model.sync({ alter: true })` 는 MySQL 에서 칸에 `unique: true` 를 직접 단 모델마다
//   **돌 때마다 같은 UNIQUE 인덱스를 하나 더** 만든다(token, token_2, … token_63). dev 실측 36개 표 · 326개 중복,
//   그중 4개 표(help_articles·help_categories·kb_share_bundles·report_shares)는 MySQL 상한 64개에 닿았다.
//   상한에 닿으면 그 표의 alter 가 «Too many keys» 로 실패하는데 sync-database 는 실패를 세기만 하고 넘어가서
//   **배포에서 새 칸이 조용히 안 생긴다.** 쓰기마다 중복 인덱스도 같이 갱신하므로 쓰기도 느려진다.
//
// 규칙: 같은 표에서 «칸 순서 + 길이(prefix) + 고유 여부 + 종류» 가 완전히 같은 인덱스끼리만 묶고, 하나만 남긴다.
//   남길 것: PRIMARY > 모델이 선언한 이름 > 이름이 가장 짧은 것 > 사전순 첫 번째.
//   다른 인덱스는 건드리지 않는다(칸 순서가 다르면 다른 인덱스다). 외래 키는 남는 같은 인덱스가 받쳐 준다.
//   DROP INDEX 는 InnoDB 에서 표를 다시 쓰지 않는 메타데이터 작업이다.
async function findDuplicateIndexes(sequelize, { tables = null, keepNames = new Map() } = {}) {
  const [rows] = await sequelize.query(
    `SELECT TABLE_NAME AS t, INDEX_NAME AS i, NON_UNIQUE AS nu, INDEX_TYPE AS ty, SEQ_IN_INDEX AS seq,
            COLUMN_NAME AS c, SUB_PART AS sp, COLLATION AS co, EXPRESSION AS ex, IS_VISIBLE AS vis
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
  );
  const byIndex = new Map();   // "t\0i" → { t, i, sig }
  for (const r of rows) {
    if (tables && !tables.includes(r.t)) continue;
    const k = `${r.t}\0${r.i}`;
    // 함수형 인덱스는 칸 이름이 NULL 이라 식(EXPRESSION)까지 서명에 넣는다 · 숨긴 인덱스(IS_VISIBLE=NO)는 다른 것으로 본다
    if (!byIndex.has(k)) byIndex.set(k, { t: r.t, i: r.i, head: `${r.nu}|${r.ty}|${r.vis}`, parts: [] });
    byIndex.get(k).parts.push(`${r.c == null ? 'expr:' + r.ex : r.c}(${r.sp == null ? '' : r.sp})${r.co || ''}`);
  }
  const groups = new Map();    // "t\0sig" → [index names]
  for (const v of byIndex.values()) {
    const g = `${v.t}\0${v.head}|${v.parts.join(',')}`;
    if (!groups.has(g)) groups.set(g, { t: v.t, names: [] });
    groups.get(g).names.push(v.i);
  }
  const drops = [];
  for (const { t, names } of groups.values()) {
    if (names.length < 2) continue;
    const declared = keepNames.get(t) || new Set();
    const rank = (n) => [n === 'PRIMARY' ? 0 : 1, declared.has(n) ? 0 : 1, n.length, n];
    const sorted = [...names].sort((a, b) => {
      const ra = rank(a); const rb = rank(b);
      for (let x = 0; x < ra.length; x += 1) { if (ra[x] < rb[x]) return -1; if (ra[x] > rb[x]) return 1; }
      return 0;
    });
    for (const n of sorted.slice(1)) drops.push({ table: t, index: n, keep: sorted[0] });
  }
  return drops;
}

// 모델이 options.indexes 로 이름을 붙여 선언한 인덱스 → 지우지 않고 남길 이름(다음 sync 가 다시 만드는 헛바퀴 방지)
function declaredIndexNames(models) {
  const out = new Map();
  for (const m of Object.values(models || {})) {
    const t = typeof m.getTableName === 'function' ? m.getTableName() : null;
    const tn = t && typeof t === 'object' ? t.tableName : t;
    if (!tn) continue;
    const set = out.get(tn) || new Set();
    for (const ix of (m.options && m.options.indexes) || []) if (ix && ix.name) set.add(ix.name);
    out.set(tn, set);
  }
  return out;
}

async function dropDuplicateIndexes(sequelize, opts = {}) {
  const drops = await findDuplicateIndexes(sequelize, opts);
  if (!opts.apply) return { drops, dropped: 0, failed: [] };
  let dropped = 0; const failed = [];
  // 운영 배포 중에는 옛 프로세스가 트래픽을 받는다 — 긴 트랜잭션이 표를 잡고 있으면 메타데이터 잠금을 기다리다
  //   그 표 전체가 멈출 수 있다(lock_wait_timeout 기본 1년). 한 연결을 고정해 15초만 기다리고, 못 하면 실패로 남겨
  //   다음 배포가 다시 시도하게 한다(Fable 비차단 ④). LOCK=NONE 이 안 되는 경우도 실패로 떨어진다(조용히 막지 않는다).
  await sequelize.transaction(async (t) => {
    await sequelize.query('SET SESSION lock_wait_timeout = 15', { transaction: t });
    for (const d of drops) {
      try {
        await sequelize.query(`ALTER TABLE \`${d.table}\` DROP INDEX \`${d.index}\`, ALGORITHM=INPLACE, LOCK=NONE`, { transaction: t });
        dropped += 1;
      } catch (e) {
        failed.push({ ...d, error: e.message });
      }
    }
    // 풀 연결에 15초 값이 남지 않게 되돌린다(서버 안에서 부르게 되면 그 연결의 일반 쿼리까지 15초로 떨어진다)
    await sequelize.query('SET SESSION lock_wait_timeout = DEFAULT', { transaction: t });
  });
  return { drops, dropped, failed };
}

module.exports = { findDuplicateIndexes, dropDuplicateIndexes, declaredIndexNames };
