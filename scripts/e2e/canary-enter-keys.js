// canary-enter-keys — «엔터 = 그 버튼» 이 실제로 눌리는가 + 한글 조합 중 엔터는 안 눌리는가 (2026-11-11)
//
//   Irene: «모바일이랑 모두 반응형 점검 최적화 다 했어? 버튼 엔터값 모두»
//   한 칸 + 옆 버튼 한 줄(UI_DESIGN_GUIDE §1.8)은 Enter 가 그 버튼이다. 정적 가드(--category=enterime)는
//   «판정을 공용 함수로 하는가» 만 본다 — 엔터가 실제로 요청을 내보내는지는 눌러봐야 안다.
//
//   ① 메일 도메인 규칙 칸: 조합 중 Enter(isComposing) → POST 0건 (음성)
//   ② 같은 칸: 진짜 Enter → POST 1건 + 목록에 보임 (양성 — ①이 «아무것도 안 하는 칸» 이라 0 인 게 아님을 증명)
//   ③ 빈 칸에서 Enter → POST 0건 (버튼 비활성 조건을 엔터도 지킨다)
//   ④ 대시보드 «확인 필요» 카드: Tab 으로 가서 Enter → /inbox
//   만든 규칙은 끝에서 API 로 지운다.
require('./lib/mem-slot'); // 메모리 자리표(planq-chrome) 안에서 돈다 — 맨 처음에 둔다
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env', quiet: true });
const b = require('./lib/browser');

const DOMAIN = `enter-check-${Date.now().toString(36)}.example`;

async function run() {
  const results = [];
  const push = (name, ok, detail) => results.push({ name, fail: ok ? 0 : 1, details: [detail] });
  const { browser, page } = await b.launch();
  const posts = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/email-domain-rules$/.test(r.url())) posts.push(r.postData() || '');
  });
  try {
    await page.setViewport({ width: 1440, height: 900 });
    await b.login(page);
    await b.goto(page, '/business/settings/mail-accounts');
    await b.dismissBlockers(page);
    const sel = 'input[placeholder="wor-pro.com"]';
    let found = false;
    for (let i = 0; i < 30 && !found; i++) { found = !!(await page.$(sel)); if (!found) await b.sleep(500); }
    if (!found) { push('enter 도메인 규칙 칸', false, '칸을 못 찾음(화면·권한 확인)'); }
    else {
      // ③ 빈 칸 Enter
      await page.focus(sel);
      await page.keyboard.press('Enter');
      await b.sleep(800);
      push('enter ③ 빈 칸 Enter → 요청 없음', posts.length === 0, `POST ${posts.length}건`);

      await page.type(sel, DOMAIN);
      // ① 조합 중 Enter
      await page.evaluate((s) => {
        const el = document.querySelector(s);
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
      }, sel);
      await b.sleep(800);
      push('enter ① 한글 조합 중 Enter → 요청 없음', posts.length === 0, `POST ${posts.length}건`);

      // ② 진짜 Enter
      await page.focus(sel);
      await page.keyboard.press('Enter');
      for (let i = 0; i < 20 && posts.length === 0; i++) await b.sleep(250);
      await b.sleep(1200);
      const shown = await page.evaluate((d) => document.body.innerText.includes(d), DOMAIN);
      push('enter ② Enter → 추가됨', posts.length === 1 && posts[0].includes(DOMAIN) && shown,
        `POST ${posts.length}건 · 목록에 보임 ${shown}`);
    }

    // ④ 대시보드 카드 — 키보드로 가서 Enter
    await b.goto(page, '/dashboard');
    await b.dismissBlockers(page);
    let card = null;
    for (let i = 0; i < 30 && !card; i++) { card = await page.$('[data-testid="dashboard-inbox-card"]'); if (!card) await b.sleep(500); }
    if (!card) push('enter ④ 대시보드 «확인 필요» 카드', false, '카드를 못 찾음(개인 보기 기본인데 안 그려짐)');
    else {
      await card.focus();
      await page.keyboard.press('Enter');
      await b.sleep(1500);
      const p = await page.evaluate(() => location.pathname);
      push('enter ④ 대시보드 «확인 필요» 카드 Enter → /inbox', p === '/inbox', `주소 ${p}`);
    }
  } finally {
    // 만든 규칙 지우기
    try {
      await page.evaluate(async (d) => {
        const r = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
        const tok = (await r.json())?.data?.token;
        const me = await (await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${tok}` } })).json();
        const biz = me?.data?.active_business_id || me?.data?.business_id;
        const list = await (await fetch(`/api/businesses/${biz}/email-domain-rules`, { headers: { Authorization: `Bearer ${tok}` } })).json();
        for (const x of (list?.data || [])) if (x.domain === d) await fetch(`/api/businesses/${biz}/email-domain-rules/${x.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${tok}` } });
      }, DOMAIN);
    } catch { /* 정리 실패는 아래 DB 정리가 줍는다 */ }
    await browser.close();
    try {
      const { sequelize } = require('/opt/planq/dev-backend/config/database');
      await sequelize.query('DELETE FROM email_domain_rules WHERE domain = ?', { replacements: [DOMAIN] });
    } catch { /* 정리 실패 — 이름이 enter-check-* 라 다음 실행·정리에서 보인다 */ }
  }
  return results;
}

module.exports = { name: 'enterkeys', run };

if (require.main === module) {
  require('./lib/gate-header');
  run().then((rs) => {
    let bad = 0;
    rs.forEach((r) => { if (r.fail) bad++; console.log(`${r.fail ? '❌' : '✅'} ${r.name} — ${r.details[0]}`); });
    process.exit(bad ? 1 : 0);
  }).catch((e) => { console.error('🔴 하니스 오류:', e.message); process.exit(2); });
}
