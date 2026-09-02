// scripts/e2e/canary-toggles.js — 자동저장 **토글이 눌러서 실제로 저장되는가** 카나리.
//
//   왜 존재하는가: `AutoSaveField` 는 자식의 `onChange` 만 감싸 저장을 걸었다. 그런데 토글은
//   전부 `<button onClick>`(또는 안쪽에 input 을 감싼 label)이라 **자식에 onChange 가 없다.**
//   그래서 클릭하면 화면 문구만 바뀌고 서버로는 아무것도 가지 않았다 — 운영 **점검 모드**를
//   포함해 5곳이 그 상태로 살아 있었다. 운영자는 "껐다" 고 믿는다.
//
//   존재 검사·tsc·가드 3축·API 직접 호출 테스트는 전부 통과한다. API 를 부르는 건 테스트고,
//   화면이 그 API 를 안 부르는 것이 결함이기 때문이다(memory feedback_backend_done_ui_missing).
//   **눌러서 네트워크가 나가는지 봐야만 드러난다** — 그래서 이 카나리는 요청을 센다.
//
//   판정은 "PUT 이 났는가" 이지 DB 값이 아니다. 각 항목은 끝에서 원래 설정으로 되돌리므로
//   DB 는 시작과 같아야 정상이다. 값으로 판정하면 원복이 곧 실패로 보인다.
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env', quiet: true });
const puppeteer = require('/opt/planq/dev-backend/node_modules/puppeteer');

const BACKEND = process.env.CANARY_BACKEND || 'http://localhost:3003';
const FRONT = process.env.CANARY_FRONT || 'https://dev.planq.kr';
// 플랫폼 설정은 platform_admin 만 연다 — 다른 카나리의 health-check 계정으로는 403 이라
//   화면 자체가 안 뜬다(그러면 "토글 없음 = 통과" 라는 거짓 PASS 가 된다).
const ADMIN = { email: 'admin@test.planq.kr', password: 'Test1234!' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login() {
  const res = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ADMIN),
  });
  const body = await res.json();
  const token = body?.data?.token;
  const m = /refresh_token=([^;]+)/.exec(res.headers.get('set-cookie') || '');
  if (!token || !m) throw new Error('platform_admin 로그인 실패');
  return { token, refresh: m[1] };
}

// 원복은 화면이 아니라 API 로 한다 — 화면이 고장난 상태(=이 카나리가 잡으려는 상태)에서도
//   원복은 반드시 성공해야 한다. 원복을 화면에 맡기면 실패한 회차가 dev 를 점검 모드로 남긴다.
async function restore(token, patch) {
  await fetch(`${BACKEND}/api/admin/platform-settings`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }).catch(() => null);
}

async function getSettings(token) {
  const r = await fetch(`${BACKEND}/api/admin/platform-settings`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return (await r.json())?.data || {};
}

async function goto(page, path) {
  const base = path.split('?')[0];
  for (let i = 0; i < 6; i++) {
    await page.goto(`${FRONT}${path}`, { waitUntil: 'networkidle2', timeout: 40000 });
    await sleep(3500);
    if (!page.url().includes(base)) continue;
    await sleep(2000);
    if (page.url().includes(base)) return true;
  }
  return false;
}

/** 클릭 → 저장 요청이 나갔는가. AutoSaveField 의 debounce(토글 300ms)보다 넉넉히 기다린다. */
async function clickAndWatch(page, handle, urlPart, methods = ['PUT', 'PATCH']) {
  const seen = [];
  const onReq = (req) => {
    if (req.url().includes(urlPart) && methods.includes(req.method())) seen.push(req.method());
  };
  page.on('request', onReq);
  try {
    await handle.click();
    for (let i = 0; i < 20 && seen.length === 0; i++) await sleep(150);
  } finally {
    page.off('request', onReq);
  }
  return seen.length;
}

async function run() {
  const results = [];
  let auth;
  try { auth = await login(); }
  catch (e) { return [{ name: 'toggles:login', error: true, fatal: 1, detail: e.message }]; }

  const before = await getSettings(auth.token);
  const snapshot = {
    maintenance_mode: before.maintenance_mode === true,
    guest_links_enabled: before.guest_links_enabled === true,
    announcement_dismissible: before.announcement_dismissible !== false,
    announcement_severity: before.announcement_severity || 'info',
  };

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 1200 });
    await page.setCookie({
      name: 'refresh_token', value: auth.refresh,
      domain: new URL(FRONT).hostname, path: '/', httpOnly: true, secure: FRONT.startsWith('https'),
    });

    const arrived = await goto(page, '/admin/platform-settings');
    if (!arrived) {
      results.push({ name: 'toggles:플랫폼 설정 화면 도달', fail: 1, details: [`도달 못함 (현재 ${page.url()})`] });
      return results;
    }

    // 스위치 전수 — 라벨은 가장 가까운 카드의 제목에서 딴다(어느 스위치가 죽었는지 이름으로 보이게).
    const labels = await page.$$eval('[role="switch"]', (els) => els.map((el) => {
      const card = el.closest('div');
      let node = el, title = '';
      for (let i = 0; i < 8 && node; i++) {
        node = node.parentElement;
        const h = node && node.querySelector && node.querySelector('h2,h3,[class*="SectionTitle"]');
        if (h && h.textContent) { title = h.textContent.trim(); break; }
      }
      return title || (card && card.getAttribute('aria-label')) || '(이름 없음)';
    }));

    const switches = await page.$$('[role="switch"]');
    if (switches.length === 0) {
      results.push({ name: 'toggles:스위치 발견', fail: 1, details: ['[role="switch"] 0개 — 화면이 안 떴거나 마크업이 바뀌었다(판정 불가를 통과로 두지 않는다)'] });
      return results;
    }

    for (let i = 0; i < switches.length; i++) {
      const label = labels[i] || `스위치 ${i + 1}`;
      const n = await clickAndWatch(page, switches[i], '/api/admin/platform-settings');
      // ★ 매 항목 직후 원복 — 특히 점검 모드는 켜지면 dev 전체가 503 이 된다.
      await restore(auth.token, snapshot);
      results.push({
        name: `toggles:${label} 스위치가 저장을 보낸다`,
        fail: n > 0 ? 0 : 1,
        details: n > 0 ? [] : ['클릭했으나 저장 요청 0건 — 화면 문구만 바뀌고 서버엔 안 갔다'],
      });
      await sleep(400);
    }

    // 심각도 버튼(스위치가 아닌 버튼 그룹) — 지금 선택된 것 말고 다른 것을 누른다.
    const sevBtns = await page.$$('#announcement ~ * button, [id="announcement"] ~ div button');
    if (sevBtns.length >= 2) {
      const n = await clickAndWatch(page, sevBtns[sevBtns.length - 1], '/api/admin/platform-settings');
      await restore(auth.token, snapshot);
      results.push({
        name: 'toggles:공지 심각도 버튼이 저장을 보낸다',
        fail: n > 0 ? 0 : 1,
        details: n > 0 ? [] : ['클릭했으나 저장 요청 0건'],
      });
    } else {
      results.push({ name: 'toggles:공지 심각도 버튼', fail: 0, details: ['버튼 그룹 못 찾음 — 판정 제외'] });
    }
  } finally {
    // 브라우저가 어떻게 끝났든 설정은 반드시 원래대로. 점검 모드가 켜진 채 남으면 dev 가 죽는다.
    await restore(auth.token, snapshot);
    await browser.close();
  }
  return results;
}

module.exports = { name: 'toggles', run };
