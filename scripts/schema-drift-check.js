#!/usr/bin/env node
// schema-drift-check — dev 와 운영의 컬럼 집합을 **전수 대조**한다.
//
// 왜 필요한가:
//   `schema-snapshot.json` 은 dev DB 에서 뽑는다. 그래서 dev 와 운영이 어긋나 있으면
//   schemacol 가드는 **dev 기준으로만 통과**하고, 운영에서는 "Unknown column" 으로 죽는다.
//   이 저장소는 이미 그 사고를 겪었다 — 운영만 `conversation_id NOT NULL` 이라
//   메일 업무추출이 운영에서만 500 이었고 dev 검증은 전부 통과했다.
//   (memory: feedback_dev_cannot_reproduce_prod_schema — 컬럼 하나씩 고치면 다음 것이
//    터지므로 **모델↔DB 를 전수로** 대조한다.)
//
// 사용:
//   node scripts/schema-drift-check.js            # 요약
//   node scripts/schema-drift-check.js --verbose  # 차이 전부
//
// 종료코드: 차이가 있으면 1 (배포 전 게이트로 쓸 수 있다).
const { execFileSync } = require('child_process');
const fs = require('fs');

const PROD_HOST = process.env.PLANQ_PROD_HOST || 'irene@87.106.78.146';
const PROD_BACKEND = '/opt/planq/backend';
const VERBOSE = process.argv.includes('--verbose');

const REMOTE_SCRIPT = `
const s = require('${PROD_BACKEND}/config/database').sequelize;
(async()=>{
  const [r] = await s.query("SELECT TABLE_NAME t, COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()");
  const m = {};
  for (const x of r) (m[x.t] = m[x.t] || []).push(x.c);
  console.log('@@JSON@@' + JSON.stringify(m));
  process.exit(0);
})();
`;

function readProd() {
  const tmp = '/tmp/planq-schema-drift.js';
  execFileSync('ssh', [PROD_HOST, `cat > ${tmp}`], { input: REMOTE_SCRIPT });
  const out = execFileSync('ssh', [PROD_HOST, `cd ${PROD_BACKEND} && node ${tmp}`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  // ★ 원격 stdout 에는 dotenv 배너·MySQL 로그가 섞인다. 마커로 우리 줄만 집는다 —
  //   통째로 JSON.parse 하면 배너 때문에 항상 실패한다.
  const line = out.split('\n').find((l) => l.startsWith('@@JSON@@'));
  if (!line) throw new Error('원격 스키마 응답을 못 읽었습니다:\n' + out.slice(0, 300));
  return JSON.parse(line.slice('@@JSON@@'.length));
}

function main() {
  const snapPath = `${__dirname}/schema-snapshot.json`;
  if (!fs.existsSync(snapPath)) {
    console.error('스냅샷이 없습니다 — 먼저 node scripts/dump-schema.js');
    process.exit(1);
  }
  const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
  const dev = snap.tables || snap;
  let prod;
  try { prod = readProd(); }
  catch (e) { console.error('운영 스키마 조회 실패:', e.message); process.exit(1); }

  const onlyDevTable = Object.keys(dev).filter((t) => !prod[t]);
  const onlyProdTable = Object.keys(prod).filter((t) => !dev[t]);
  const onlyDevCol = []; const onlyProdCol = [];
  for (const [t, cols] of Object.entries(dev)) {
    if (!prod[t]) continue;
    const d = new Set(cols); const p = new Set(prod[t]);
    for (const c of cols) if (!p.has(c)) onlyDevCol.push(`${t}.${c}`);
    for (const c of prod[t]) if (!d.has(c)) onlyProdCol.push(`${t}.${c}`);
  }

  const diff = onlyDevTable.length + onlyProdTable.length + onlyDevCol.length + onlyProdCol.length;
  console.log(`dev 테이블 ${Object.keys(dev).length} · 운영 테이블 ${Object.keys(prod).length}`);
  console.log(`dev 에만 있는 테이블 ${onlyDevTable.length} · 운영에만 ${onlyProdTable.length}`);
  console.log(`dev 에만 있는 컬럼 ${onlyDevCol.length} · 운영에만 ${onlyProdCol.length}`);
  if (diff && (VERBOSE || diff <= 30)) {
    for (const x of onlyDevTable) console.log(`  [테이블] dev 에만: ${x}`);
    for (const x of onlyProdTable) console.log(`  [테이블] 운영에만: ${x}`);
    for (const x of onlyDevCol) console.log(`  [컬럼] dev 에만: ${x}   ← 운영에서 "Unknown column" 으로 죽는다`);
    for (const x of onlyProdCol) console.log(`  [컬럼] 운영에만: ${x}`);
  } else if (diff) {
    console.log('  (--verbose 로 전체 목록)');
  }
  if (diff === 0) { console.log('\n✓ 스키마 일치 — dev 검증이 운영에서도 성립한다'); process.exit(0); }
  console.log('\n✗ 스키마 드리프트 — dev 에서만 통과하는 검증이 될 수 있다');
  process.exit(1);
}

main();
