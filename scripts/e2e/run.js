#!/usr/bin/env node
// scripts/e2e/run.js — 하니스 러너. health-check.js 동급 게이트 (exit 0/1).
//   사용: node scripts/e2e/run.js --suite mobile           # 특정 스위트
//         node scripts/e2e/run.js --suite mobile,crosscut  # 여러 개
//         node scripts/e2e/run.js                          # 전체
//   INSPECTION_PLAYBOOK.md 참조. 신규 스위트는 SUITES 에 등록.
const SUITES = {
  mobile: () => require('./mobile-keyboard'),
  // crosscut: () => require('./canary-crawl'),   // 다음 단계
  // chrome: () => require('./chrome-suppression'),
};

function printSuite(name, results) {
  let fail = 0;
  console.log(`\n=== ${name} ===`);
  for (const r of results) {
    const status = r.fail > 0 ? '❌' : (r.inputs === 0 ? '⚪' : '✅');
    console.log(`${status} ${r.name} (${r.path}) — 입력 ${r.inputs} · 통과 ${r.pass} · 실패 ${r.fail}`);
    (r.details || []).forEach((d) => console.log('     └ ' + d));
    fail += r.fail;
  }
  return fail;
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
