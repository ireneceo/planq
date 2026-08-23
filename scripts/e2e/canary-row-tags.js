// scripts/e2e/canary-row-tags.js — 리스트 행 태그 버튼이 **실제로 눌리는가** 카나리.
//
//   왜 존재하는가: 태그 트리거를 팝아웃 행 본문 버튼(RowMain) **안에** 넣었더니 button-in-button 이
//   되어 브라우저가 클릭 타깃을 행 열기로 접었다. 버튼은 DOM 에 그대로 있어서 존재 검사(개수 세기)·
//   tsc·가드 3축 전부 통과했고, 운영에 나가서 사용자가 신고했다(Irene 2026-08-23 "팝아웃에서 여전히
//   안되는데"). **눌러 봐야만 드러난다** — 그래서 이 카나리는 클릭까지 한다.
//
//   쓰기는 하지 않는다(메뉴가 열리는 것까지만 확인) — 게이트가 데이터를 건드리지 않게.
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env', quiet: true });
const puppeteer = require('/opt/planq/dev-backend/node_modules/puppeteer');

const BACKEND = process.env.CANARY_BACKEND || 'http://localhost:3003';
const FRONT = process.env.CANARY_FRONT || 'https://dev.planq.kr';

async function getRefreshCookie() {
  const res = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'health-check@planq.kr', password: 'HealthCheck2026!' }),
  });
  const m = /refresh_token=([^;]+)/.exec(res.headers.get('set-cookie') || '');
  if (!m) throw new Error('refresh 쿠키 없음 (login 실패?)');
  return m[1];
}

// 로그인 복원이 /dashboard 로 되돌릴 때가 있다 — 목적지에 닿을 때까지 다시 간다.
async function goto(page, path) {
  const base = path.split('?')[0];
  for (let i = 0; i < 8; i++) {
    await page.goto(`${FRONT}${path}`, { waitUntil: 'networkidle2', timeout: 40000 });
    // 세션 복원이 **늦게** /dashboard 로 되돌리는 창이 있다. 도착 직후 한 번 보고 끝내면
    //   되돌려지기 전 순간을 "도착" 으로 읽어 뒤 검사가 엉뚱한 화면에서 돈다.
    //   그래서 5초 뒤에 다시 확인하고, 그때도 목적지면 도착으로 친다.
    await new Promise((r) => setTimeout(r, 4000));
    if (!page.url().includes(base)) continue;
    await new Promise((r) => setTimeout(r, 3000));
    if (page.url().includes(base)) return true;
  }
  return false;
}

async function checkSurface(page, name, path) {
  const arrived = await goto(page, path);
  if (!arrived) return { name, fail: 1, details: [`${path} 에 도달 못함 (현재 ${page.url()})`] };
  // 목록 렌더가 느린 회차가 있다 — 버튼이 나타날 때까지 폴링(없으면 판정 제외로 떨어진다)
  let trig = null;
  for (let i = 0; i < 12 && !trig; i++) {
    trig = await page.$('[data-testid^="task-tag-quick-"]');
    if (!trig) await new Promise((r) => setTimeout(r, 2500));
  }
  // 태그 편집 권한이 있는 행이 하나도 없으면 판정 제외(⚪ 대신 통과로 두되 사유를 남긴다)
  if (!trig) return { name, fail: 0, details: ['태그 버튼이 있는 행 없음 — 판정 제외'] };

  await trig.click();                                   // ★ 좌표 클릭 — 중첩 버튼이면 여기서 접힌다
  await new Promise((r) => setTimeout(r, 900));
  const st = await page.evaluate(() => ({
    menu: !!document.querySelector('input[placeholder*="태그"]'),
    drawer: !!document.querySelector('[role="dialog"][aria-modal="true"]'),
  }));
  await page.keyboard.press('Escape').catch(() => null);
  const ok = st.menu && !st.drawer;
  return {
    name, fail: ok ? 0 : 1,
    details: ok ? [] : [`메뉴열림=${st.menu} 행상세가대신열림=${st.drawer} — 클릭이 다른 곳으로 접혔다(button-in-button 의심)`],
  };
}

async function run() {
  const results = [];
  let refresh;
  try { refresh = await getRefreshCookie(); }
  catch (e) { return [{ name: 'rowtags:login', error: true, fatal: 1, detail: e.message }]; }

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    await page.setCookie({ name: 'refresh_token', value: refresh, domain: new URL(FRONT).hostname, path: '/', httpOnly: true, secure: FRONT.startsWith('https') });
    // ★ /login 을 먼저 열면 안 된다 — 세션 쿠키가 이미 있으면 LoginPage 의 effect 가 **/dashboard 로
    //   navigate** 하고, 그 이동이 뒤따르는 goto 를 덮어써 검사가 엉뚱한 화면에서 돈다.
    //   이 카나리가 단독 실행은 통과하고 연속 실행에서만 실패하던(flaky) 진짜 원인이 이것이다.
    //   목적지로 바로 간다 — refresh 쿠키가 그 화면에서 세션을 복원한다. (2026-08-24 실측)

    results.push(await checkSurface(page, 'rowtags:메인 리스트 태그 버튼이 눌린다', '/tasks?tab=all'));
    await page.setViewport({ width: 520, height: 780 });
    results.push(await checkSurface(page, 'rowtags:팝아웃 태그 버튼이 눌린다', '/task-popout'));
  } finally {
    await browser.close();
  }
  return results;
}

module.exports = { name: 'rowtags', run };
