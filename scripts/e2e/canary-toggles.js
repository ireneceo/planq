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
// 캘린더는 워크스페이스 자원이라 멤버 계정으로 본다 — platform_admin 은 어느 워크스페이스에도
//   속해 있지 않아 `/calendar` 가 비어 있다(그러면 "토글 없음 = 통과" 라는 거짓 PASS 가 된다).
const MEMBER = { email: 'health-check@planq.kr', password: 'HealthCheck2026!' };
const MEMBER_BIZ = 5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(who = ADMIN) {
  const res = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(who),
  });
  const body = await res.json();
  const token = body?.data?.token;
  const m = /refresh_token=([^;]+)/.exec(res.headers.get('set-cookie') || '');
  if (!token || !m) throw new Error(`로그인 실패 (${who.email})`);
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

/**
 * 클릭 → 저장 요청이 나갔는가. AutoSaveField 의 debounce(토글 300ms)보다 넉넉히 기다린다.
 *
 * ★ `expectKey` 를 받는 이유: "PUT 이 났다" 만 세면 **엉뚱한 컨트롤을 눌러도 통과한다.**
 *   실제로 그랬다 — 심각도 항목의 셀렉터가 옆 카드의 스위치를 잡아, 심각도 버튼을 한 번도
 *   누르지 않고 "심각도 ✅" 를 냈다(2026-09-02 Fable 지적). 본문에 그 컨트롤의 필드가
 *   들어 있는지까지 봐야 **누른 것이 그것임**이 증명된다.
 */
async function clickAndWatch(page, handle, urlPart, expectKey = null, methods = ['PUT', 'PATCH']) {
  const seen = [];
  const onReq = (req) => {
    if (!req.url().includes(urlPart) || !methods.includes(req.method())) return;
    let body = null;
    try { body = JSON.parse(req.postData() || '{}'); } catch { body = {}; }
    if (expectKey && !(expectKey in body)) return;   // 다른 컨트롤의 저장은 세지 않는다
    seen.push({ method: req.method(), keys: Object.keys(body) });
  };
  page.on('request', onReq);
  try {
    await handle.click();
    for (let i = 0; i < 20 && seen.length === 0; i++) await sleep(150);
  } finally {
    page.off('request', onReq);
  }
  return seen;
}

/**
 * 5번째 토글: 일정 상세의 "하루 종일". 같은 AutoSaveField 를 쓰지만 자식이 `<label>`(안쪽 input)이라
 * 모양이 다르다 — 플랫폼 설정 4곳만 보면 이 계열이 다시 죽어도 게이트가 조용하다.
 *
 * ★ 브라우저를 따로 띄운다. 같은 컨텍스트에서 쿠키만 바꾸면 앞 세션의 localStorage(액세스 토큰·
 *   활성 워크스페이스)가 남아 화면이 엉뚱한 상태로 뜬다 — 실제로 그래서 드로어가 안 열렸다.
 */
async function checkAllDayToggle() {
  let ev = null, browser = null;
  try {
    const mem = await login(MEMBER);
    const start = new Date(Date.now() + 86400000);
    const end = new Date(start.getTime() + 3600000);
    const cr = await fetch(`${BACKEND}/api/calendar/by-business/${MEMBER_BIZ}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${mem.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'CANARY 종일 토글 시험', start_at: start.toISOString(), end_at: end.toISOString(),
        all_day: false, visibility: 'personal',
      }),
    });
    const id = (await cr.json())?.data?.id;
    if (!id) throw new Error('시험 일정 생성 실패 (권한/필수값 확인)');
    ev = { id, token: mem.token };

    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 1000 });
    await page.setCookie({
      name: 'refresh_token', value: mem.refresh,
      domain: new URL(FRONT).hostname, path: '/', httpOnly: true, secure: FRONT.startsWith('https'),
    });
    const ok = await goto(page, `/calendar?event=${id}`);
    // 드로어는 목록 로드 뒤에 열린다 — 나타날 때까지 폴링(한 번 보고 끝내면 이른 순간을 읽는다).
    let box = null;
    for (let i = 0; i < 10 && !box; i++) {
      box = await page.$('[aria-modal="true"] input[type="checkbox"]');
      if (!box) await sleep(1500);
    }
    if (!box) {
      const seen = await page.evaluate(() => ({
        drawer: !!document.querySelector('[aria-modal="true"]'),
        boxes: document.querySelectorAll('input[type="checkbox"]').length,
      }));
      return [{
        name: 'toggles:일정 "하루 종일" 토글을 찾는다',
        fail: 1,
        details: [ok ? `드로어=${seen.drawer} 체크박스=${seen.boxes} — 상세가 안 열렸거나 마크업이 바뀌었다`
                     : `/calendar?event=${id} 에 도달 못함 (현재 ${page.url()})`],
      }];
    }
    const hits = await clickAndWatch(page, box, '/api/calendar/by-business/', 'all_day');
    return [{
      name: 'toggles:일정 "하루 종일" 토글이 저장을 보낸다',
      fail: hits.length > 0 ? 0 : 1,
      details: hits.length > 0 ? [`보낸 필드: ${hits[0].keys.join(',')}`]
                               : ['클릭했으나 all_day 를 담은 저장 요청 0건'],
    }];
  } catch (e) {
    return [{ name: 'toggles:일정 "하루 종일" 토글', fail: 1, details: [`검사 자체가 실패: ${e.message}`] }];
  } finally {
    if (browser) await browser.close().catch(() => null);
    // 시험 일정은 반드시 지운다 — 게이트가 사용자 달력에 쓰레기를 남기지 않는다.
    if (ev) {
      await fetch(`${BACKEND}/api/calendar/by-business/${MEMBER_BIZ}/${ev.id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${ev.token}` },
      }).catch(() => null);
    }
  }
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

    // 카드 제목 → 그 스위치가 저장해야 할 필드. 이름과 필드가 어긋나면 그 자체가 결함이다.
    const FIELD_BY_LABEL = {
      '점검 모드': 'maintenance_mode',
      '게스트 링크': 'guest_links_enabled',
      '공지 배너': 'announcement_dismissible',
    };
    const covered = new Set();

    for (let i = 0; i < switches.length; i++) {
      const label = labels[i] || `스위치 ${i + 1}`;
      const key = FIELD_BY_LABEL[label] || null;
      const hits = await clickAndWatch(page, switches[i], '/api/admin/platform-settings', key);
      // ★ 매 항목 직후 원복 — 특히 점검 모드는 켜지면 dev 전체가 503 이 된다.
      await restore(auth.token, snapshot);
      if (key) covered.add(key);
      results.push({
        name: `toggles:${label} 스위치가 저장을 보낸다`,
        fail: hits.length > 0 ? 0 : 1,
        details: hits.length > 0 ? [] : [
          key ? `클릭했으나 ${key} 를 담은 저장 요청 0건 — 화면 문구만 바뀌고 서버엔 안 갔다`
              : '클릭했으나 저장 요청 0건 — 화면 문구만 바뀌고 서버엔 안 갔다',
        ],
      });
      await sleep(400);
    }

    // 아는 스위치가 화면에서 사라지면 그것도 결함이다 — 조용히 줄어드는 것을 통과로 두지 않는다.
    for (const [label, key] of Object.entries(FIELD_BY_LABEL)) {
      if (!covered.has(key)) {
        results.push({
          name: `toggles:${label} 스위치가 화면에 있다`,
          fail: 1,
          details: [`[role="switch"] 중 "${label}" 카드의 것을 못 찾았다 — 사라졌거나 카드 제목이 바뀌었다`],
        });
      }
    }

    // 심각도 버튼 그룹 — 스위치가 **아닌** 버튼만. 옛 셀렉터는 `button` 전부를 잡아
    //   마지막 원소가 옆 Field 의 "사용자 닫기 가능" 스위치였고, 그것을 눌러 놓고
    //   "심각도 ✅" 를 냈다. 지금은 role=switch 를 빼고, 눌린 결과가 announcement_severity 를
    //   담았는지까지 본다.
    const SEV_LABEL = { info: '안내', warn: '주의', critical: '긴급' };
    const cur = SEV_LABEL[snapshot.announcement_severity] || '안내';
    const sevBtns = await page.$$('#announcement ~ * button:not([role="switch"])');
    const texts = await Promise.all(sevBtns.map((b) => b.evaluate((el) => (el.textContent || '').trim())));
    // 지금 선택된 것을 다시 누르면 값이 안 바뀌어 저장이 안 날 수도 있다 — 다른 것을 고른다.
    const idx = texts.findIndex((t) => Object.values(SEV_LABEL).includes(t) && t !== cur);
    if (idx >= 0) {
      const hits = await clickAndWatch(page, sevBtns[idx], '/api/admin/platform-settings', 'announcement_severity');
      await restore(auth.token, snapshot);
      results.push({
        name: `toggles:공지 심각도 버튼("${texts[idx]}")이 저장을 보낸다`,
        fail: hits.length > 0 ? 0 : 1,
        details: hits.length > 0 ? [`보낸 필드: ${hits[0].keys.join(',')}`]
                                 : ['클릭했으나 announcement_severity 를 담은 저장 요청 0건'],
      });
    } else {
      // ★ 못 찾은 것은 통과가 아니다. 마크업이 바뀌면 이 검사가 조용히 사라진다.
      results.push({
        name: 'toggles:공지 심각도 버튼을 찾는다',
        fail: 1,
        details: [`심각도 버튼(안내/주의/긴급) 중 현재값("${cur}") 아닌 것을 못 찾음 — 찾은 버튼: ${JSON.stringify(texts)}`],
      });
    }

  } finally {
    // 브라우저가 어떻게 끝났든 설정은 반드시 원래대로. 점검 모드가 켜진 채 남으면 dev 가 죽는다.
    await restore(auth.token, snapshot);
    await browser.close();
  }
  results.push(...await checkAllDayToggle());
  return results;
}

module.exports = { name: 'toggles', run };
