// DB 스키마 스냅샷 — guard-invariants 의 schemacol 가드가 읽는 정본.
//
// 왜 스냅샷인가
//   "코드가 참조하는 컬럼이 실재하는가" 를 **모델 파일만 보고는 판정할 수 없다**.
//   Sequelize 는 연관관계(belongsTo/hasMany)로 `project_id`·`business_id` 같은 FK 를
//   자동 생성하는데 그건 모델 파일 어디에도 안 적혀 있다.
//   실제로 존재하는 컬럼의 정본은 **DB 스키마**뿐이다.
//
// 가드는 DB 에 붙지 않는다(정적·빠름이 원칙). 그래서 여기서 스냅샷을 떠서 파일로 남긴다.
// 스키마를 바꿨으면(마이그레이션·sync) 이 스크립트를 다시 돌려 스냅샷을 갱신할 것.
//
//   cd /opt/planq && node scripts/dump-schema.js
const path = require('path');
const fs = require('fs');

const BE = ['dev-backend', 'backend']
  .map((d) => path.join(__dirname, '..', d))
  .find((p) => fs.existsSync(path.join(p, 'models')));
if (!BE) { console.error('ERR 백엔드 디렉터리를 찾지 못했습니다'); process.exit(1); }
process.chdir(BE);
require(path.join(BE, 'node_modules', 'dotenv')).config();
const { sequelize } = require(path.join(BE, 'config/database'));

const OUT = path.join(__dirname, 'schema-snapshot.json');

(async () => {
  const db = process.env.DB_NAME;
  const [rows] = await sequelize.query(
    'SELECT TABLE_NAME t, COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = :db ORDER BY TABLE_NAME, ORDINAL_POSITION',
    { replacements: { db } }
  );
  const tables = {};
  for (const r of rows) {
    (tables[r.t] = tables[r.t] || []).push(r.c);
  }
  const out = {
    _generated: new Date().toISOString().slice(0, 10),
    _db: db,
    _note: '스키마 변경 후 `node scripts/dump-schema.js` 로 갱신할 것. guard-invariants schemacol 이 읽는다.',
    tables,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  console.log(`✓ ${Object.keys(tables).length}개 테이블 · ${rows.length}개 컬럼 → ${path.relative(process.cwd(), OUT)}`);
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
