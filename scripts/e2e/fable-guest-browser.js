// Fable 게이트 — #259 게스트 화면 실브라우저 검증 (임시, 끝나면 삭제)
const { launch, login, goto, sleep } = require('./lib/browser');
const st = JSON.parse(require('fs').readFileSync('/tmp/fable-guest-state.json', 'utf8'));
const ok = (n, c, d = '') => console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
const SHOT = '/tmp/fable-guest-shots';
require('fs').mkdirSync(SHOT, { recursive: true });

(async () => {
  // ① 게스트 (폰·비로그인·ko)
  const { browser, page } = await launch({ mobile: true });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'ko-KR,ko;q=0.9' });
  const reqs = [];
  page.on('response', (r) => { const u = r.url(); if (u.includes('/api/')) reqs.push(`${r.status()} ${u.replace('https://dev.planq.kr', '')}`); });
  await page.goto('https://dev.planq.kr/g/' + st.tokens[0], { waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 20; i++) { const t = await page.evaluate(() => document.body.innerText); if (t.includes('GUEST_HELLO_ZZ6')) break; await sleep(500); }
  await page.screenshot({ path: SHOT + '/guest-mobile.png', fullPage: false });
  const text = await page.evaluate(() => document.body.innerText);
  ok('guest page shows public msgs', text.includes('GUEST_HELLO_ZZ6') && text.includes('PUBLIC_OK_ZZ1') && text.includes('MEMBER_MSG_ZZ9'));
  ok('guest page hides internal/draft/deleted', !text.includes('INTERNAL_SECRET') && !text.includes('DRAFT_SECRET') && !text.includes('MEMBER_INTERNAL'), text.includes('DELETED_SECRET') ? 'DELETED_SECRET visible!' : '');
  const chrome = await page.evaluate(() => {
    const q = (s) => document.querySelectorAll(s).length;
    return {
      nav: q('nav'), aside: q('aside'), sidebar: q('[data-testid*="sidebar"],[class*="Sidebar"],[class*="sidebar"]'),
      links: [...document.querySelectorAll('a')].map(a => a.getAttribute('href')).filter(Boolean),
      buttons: [...document.querySelectorAll('button')].map(b => (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 30)),
      fab: q('[aria-label*="helper" i],[aria-label*="Q helper" i],[data-testid*="cue-help"],[data-testid*="help-fab"]'),
      dialogs: q('[role="dialog"]'),
      imgs: [...document.querySelectorAll('img')].map(i => i.getAttribute('src')).slice(0, 5),
      title: document.title,
      hasLoginWord: /로그인|가입|Sign in|Sign up/i.test(document.body.innerText),
    };
  });
  console.log('CHROME', JSON.stringify(chrome));
  ok('no nav/aside/sidebar chrome', chrome.nav === 0 && chrome.aside === 0 && chrome.sidebar === 0);
  ok('no login/signup wording', !chrome.hasLoginWord);
  ok('[info] buttons on guest page', true, JSON.stringify(chrome.buttons));
  ok('[info] api calls', true, JSON.stringify(reqs));
  // 작성
  await page.type('textarea', 'BROWSER_GUEST_ZZ12');
  await page.click('button[type="button"]:not([disabled])');
  for (let i = 0; i < 12; i++) { const t = await page.evaluate(() => document.body.innerText); if (t.includes('BROWSER_GUEST_ZZ12')) break; await sleep(500); }
  const t2 = await page.evaluate(() => document.body.innerText);
  ok('guest sends message via UI → appears', t2.includes('BROWSER_GUEST_ZZ12'));
  await page.screenshot({ path: SHOT + '/guest-mobile-after.png' });
  // 회수된 토큰 화면
  await page.goto('https://dev.planq.kr/g/' + st.tokens[3], { waitUntil: 'domcontentloaded' });
  await sleep(2500);
  const t3 = await page.evaluate(() => document.body.innerText);
  ok('revoked token → expired screen', /만료|expired/i.test(t3), t3.slice(0, 80).replace(/\n/g, ' '));
  await page.screenshot({ path: SHOT + '/guest-revoked.png' });
  await browser.close();

  // ② 멤버 데스크탑 — 발급 버튼 위치
  const m = await launch({ mobile: false });
  await m.page.setViewport({ width: 1400, height: 900 });
  await login(m.page);
  await goto(m.page, '/talk?conv=130');
  await sleep(2500);
  let hasBtn = await m.page.evaluate(() => [...document.querySelectorAll('button')].some(b => /고객 링크|Guest link/i.test(b.textContent || '')));
  await m.page.screenshot({ path: SHOT + '/member-customer-conv.png' });
  ok('member: customer conv shows 고객 링크 button', hasBtn);
  if (hasBtn) {
    await m.page.evaluate(() => [...document.querySelectorAll('button')].find(b => /고객 링크|Guest link/i.test(b.textContent || '')).click());
    await sleep(1500);
    const modal = await m.page.evaluate(() => { const d = document.querySelector('[aria-modal="true"],[role="dialog"]'); return d ? d.innerText.slice(0, 400) : null; });
    ok('modal opens (aria-modal)', !!modal, (modal || '').replace(/\n/g, ' ').slice(0, 200));
    await m.page.screenshot({ path: SHOT + '/member-modal.png' });
  }
  await goto(m.page, '/talk?conv=275');
  await sleep(2500);
  const title = await m.page.evaluate(() => document.body.innerText.includes('내부 논의'));
  hasBtn = await m.page.evaluate(() => [...document.querySelectorAll('button')].some(b => /고객 링크|Guest link/i.test(b.textContent || '')));
  ok('member: internal conv (내부 논의 loaded=' + title + ') has NO 고객 링크 button', !hasBtn);
  await m.page.screenshot({ path: SHOT + '/member-internal-conv.png' });
  await m.browser.close();
})().catch((e) => { console.error('BROWSER ERROR', e.message); process.exit(1); });
