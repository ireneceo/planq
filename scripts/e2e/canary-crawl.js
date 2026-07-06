// scripts/e2e/canary-crawl.js — 표시명 누출 카나리 크롤 (라우트 몰라도 검출).
//   워크스페이스 표시명(BusinessMember.name)을 카나리로 심고 전 워크스페이스 라우트 크롤 →
//   계정명(User.name)이 렌더되면 = 표시명 helper 누락 라우트(FAIL). INSPECTION_PLAYBOOK §5.
//   ★ 테스트 데이터 try/finally 원복 필수 (feedback_test_data_restore).
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });  // CWD 무관 DB env 로드
const b = require('./lib/browser');
const m = require('/opt/planq/dev-backend/models');

const CANARY = 'ZZCANARYWS';           // 워크스페이스 표시명 (이게 보여야 정상)
const BIZ = 5;
const EMAIL = 'health-check@planq.kr';

// 워크스페이스 컨텍스트 라우트만 (계정/개인 컨텍스트 /profile·/me·/personal-vault 는 계정명 정상이라 제외)
const ROUTES = [
  '/dashboard', '/inbox', '/tasks', '/talk', '/calendar', '/notes', '/docs',
  '/files', '/bills', '/insights', '/wiki', '/info', '/signatures/received',
  '/business/clients', '/business/members', '/business/org',
];

async function run() {
  const u = await m.User.findOne({ where: { email: EMAIL } });
  const bm = await m.BusinessMember.findOne({ where: { user_id: u.id, business_id: BIZ } });
  const accountName = u.name;                 // 새면 안 되는 계정명
  const origName = bm.name;
  const origLocalized = bm.name_localized;
  const results = [];
  await bm.update({ name: CANARY, name_localized: null });   // 카나리 심기
  const { browser, page } = await b.launch({ mobile: false });
  try {
    await b.login(page);
    await b.goto(page, '/dashboard');  // 최초 full 로드로 앱 부팅 + 인증 정착 (이후 리부트 없이 SPA 네비 → refresh 레이스/rate-limit 회피)
    await b.sleep(1500);
    for (const route of ROUTES) {
      try {
        await b.gotoSPA(page, route);
        if (page.url().includes('/login')) { results.push({ route, skip: '로그인 리다이렉트' }); continue; }
        const r = await page.evaluate((acct, can) => {
          const txt = document.body.innerText || '';
          // 계정명 등장 위치 주변 스니펫 (진단용)
          const idx = txt.indexOf(acct);
          const snippet = idx >= 0 ? txt.slice(Math.max(0, idx - 20), idx + acct.length + 15).replace(/\s+/g, ' ') : null;
          return { leaked: idx >= 0, hasCanary: txt.includes(can), snippet };
        }, accountName, CANARY);
        results.push({ route, ...r });
      } catch (e) { results.push({ route, error: e.message.slice(0, 60) }); }
    }
  } finally {
    await browser.close();
    await bm.update({ name: origName, name_localized: origLocalized });  // ★ 원복
  }
  return results;
}

module.exports = { run, name: 'canary-crawl' };

if (require.main === module) {
  run().then((res) => {
    let leaks = 0;
    console.log('\n=== 표시명 카나리 크롤 (계정명 누출 = FAIL) ===');
    console.log(`(카나리 워크스페이스 표시명="${CANARY}" 심음 → 이게 보여야 정상, 계정명 보이면 누출)\n`);
    for (const r of res) {
      if (r.skip) { console.log(`⚪ ${r.route} — ${r.skip}`); continue; }
      if (r.error) { console.log(`⚠️ ${r.route} — ERROR ${r.error}`); continue; }
      const status = r.leaked ? '❌ 누출' : (r.hasCanary ? '✅' : '·');
      console.log(`${status} ${r.route}${r.leaked ? `  → "${r.snippet}"` : ''}`);
      if (r.leaked) leaks++;
    }
    console.log(`\n총 누출 라우트: ${leaks}`);
    process.exit(leaks > 0 ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e.message); process.exit(2); });
}
