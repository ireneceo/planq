#!/usr/bin/env node
// scripts/e2e/run.js — 하니스 러너. health-check.js 동급 게이트 (exit 0/1).
//   사용: node scripts/e2e/run.js --suite mobile           # 특정 스위트
//         node scripts/e2e/run.js --suite mobile,crosscut  # 여러 개
//         node scripts/e2e/run.js                          # 전체
//   INSPECTION_PLAYBOOK.md 참조. 신규 스위트는 SUITES 에 등록.
const SUITES = {
  mobile: () => require('./mobile-keyboard'),
  crosscut: () => require('./canary-crawl'),   // 표시명(계정명) 누출 카나리 크롤
  l1: () => require('./canary-l1'),             // L1 개인자원 누출 카나리 (백엔드 API 크롤)
  tenant: () => require('./canary-tenant'),     // 멀티테넌트 격리 카나리 (비멤버 biz 403 실증)
  // chrome: () => require('./chrome-suppression'),
};

function printSuite(name, results) {
  let fail = 0, fatal = 0;
  console.log(`\n=== ${name} ===`);
  for (const r of results) {
    const bad = (r.fail || 0) + (r.leaked ? 1 : 0) + (r.overblock ? 1 : 0) + (r.error ? 1 : 0);
    const status = (r.fatal > 0) ? '🔥' : (bad > 0 ? '❌' : (r.inputs === 0 && !r.hasCanary && r.route === undefined ? '⚪' : '✅'));
    const metric = (r.path !== undefined)
      ? `(${r.path}) — 입력 ${r.inputs} · 통과 ${r.pass} · 실패 ${r.fail}${r.fatal ? ' · FATAL ' + r.fatal : ''}`
      : (r.route !== undefined ? (r.detail || (r.leaked ? '— 누출' : '')) : '');
    console.log(`${status} ${r.name || r.route} ${metric}`);
    (r.details || []).forEach((d) => console.log('     └ ' + d));
    if (r.snippet && r.leaked) console.log('     └ ' + r.snippet);
    fail += bad; fatal += (r.fatal || 0);
  }
  return fail + fatal;  // FATAL(하니스 환경 오염)도 게이트 실패로 취급 — 판정 자체를 신뢰 못 함
}

async function main() {
  const arg = (process.argv.find((s) => s.startsWith('--suite=')) || '').split('=')[1]
    || (process.argv.includes('--suite') ? process.argv[process.argv.indexOf('--suite') + 1] : '')
    || 'all';
  const want = arg === 'all' ? Object.keys(SUITES) : arg.split(',').map((s) => s.trim());
  let totalFail = 0;
  for (const key of want) {
    const load = SUITES[key];
    if (!load) { console.log(`⚠️ 알 수 없는 스위트: ${key} (가능: ${Object.keys(SUITES).join(', ')})`); continue; }
    const suite = load();
    const results = await suite.run();
    totalFail += printSuite(suite.name || key, results);
  }
  console.log(`\n━━━ 총 실패: ${totalFail} ━━━`);
  process.exit(totalFail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(2); });
