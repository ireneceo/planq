// scripts/e2e/canary-crawl.js — 표시명 누출 카나리 크롤 (라우트 몰라도 검출).
//   워크스페이스 표시명(BusinessMember.name)을 카나리로 심고 전 워크스페이스 라우트 크롤 →
//   계정명(User.name)이 렌더되면 = 표시명 helper 누락 라우트(FAIL). INSPECTION_PLAYBOOK §5.
//   ★ 테스트 데이터 try/finally 원복 필수 (feedback_test_data_restore).
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });  // CWD 무관 DB env 로드
const b = require('./lib/browser');
const m = require('/opt/planq/dev-backend/models');
const { Op } = require('/opt/planq/dev-backend/node_modules/sequelize');

const CANARY = 'ZZCANARYWS';           // 워크스페이스 표시명 (이게 보여야 정상)
const CANARY_OTHER = 'ZZCANARYOTHER';  // 제2 멤버(관찰 대상) 표시명 — #277 계열 검출용
// ★ 제2 멤버의 **계정명에도 카나리를 심는다** (Fable 게이트 수정 2026-08-16).
//   실제 계정명을 needle 로 쓰면 그 이름이 흔한 문자열일 때 거짓양성이 난다 —
//   실측: BIZ5 의 제2 멤버가 Cue 시스템 유저(계정명 'Cue')로 뽑혀 제품 카피
//   "Cue 연동"·"Cue (AI 팀원)" 에 전부 매치, 5개 라우트 거짓 누출로 게이트가 빨갰다.
//   계정명 자체를 카나리로 바꿔 두면 needle 이 결정론적이고 충돌이 0 이다.
const CANARY_OTHER_ACCT = 'ZZOTHERACCT';
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
  // ★ 운영 #277 로 드러난 사각 — 여태 **로그인한 본인**의 계정명만 검사했다.
  //   그런데 리스트에서 본인은 보통 "나" 로 표기되고, 실제로 새는 것은 **다른 멤버**의 이름이다.
  //   (#277: 담당자 '루아'(BusinessMember.name)가 어떤 행에서만 '한수정'(User.name)으로 나왔다.)
  //   그래서 관찰자(본인)로 로그인한 채 **제2 멤버**에도 카나리를 심고 그 계정명 누출을 같이 본다.
  //   ★ Cue 등 시스템 유저는 제외 — 계정명이 제품 용어와 겹쳐 판정이 오염된다.
  const otherCandidates = await m.BusinessMember.findAll({
    where: { business_id: BIZ, user_id: { [Op.ne]: u.id }, removed_at: null },
    include: [{ model: m.User, as: 'user', attributes: ['id', 'name', 'email'] }],
  });
  const other = otherCandidates.find((c) => c.user && !/@system\.planq\.kr$/i.test(c.user.email || '')) || null;
  const otherOrig = other ? { name: other.name, name_localized: other.name_localized } : null;
  const otherUserOrigName = other ? other.user.name : null;
  const accountName = u.name;                 // 새면 안 되는 계정명
  const origName = bm.name;
  const origLocalized = bm.name_localized;
  const results = [];
  await bm.update({ name: CANARY, name_localized: null });   // 카나리 심기
  if (other) {
    await other.update({ name: CANARY_OTHER, name_localized: null });
    await m.User.update({ name: CANARY_OTHER_ACCT }, { where: { id: other.user.id } });  // 계정명 카나리
  }
  const { browser, page } = await b.launch({ mobile: false });
  try {
    await b.login(page);
    await b.goto(page, '/dashboard');  // 최초 full 로드로 앱 부팅 + 인증 정착 (이후 리부트 없이 SPA 네비 → refresh 레이스/rate-limit 회피)
    await b.sleep(1500);
    for (const route of ROUTES) {
      try {
        await b.gotoSPA(page, route);
        if (page.url().includes('/login')) { results.push({ route, skip: '로그인 리다이렉트' }); continue; }
        const r = await page.evaluate((acct, can, otherAcct) => {
          const txt = document.body.innerText || '';
          const snip = (needle) => {
            const i = txt.indexOf(needle);
            return i >= 0 ? txt.slice(Math.max(0, i - 20), i + needle.length + 15).replace(/\s+/g, ' ') : null;
          };
          // 본인 계정명 + (있으면) 제2 멤버 계정명 — 어느 쪽이든 렌더되면 표시명 헬퍼 누락이다.
          const selfLeak = txt.indexOf(acct) >= 0;
          const otherLeak = !!otherAcct && txt.indexOf(otherAcct) >= 0;
          return {
            leaked: selfLeak || otherLeak,
            hasCanary: txt.includes(can),
            snippet: selfLeak ? snip(acct) : (otherLeak ? snip(otherAcct) : null),
            who: selfLeak ? 'self' : (otherLeak ? 'other-member' : null),
          };
        }, accountName, CANARY, other ? CANARY_OTHER_ACCT : null);
        results.push({ route, ...r });
      } catch (e) { results.push({ route, error: e.message.slice(0, 60) }); }
    }
  } finally {
    await browser.close();
    await bm.update({ name: origName, name_localized: origLocalized });  // ★ 원복
    if (other && otherOrig) await other.update(otherOrig);               // ★ 제2 멤버도 원복
    if (other) await m.User.update({ name: otherUserOrigName }, { where: { id: other.user.id } });  // ★ 계정명 원복
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
