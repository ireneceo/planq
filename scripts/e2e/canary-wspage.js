// canary-wspage — 워크스페이스 공개 페이지 P1 화면 (2026-11-20 · docs/WORKSPACE_PUBLIC_PAGE_DESIGN.md §10 P1)
//
// 재는 것 (폰 390 · 태블릿 820 · 데스크탑 1440):
//   ① 설정 «공개 페이지» 탭 — 편집 카드 4개와 미리 보기가 **그려져 있는가**(elementFromPoint) · 가로 넘침 0
//   ② 미리 보기의 서비스 카드 = 서버 저장값(서비스 이름이 보인다)
//   ③ 고객 창구(무로그인 /g/<토큰>) 안내 탭 — 서비스 카드·회사 정보가 보이고 **가린 이메일 글자가 화면에 0**
//   ④ Q sale 머리 [우리 페이지] → 작은 창에 주소가 보인다
//   ⑤ (데스크탑) 사이드바 워크스페이스 메뉴의 «우리 공개 페이지»
//   대조군 — 가림을 풀면 ③ 의 이메일이 **보인다**(안 보이면 판정기가 죽은 것) · 끝나면 가림을 되돌린다
//
// 픽스처는 Node 에서(브라우저 안 fetch 는 하니스를 죽인다). ws6(시험 워크스페이스)의 [확인용] 데이터만 쓴다.
const { launch, login, sleep, BASE } = require('./lib/browser');

const API = process.env.E2E_API || 'http://localhost:3003';
const OWNER = { email: 'owner@test.planq.kr', password: 'Test1234!' };
const BIZ = 6;
const VPS = [
  { name: 'phone', w: 390, h: 844, mobile: true },
  { name: 'tablet', w: 820, h: 1180, mobile: false },
  { name: 'desktop', w: 1440, h: 900, mobile: false },
];
let results = [];
// 러너(run.js printSuite) 모양 — { name, fail, details }. 혼자 돌릴 때는 줄마다 찍는다.
const push = (n, ok, d = '') => { results.push({ name: n, fail: ok ? 0 : 1, hasCanary: true, details: [String(d)] }); if (require.main === module) console.log(`${ok ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`); };

let tok = null;
async function api(path, init = {}) {
  if (!tok) {
    const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(OWNER) });
    const j = await r.json(); tok = j.data.accessToken || j.data.token;
  }
  const r = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function visibleText(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return { ok: false, why: 'none' };
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return { ok: false, why: `size ${r.width}x${r.height}` };
    // 화면 안에 보이는 부분의 가운데를 찌른다 — 화면보다 큰 칸은 위 끝이 화면 밖일 수 있다(첫 실행 오판)
    const top = Math.max(r.top, 0); const bot = Math.min(r.bottom, window.innerHeight);
    const left = Math.max(r.left, 0); const right = Math.min(r.right, window.innerWidth);
    if (bot - top < 2 || right - left < 2) return { ok: false, why: 'offscreen' };
    const hit = document.elementFromPoint((left + right) / 2, (top + bot) / 2);
    return { ok: !!hit && (el === hit || el.contains(hit)), why: hit ? `${hit.tagName}.${(hit.className || '').toString().slice(0, 30)}` : 'nohit', text: el.innerText };
  }, sel);
}
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function run() {
  results = [];
  let inquiryEmail = null;
  const ce = await api(`/api/businesses/${BIZ}/customer-entry`);
  const url = ce.body?.data?.link?.url;
  const email = ce.body?.data?.auto?.email;
  const svc = ce.body?.data?.customer_entry?.services?.[0]?.name;
  // 창구는 방문자 언어로 그린다(헤드리스 크롬 = 영어) — 영어 이름이 있으면 그것이 보인다
  const svcEn = ce.body?.data?.customer_entry?.services?.[0]?.name_en || svc;
  const hidden = ce.body?.data?.customer_entry?.hidden || [];
  if (!url || !email || !svc || !hidden.includes('email')) {
    push('픽스처(ws6 창구 링크·이메일·서비스·이메일 가림)', false, JSON.stringify({ url: !!url, email, svc, hidden }));
    return results;
  }
  const token = url.split('/g/')[1];

  for (const vp of VPS) {
    const { browser, page } = await launch({ mobile: vp.mobile });
    try {
      await page.setViewport({ width: vp.w, height: vp.h, isMobile: vp.mobile, hasTouch: vp.mobile, deviceScaleFactor: vp.mobile ? 2 : 1 });
      // ③ 무로그인 창구 — 로그인 전에 먼저(쿠키 없는 손님)
      await page.goto(`${BASE}/g/${token}`, { waitUntil: 'networkidle2' });
      await page.waitForSelector('[data-testid="entry-sec-services"]', { timeout: 20000 }).catch(() => null);
      await sleep(800);   // 사진·글꼴이 들어와 칸 높이가 자리 잡은 뒤에 잰다
      const sec = await page.$eval('[data-testid="entry-sec-services"]', (e) => e.innerText).catch(() => '');
      const card = await visibleText(page, '[data-testid^="entry-service-card-"]');
      push(`[${vp.name}] 창구 안내: 서비스 카드 보임`, card.ok && (sec.includes(svc) || sec.includes(svcEn)), card.why);
      const info = await visibleText(page, '[data-testid="entry-sec-info"]');
      push(`[${vp.name}] 창구 안내: 회사 정보 보임`, info.ok, info.why);
      const bodyText = await page.evaluate(() => document.body.innerText);
      push(`[${vp.name}] 창구 안내: 가린 이메일 화면 0`, !bodyText.includes(email));
      push(`[${vp.name}] 창구 안내: 가로 넘침 0`, (await overflowX(page)) <= 0);

      // ⑦ (P2) 문의 폼 — 3폭 모두 그려지는가 · 데스크탑에서만 실제로 보낸다(IP 시간당 3 한도)
      const form = await visibleText(page, '[data-testid="entry-inquiry-form"]');
      push(`[${vp.name}] 창구 안내: 문의 폼 그려짐`, form.ok, form.why);
      if (vp.name === 'desktop') {
        // [이 서비스 문의] → 폼으로 내려가고 서비스가 미리 골라진다
        await page.click('[data-testid^="entry-service-ask-"]');
        await sleep(700);
        const picked = await page.$eval('input[name="service_id"]', (e) => e.value).catch(() => '');
        push('[desktop] [이 서비스 문의] → 서비스 미리 선택', !!picked, picked);
        const sendDisabled = await page.$eval('[data-testid="entry-inquiry-send"]', (e) => e.disabled);
        push('[desktop] 빈 폼은 보내기 비활성(+이유)', sendDisabled === true);
        await sleep(2500);   // 3초 봇 판정을 넘긴다(사람처럼)
        await page.type('[data-testid="entry-inquiry-name"]', '[확인용] 카나리 손님');
        inquiryEmail = `canary-${Date.now()}@example.com`;
        await page.type('[data-testid="entry-inquiry-email"]', inquiryEmail);
        await page.type('[data-testid="entry-inquiry-message"]', '카나리 문의입니다. 견적이 궁금합니다.');
        await page.click('[data-testid="entry-inquiry-consent"]');
        await page.click('[data-testid="entry-inquiry-send"]');
        await page.waitForSelector('[data-testid="entry-inquiry-done"], [data-testid="entry-inquiry-error"]', { timeout: 15000 }).catch(() => null);
        const done = await page.$('[data-testid="entry-inquiry-done"]');
        const errTxt = await page.$eval('[data-testid="entry-inquiry-error"]', (e) => e.textContent).catch(() => '');
        push('[desktop] 문의 보내기 → «보냈어요»', !!done, errTxt);
      }

      // 로그인 → ① 설정 탭
      await login(page, OWNER);
      await page.goto(`${BASE}/business/settings/public-page`, { waitUntil: 'networkidle2' });
      await page.waitForSelector('[data-testid="wspage-settings"]', { timeout: 20000 }).catch(() => null);
      // 주소 카드는 자기 자료를 따로 읽는다(불러오는 중엔 손잡이가 없다) — 그려질 때까지 기다린다
      await page.waitForSelector('[data-testid="settings-customer-entry"]', { timeout: 20000 }).catch(() => null);
      for (const k of ['settings-customer-entry', 'wspage-auto', 'wspage-intro', 'wspage-services', 'wspage-extras', 'wspage-preview']) {
        const v = await visibleText(page, `[data-testid="${k}"]`);
        push(`[${vp.name}] 설정: ${k} 그려짐`, v.ok, v.why);
      }
      const pv = await page.$eval('[data-testid="wspage-preview"]', (e) => e.innerText).catch(() => '');
      push(`[${vp.name}] 미리 보기에 서비스 이름`, pv.includes(svc));
      push(`[${vp.name}] 미리 보기에 가린 이메일 0`, !pv.includes(email));
      push(`[${vp.name}] 설정: 가로 넘침 0`, (await overflowX(page)) <= 0);

      // ⑧ (P2) Q sale «신규 문의» — 방금 보낸 건이 맨 위 묶음에 있고, 열어서 [처리함] 하면 신규에서 빠진다
      if (vp.name === 'desktop' && inquiryEmail) {
        const list = await api(`/api/sale/${BIZ}/inquiries?status=new`);
        const mine = (list.body?.data || []).find((x) => x.email === inquiryEmail);
        push('[desktop] 보낸 문의가 서버 신규함에', !!mine);
        await page.goto(`${BASE}/sale?tab=inbox`, { waitUntil: 'networkidle2' });
        await page.waitForSelector('[data-testid="sale-inquiries"]', { timeout: 20000 }).catch(() => null);
        const sec = await visibleText(page, '[data-testid="sale-inquiries"]');
        push('[desktop] Q sale 상담 탭 «신규 문의» 묶음 보임', sec.ok && (sec.text || '').includes('[확인용] 카나리 손님'), sec.why);
        if (mine) {
          await page.click(`[data-testid="sale-inquiry-${mine.id}"]`);
          await page.waitForSelector('[data-testid="inquiry-drawer-message"]', { timeout: 10000 }).catch(() => null);
          const msg = await page.$eval('[data-testid="inquiry-drawer-message"]', (e) => e.textContent).catch(() => '');
          push('[desktop] 상세 패널에 문의 내용', msg.includes('카나리 문의'), msg);
          const btns = await page.$$eval('[data-testid="inquiry-register"], [data-testid="inquiry-reply"], [data-testid="inquiry-handled"], [data-testid="inquiry-spam"]', (b) => b.length);
          push('[desktop] 버튼 4개(등록·답장·처리·스팸)', btns === 4, String(btns));
          await page.click('[data-testid="inquiry-handled"]');
          await sleep(1200);
          const after = await api(`/api/sale/${BIZ}/inquiries/${mine.id}`);
          push('[desktop] [처리함] → 서버 handled', after.body?.data?.status === 'handled', after.body?.data?.status);
        }
      }

      // ④ Q sale [우리 페이지]
      await page.goto(`${BASE}/sale`, { waitUntil: 'networkidle2' });
      await page.waitForSelector('[data-testid="sale-wspage-link"]', { timeout: 20000 }).catch(() => null);
      const btn = await visibleText(page, '[data-testid="sale-wspage-link"]');
      push(`[${vp.name}] Q sale [우리 페이지] 보임`, btn.ok, btn.why);
      if (btn.ok) {
        await page.click('[data-testid="sale-wspage-link"]');
        await page.waitForSelector('[data-testid="wspage-link-url"]', { timeout: 10000 }).catch(() => null);
        const u = await page.$eval('[data-testid="wspage-link-url"]', (e) => e.textContent).catch(() => '');
        push(`[${vp.name}] 작은 창에 주소`, u === url, u);
        await page.keyboard.press('Escape');
      }

      // ⑥ 데스크탑 — 누르면 정말 저장되는가: 가림 스위치 1번 = PUT 1건 + 저장값 · 서비스 추가 창 [저장]
      if (vp.name === 'desktop') {
        await page.goto(`${BASE}/business/settings/public-page`, { waitUntil: 'networkidle2' });
        await page.waitForSelector('[data-testid="wspage-auto-toggle-website"]', { timeout: 20000 });
        let puts = 0;
        const onReq = (r) => { if (r.method() === 'PUT' && /\/customer-entry$/.test(r.url())) puts += 1; };
        page.on('request', onReq);
        await page.click('[data-testid="wspage-auto-toggle-website"]');
        await sleep(1500);
        page.off('request', onReq);
        const after = (await api(`/api/businesses/${BIZ}/customer-entry`)).body.data.customer_entry.hidden;
        push('[desktop] 가림 스위치 — PUT 1건 + 저장됨', puts === 1 && after.includes('website'), `puts=${puts} hidden=${after}`);
        await api(`/api/businesses/${BIZ}/customer-entry`, { method: 'PUT', body: JSON.stringify({ hidden }) });

        await page.goto(`${BASE}/business/settings/public-page`, { waitUntil: 'networkidle2' });
        await page.waitForSelector('[data-testid="wspage-service-add"]', { timeout: 20000 });
        await page.click('[data-testid="wspage-service-add"]');
        await page.waitForSelector('[data-testid="wspage-service-name"]', { timeout: 10000 });
        await page.click('[data-testid="wspage-service-save"]');   // 이름 없이 저장 → 막힘
        const err = await page.$('[data-testid="wspage-service-error"]');
        push('[desktop] 이름 없는 서비스는 저장 막힘(이유 표시)', !!err);
        await page.type('[data-testid="wspage-service-name"]', '[확인용] 카나리 서비스');
        await page.click('[data-testid="wspage-service-save"]');
        await sleep(1200);
        const svcs = (await api(`/api/businesses/${BIZ}/customer-entry`)).body.data.customer_entry.services;
        const added = svcs.find((x) => x.name === '[확인용] 카나리 서비스');
        push('[desktop] 서비스 추가 창 [저장] → 저장됨', !!added, svcs.map((x) => x.name).join('|'));
        if (added) await api(`/api/businesses/${BIZ}/customer-entry`, { method: 'PUT', body: JSON.stringify({ services: svcs.filter((x) => x !== added) }) });
      }

      // ⑤ 데스크탑 — 워크스페이스 메뉴
      if (vp.name === 'desktop') {
        const trig = await page.$('[data-testid="ws-switcher-trigger"]');
        if (trig) {
          await trig.click(); await sleep(300);
          const it = await visibleText(page, '[data-testid="ws-switcher-public-page"]');
          push('[desktop] 워크스페이스 메뉴 «우리 공개 페이지»', it.ok, it.why);
        } else push('[desktop] 워크스페이스 메뉴 트리거', false, 'none');
      }
    } catch (e) {
      push(`[${vp.name}] 하니스`, false, e.message);
    } finally { await browser.close(); }
  }

  // ⑨ (P3) 공개 주소 /w/ · 회사 찾기 /directory · 설정 «공개» 카드 · 관리자 심사 — ws6 이 공개 상태일 때
  const pp = await api(`/api/businesses/${BIZ}/public-page`);
  if (pp.body?.data?.status !== 'public') {
    push('P3 픽스처(ws6 공개 상태)', false, String(pp.body?.data?.status));
  } else {
    const slug = pp.body.data.slug;
    for (const vp of VPS) {
      const { browser, page } = await launch({ mobile: vp.mobile });
      try {
        await page.setViewport({ width: vp.w, height: vp.h, isMobile: vp.mobile, hasTouch: vp.mobile, deviceScaleFactor: vp.mobile ? 2 : 1 });
        await page.goto(`${BASE}/w/${slug}`, { waitUntil: 'networkidle2' });
        await page.waitForSelector('[data-testid="wspage-public-head"]', { timeout: 20000 }).catch(() => null);
        await sleep(600);
        const head = await visibleText(page, '[data-testid="wspage-public-head"]');
        push(`[${vp.name}] 공개 주소: 머리(이름·업종) 보임`, head.ok, head.why);
        const form = await visibleText(page, '[data-testid="entry-inquiry-form"]');
        push(`[${vp.name}] 공개 주소: 문의 폼 보임`, form.ok, form.why);
        const txt = await page.evaluate(() => document.body.innerText);
        push(`[${vp.name}] 공개 주소: 가린 이메일 화면 0`, !txt.includes(email));
        push(`[${vp.name}] 공개 주소: 가로 넘침 0`, (await overflowX(page)) <= 0);
        await page.goto(`${BASE}/directory`, { waitUntil: 'networkidle2' });
        await page.waitForSelector(`[data-testid="directory-card-${slug}"]`, { timeout: 20000 }).catch(() => null);
        const card = await visibleText(page, `[data-testid="directory-card-${slug}"]`);
        push(`[${vp.name}] 회사 찾기: 카드 보임`, card.ok, card.why);
        push(`[${vp.name}] 회사 찾기: 가로 넘침 0`, (await overflowX(page)) <= 0);
        const hdr = await page.evaluate(() => {
          const h = document.querySelector('header'); if (!h) return 0;
          return Math.max(0, ...[...h.querySelectorAll('a,button')].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().right)) - window.innerWidth;
        });
        push(`[${vp.name}] 랜딩 머리줄 넘침 0`, hdr <= 0, `${Math.round(hdr)}px`);
        if (vp.name === 'desktop') {
          await page.type('[data-testid="directory-search"]', '절대없는검색어zz');
          await page.keyboard.press('Enter');
          await page.waitForSelector('[data-testid="directory-empty"]', { timeout: 10000 }).catch(() => null);
          push('[desktop] 회사 찾기 검색 0건 안내', !!(await page.$('[data-testid="directory-empty"]')));
          await login(page, OWNER);
          await page.goto(`${BASE}/business/settings/public-page`, { waitUntil: 'networkidle2' });
          await page.waitForSelector('[data-testid="wspage-listing"]', { timeout: 20000 }).catch(() => null);
          const lc = await visibleText(page, '[data-testid="wspage-listing-status"]');
          push('[desktop] 설정 «공개» 카드 상태 줄', lc.ok && /공개 중|Public/.test(lc.text || ''), lc.text);
        }
      } catch (e) { push(`[${vp.name}] P3 하니스`, false, e.message); } finally { await browser.close(); }
    }
    const { browser, page } = await launch({});
    try {
      await page.setViewport({ width: 1440, height: 900 });
      await login(page, { email: 'admin@test.planq.kr', password: 'Test1234!' });
      await page.goto(`${BASE}/admin/public-pages?status=public`, { waitUntil: 'networkidle2' });
      await page.waitForSelector(`[data-testid="admin-pp-row-${BIZ}"]`, { timeout: 20000 }).catch(() => null);
      const row = await visibleText(page, `[data-testid="admin-pp-row-${BIZ}"]`);
      push('[desktop] 관리자 «공개 페이지 심사» 공개 중 목록에 ws6', row.ok, row.why);
    } catch (e) { push('관리자 화면 하니스', false, e.message); } finally { await browser.close(); }
  }

  // 대조군 — 가림을 풀면 창구 화면에 이메일이 보여야 한다
  await api(`/api/businesses/${BIZ}/customer-entry`, { method: 'PUT', body: JSON.stringify({ hidden: hidden.filter((k) => k !== 'email') }) });
  try {
    const { browser, page } = await launch({});
    await page.goto(`${BASE}/g/${token}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('[data-testid="entry-sec-info"]', { timeout: 20000 }).catch(() => null);
    const t = await page.evaluate(() => document.body.innerText);
    push('대조군: 가림 풀면 이메일 보임', t.includes(email));
    await browser.close();
  } finally {
    await api(`/api/businesses/${BIZ}/customer-entry`, { method: 'PUT', body: JSON.stringify({ hidden }) });
  }

  return results;
}

module.exports = { run };

if (require.main === module) {
  run().then((r) => {
    const bad = r.filter((x) => x.fail).length;
    console.log(`\n${r.length - bad} 통과 / ${bad} 실패`);
    process.exit(bad ? 1 : 0);
  }).catch((e) => { console.error(e); process.exit(1); });
}
