// scripts/e2e/canary-toggles.js — 자동저장 **토글이 눌러서 실제로 저장되는가** 카나리.
//
//   왜 존재하는가: `AutoSaveField` 는 자식의 `onChange` 만 감싸 저장을 걸었다. 그런데 토글은
//   전부 `<button onClick>`(또는 안쪽에 input 을 감싼 label)이라 **자식에 onChange 가 없다.**
//   그래서 클릭하면 화면 문구만 바뀌고 서버로는 아무것도 가지 않았다 — 운영 **점검 모드**를
//   포함해 5곳이 그 상태로 살아 있었다. 운영자는 "껐다" 고 믿는다.
//
//   존재 검사·tsc·가드 3축·API 직접 호출 테스트는 전부 통과한다. API 를 부르는 건 테스트고,
//   화면이 그 API 를 안 부르는 것이 결함이기 때문이다(memory feedback_backend_done_ui_missing).
//   **눌러서 네트워크가 나가는지 봐야만 드러난다.**
//
//   판정을 세 번 조였다 — 매번 앞 단계가 거짓 PASS 를 낸다는 것이 실증돼서다:
//     ① "PUT 이 났는가"       → 엉뚱한 컨트롤을 눌러도 통과했다(옆 스위치를 누르고 "심각도 ✅")
//     ② "그 필드를 담았는가"   → 무엇을 눌렀는지는 잡히나, 옛 값을 보내는 회귀는 통과한다
//     ③ "기대한 값을 담았는가" → 지금. 스냅샷의 반대값이 가야 통과.
//   그리고 **응답까지 기다린 뒤** 원복한다. 요청이 보이자마자 원복하면 서버에서 경합이 나
//   화면의 PUT 이 나중에 처리돼 **dev 가 점검 모드(전 사용자 503)로 남은 채 EXIT 0** 이 된다
//   (실측: 5회 중 3회 뒤집힌 채 남았다). 끝에서 설정을 스냅샷과 대조해 오염도 잡는다.
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env', quiet: true });
const puppeteer = require('/opt/planq/dev-backend/node_modules/puppeteer');

const BACKEND = process.env.CANARY_BACKEND || 'http://localhost:3003';
const FRONT = process.env.CANARY_FRONT || 'https://dev.planq.kr';
// 플랫폼 설정은 platform_admin 만 연다 — 다른 카나리의 health-check 계정으로는 403 이라
//   화면 자체가 안 뜬다(그러면 "토글 없음 = 통과" 라는 거짓 PASS 가 된다).
const ADMIN = { email: 'admin@test.planq.kr', password: 'Test1234!' };
// 캘린더는 워크스페이스 자원이라 멤버 계정으로 본다 — platform_admin 은 어느 워크스페이스에도
//   속해 있지 않아 `/calendar` 가 비어 있다.
const MEMBER = { email: 'health-check@planq.kr', password: 'HealthCheck2026!' };
const MEMBER_BIZ = 5;

const SETTINGS_URL = '/api/admin/platform-settings';
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
  await fetch(`${BACKEND}${SETTINGS_URL}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }).catch(() => null);
}

async function getSettings(token) {
  const r = await fetch(`${BACKEND}${SETTINGS_URL}`, { headers: { Authorization: `Bearer ${token}` } });
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
 * 클릭 → 그 컨트롤의 저장이 **서버에 도달해 응답이 올 때까지** 기다린다.
 *
 * `expect = { key, value }` — 본문에 그 필드가 있고 값이 기대와 같아야 통과.
 *   키만 보면 "무엇을 눌렀나" 까지만 증명되고, 닫힘 타이밍이 어긋나 **옛 값**을 보내는 회귀는
 *   그대로 통과한다. 값까지 대조해야 "누른 대로 갔다" 가 된다.
 *
 * 응답을 기다리는 이유는 호출부의 원복과 경합하지 않기 위해서다(파일 상단 주석 참조).
 */
async function clickAndSave(page, handle, urlPart, expect) {
  const pending = page.waitForResponse((res) => {
    const req = res.request();
    if (!req.url().includes(urlPart) || !['PUT', 'PATCH'].includes(req.method())) return false;
    let body = {};
    try { body = JSON.parse(req.postData() || '{}'); } catch { body = {}; }
    return !expect || (expect.key in body);
  }, { timeout: 10000 }).catch(() => null);

  await handle.click();
  const res = await pending;
  if (!res) {
    return { ok: false, reason: expect
      ? `클릭했으나 ${expect.key} 를 담은 저장이 10초 안에 안 갔다 — 화면 문구만 바뀌고 서버엔 안 갔다`
      : '클릭했으나 저장 요청 0건' };
  }
  let body = {};
  try { body = JSON.parse(res.request().postData() || '{}'); } catch { body = {}; }
  if (expect && 'value' in expect && body[expect.key] !== expect.value) {
    return { ok: false, reason: `보낸 값이 다르다 — 기대 ${JSON.stringify(expect.value)} / 실제 ${JSON.stringify(body[expect.key])}` };
  }
  if (res.status() >= 400) {
    return { ok: false, reason: `서버가 ${res.status()} 로 거절했다 (필드: ${Object.keys(body).join(',')})` };
  }
  return { ok: true, keys: Object.keys(body), status: res.status() };
}

/**
 * 5번째 토글: 일정 상세의 "하루 종일". 같은 AutoSaveField 를 쓰지만 자식이 `<label>`(안쪽 input)이라
 * 모양이 다르다 — 플랫폼 설정 4곳만 보면 이 계열이 다시 죽어도 게이트가 조용하다.
 *
 * ★ 브라우저를 따로 띄운다. 같은 컨텍스트에서 쿠키만 바꾸면 앞 세션의 localStorage(액세스 토큰·
 *   활성 워크스페이스)가 남아 화면이 엉뚱한 상태로 뜬다 — 실제로 그래서 드로어가 안 열렸다.
 */
async function checkAllDayToggle() {
  const results = [];
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
      box = await page.$('[data-testid="event-toggle-all_day"]');
      if (!box) await sleep(1500);
    }
    if (!box) {
      const seen = await page.evaluate(() => ({
        drawer: !!document.querySelector('[aria-modal="true"]'),
        boxes: document.querySelectorAll('input[type="checkbox"]').length,
      }));
      results.push({
        name: 'toggles:일정 "하루 종일" 토글을 찾는다',
        fail: 1,
        details: [ok ? `드로어=${seen.drawer} 체크박스=${seen.boxes} — 상세가 안 열렸거나 data-testid 가 사라졌다`
                     : `/calendar?event=${id} 에 도달 못함 (현재 ${page.url()})`],
      });
      return results;
    }
    // 만든 일정이 all_day:false 이므로 클릭하면 true 가 가야 한다.
    const r = await clickAndSave(page, box, '/api/calendar/by-business/', { key: 'all_day', value: true });
    results.push({
      name: 'toggles:일정 "하루 종일" 토글이 저장을 보낸다',
      fail: r.ok ? 0 : 1,
      details: r.ok ? [`보낸 필드: ${r.keys.join(',')}`] : [r.reason],
    });
  } catch (e) {
    results.push({ name: 'toggles:일정 "하루 종일" 토글', fail: 1, details: [`검사 자체가 실패: ${e.message}`] });
  } finally {
    if (browser) await browser.close().catch(() => null);
    // 시험 일정은 반드시 지운다 — 게이트가 사용자 달력에 쓰레기를 남기지 않는다.
    //   삭제 실패를 삼키면 조용히 쌓인다. 결과에 남긴다.
    if (ev) {
      let st = 0;
      try {
        const dr = await fetch(`${BACKEND}/api/calendar/by-business/${MEMBER_BIZ}/${ev.id}`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${ev.token}` },
        });
        st = dr.status;
      } catch (e) { st = -1; }
      if (st < 200 || st >= 300) {
        results.push({
          name: 'toggles:시험 일정 정리',
          fail: 1,
          details: [`시험 일정 ${ev.id} 삭제 실패 (status ${st}) — dev 캘린더에 남아 있다`],
        });
      }
    }
  }
  return results;
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
  // 이 카나리가 반드시 확인해야 하는 스위치. 화면에서 사라지면 그것도 결함이다 —
  //   조용히 줄어드는 것을 통과로 두지 않는다.
  const REQUIRED = ['maintenance_mode', 'guest_links_enabled', 'announcement_dismissible'];

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 1200 });
    await page.setCookie({
      name: 'refresh_token', value: auth.refresh,
      domain: new URL(FRONT).hostname, path: '/', httpOnly: true, secure: FRONT.startsWith('https'),
    });

    if (!await goto(page, '/admin/platform-settings')) {
      results.push({ name: 'toggles:플랫폼 설정 화면 도달', fail: 1, details: [`도달 못함 (현재 ${page.url()})`] });
      return results;
    }

    // ★ 카드 제목(한국어)이 아니라 data-testid 로 찾는다 (CLAUDE.md §17).
    //   제목으로 찾으면 로케일이 영어인 계정에서 매핑이 통째로 빗나간다.
    for (const key of REQUIRED) {
      const handle = await page.$(`[data-testid="platform-toggle-${key}"]`);
      if (!handle) {
        results.push({
          name: `toggles:${key} 스위치가 화면에 있다`,
          fail: 1,
          details: [`[data-testid="platform-toggle-${key}"] 를 못 찾았다 — 사라졌거나 이름표가 바뀌었다`],
        });
        continue;
      }
      const r = await clickAndSave(page, handle, SETTINGS_URL, { key, value: !snapshot[key] });
      await restore(auth.token, snapshot);   // 응답을 기다린 뒤라 경합하지 않는다
      results.push({
        name: `toggles:${key} 스위치가 저장을 보낸다`,
        fail: r.ok ? 0 : 1,
        details: r.ok ? [] : [r.reason],
      });
      await sleep(400);
    }

    // 심각도 버튼 그룹 — 지금 값이 아닌 것을 누른다(같은 값을 다시 누르면 저장이 안 날 수 있다).
    const nextSev = ['info', 'warn', 'critical'].find((s) => s !== snapshot.announcement_severity);
    const sevBtn = await page.$(`[data-testid="platform-severity-${nextSev}"]`);
    if (!sevBtn) {
      // ★ 못 찾은 것은 통과가 아니다. 마크업이 바뀌면 이 검사가 조용히 사라진다.
      results.push({
        name: 'toggles:공지 심각도 버튼을 찾는다',
        fail: 1,
        details: [`[data-testid="platform-severity-${nextSev}"] 를 못 찾았다`],
      });
    } else {
      const r = await clickAndSave(page, sevBtn, SETTINGS_URL, { key: 'announcement_severity', value: nextSev });
      await restore(auth.token, snapshot);
      results.push({
        name: `toggles:공지 심각도(${nextSev}) 버튼이 저장을 보낸다`,
        fail: r.ok ? 0 : 1,
        details: r.ok ? [`보낸 필드: ${r.keys.join(',')}`] : [r.reason],
      });
    }
  } finally {
    // 브라우저가 어떻게 끝났든 설정은 반드시 원래대로. 점검 모드가 켜진 채 남으면 dev 가 죽는다.
    await restore(auth.token, snapshot);
    await browser.close();
  }

  results.push(...await checkAllDayToggle());

  // ★ 끝 상태 대조 — 원복이 조용히 실패했거나 경합에 졌으면 여기서 드러난다.
  //   "검사는 통과했는데 dev 가 점검 모드로 남는" 결말을 통과로 두지 않는다.
  const after = await getSettings(auth.token);
  const drift = Object.keys(snapshot).filter((k) => {
    const now = k === 'announcement_severity' ? (after[k] || 'info')
      : k === 'announcement_dismissible' ? after[k] !== false
      : after[k] === true;
    return now !== snapshot[k];
  });
  results.push({
    name: 'toggles:검사 후 설정이 원래대로 돌아왔다',
    fail: drift.length ? 1 : 0,
    details: drift.length
      ? [`원복 실패 — dev 상태 오염: ${drift.map((k) => `${k} ${JSON.stringify(snapshot[k])}→${JSON.stringify(after[k])}`).join(' · ')}`]
      : [],
  });

  return results;
}

module.exports = { name: 'toggles', run };
