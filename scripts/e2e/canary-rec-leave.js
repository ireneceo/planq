// scripts/e2e/canary-rec-leave.js — Q note 녹음 중 이탈 보호 (2026-11-19 · Fable 설계 DESIGN-READY · docs/QNOTE_RECORDING_LEAVE_GUARD_DESIGN.md)
//
//   Irene: «노트에서 녹음이나 녹화할 때 갑자기 나가게 되는 일이 생기곤 해. 나가지 못하게 하고 안내하고 나서 원하면 나가게 …»
//
//   가짜 마이크(--use-fake-device-for-media-stream)로 **실제 녹음**을 켜고 녹음을 끊던 길을 하나씩 밟는다. 회당 STT 몇 분 과금.
//   «살아 있다» = ① 녹음 표시 줄(정지 버튼) 이 DOM 에 있음 ② body.dataset.recordingActive==='1'
//                ③ **행동 15초 뒤** 서버 recorder_lock.active — 심박은 마운트된 화면만 보내고 12초면 풀린다(트리 생존의 서버 쪽 증거)
//   탭 모드 1440: T1 메뉴 이동 → 새 탭 · T2 브라우저 뒤로 가기 → 새 탭 · T4 탭 여러 개(LRU) · T3 탭 X → 확인창(취소=생존)
//                 T5 새로고침 → beforeunload 창(dismiss=생존) · T6 로그아웃 → 확인창(취소=로그인·생존)
//                 양성 대조군 P1: 탭 X → [녹음 멈추고 탭 닫기] → ③ 이 15초 안에 거짓으로 뒤집힌다(판정이 죽음을 잡는다)
//                 음성 대조군 N1: 멈춘(paused) 뒤 메뉴 이동 → 확인창 0 · 같은 탭이 이동(과잉 차단 없음)
//   미러 모드 390: M1 머리줄 버튼 이동 → 확인창(취소=생존·주소 그대로) · M2 뒤로 가기 → 확인창(취소=생존·주소 그대로)
//                 P2: M1 → [녹음 멈추고 이동] → 이동됨 + ③ 거짓
require('./lib/mem-slot');
const puppeteer = require('/opt/planq/dev-backend/node_modules/puppeteer');
require('./lib/gate-header');
const { login, sleep } = require('./lib/browser');

const BASE = process.env.E2E_BASE || 'https://dev.planq.kr';
const ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'];
const LOCK_WAIT = 15000;

// 시험이 서버에 직접 묻는 토큰 — 앱의 refresh 쿠키를 돌리지 않게 따로 로그인한다(omit: 쿠키를 받지 않음)
async function token(page) {
  return page.evaluate(async (c) => {
    const r = await fetch('/api/auth/login', { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c) }).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    return (j && j.data && j.data.token) || null;
  }, { email: process.env.E2E_EMAIL || 'health-check@planq.kr', password: process.env.E2E_PASSWORD || 'HealthCheck2026!' });
}
async function lockActive(page, tok, sid) {
  return page.evaluate(async (t, id) => {
    const r = await fetch(`/qnote/api/sessions/${id}`, { headers: { Authorization: `Bearer ${t}` } });
    const j = await r.json().catch(() => null);
    const d = (j && (j.data || j)) || {};
    return !!(d.recorder_lock && d.recorder_lock.active);
  }, tok, sid);
}
async function local(page) {
  return page.evaluate(() => ({
    flag: document.body.dataset.recordingActive === '1',
    dom: !!document.querySelector('[aria-label="녹음 중"], [aria-label="Recording"]') || [...document.querySelectorAll('button')].some((b) => /^(중지|Pause)$/.test((b.getAttribute('aria-label') || '').trim())),
    path: location.pathname + location.search,
    dialog: (() => { const d = [...document.querySelectorAll('[aria-modal="true"]')].find((e) => /녹음이 진행 중|Recording in progress/.test(e.innerText || '')); return d ? (d.innerText || '').replace(/\s+/g, ' ').slice(0, 160) : null; })(),
    tabs: [...document.querySelectorAll('[data-testid^="tabstrip-tab-"]')].map((e) => ({ id: e.dataset.testid.slice('tabstrip-tab-'.length), sel: e.getAttribute('aria-selected') === 'true', rec: !!e.querySelector('[aria-label="녹음 중"], [aria-label="Recording"]') })),
    diverted: !!document.querySelector('[data-testid="recording-diverted"]'),
  }));
}
async function clickDialogBtn(page, re) {
  return page.evaluate((src) => {
    const rx = new RegExp(src);
    const d = [...document.querySelectorAll('[aria-modal="true"]')].find((e) => /녹음이 진행 중|Recording in progress/.test(e.innerText || ''));
    const b = d && [...d.querySelectorAll('button')].find((x) => rx.test((x.innerText || '').trim()));
    if (!b) return false; b.click(); return true;
  }, re.source);
}
async function clickSidebar(page, href) {
  return page.evaluate((h) => {
    const a = [...document.querySelectorAll(`a[href="${h}"]`)].find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    if (!a) return false; a.click(); return true;
  }, href);
}
async function startRec(page, sid) {
  await page.waitForSelector(`[data-qnote-session="${sid}"]`, { timeout: 20000 }).catch(() => null);
  const ok = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /^(녹음 시작|녹음 이어하기|Start recording|Resume recording)$/.test((x.getAttribute('aria-label') || '').trim()) && x.getBoundingClientRect().width > 0 && !x.disabled);
    if (!b) return false; b.click(); return true;
  });
  if (!ok) return false;
  for (let i = 0; i < 30; i++) { await sleep(500); if ((await local(page)).flag) return true; }
  return false;
}

async function run() {
  const results = [];
  const push = (name, ok, details = []) => results.push({ name: `recleave:${name}`, fail: ok ? 0 : 1, fatal: 0, details: ok ? [] : details });
  const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 60000, args: ARGS });
  let sid = null; let tok = null; let page = null;
  const seenDialogs = [];
  try {
    const ctx = browser.defaultBrowserContext();
    await ctx.overridePermissions(BASE, ['microphone']);
    page = await browser.newPage();
    // 브라우저 확인창(beforeunload)이 뜨면 기본은 «머무르기» — 안 받으면 evaluate 가 멈춘다
    page.on('dialog', async (d) => { seenDialogs.push(d.type()); await d.dismiss().catch(() => null); });
    await page.setViewport({ width: 1440, height: 900 });
    page.setDefaultTimeout(30000);
    await login(page);
    tok = await token(page);
    const me = await page.evaluate(async (t) => (await (await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${t}` } })).json()).data, tok);
    sid = await page.evaluate(async (t, biz) => {
      const r = await fetch('/qnote/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
        body: JSON.stringify({ business_id: biz, title: '[확인용] 녹음 이탈 보호', capture_mode: 'microphone', meeting_languages: ['ko'] }) });
      const j = await r.json(); return (j.data || j).id;
    }, tok, Number(me.business_id));
    if (!sid) { push('setup', false, ['세션 생성 실패']); return results; }

    // ── 탭 모드 ──
    await page.goto(`${BASE}/tasks`, { waitUntil: 'domcontentloaded' });
    await sleep(4000);
    const tabMode = !!(await page.$('[data-testid="tabstrip"]'));
    push('탭 모드 부팅(1440)', tabMode, ['탭 줄 없음 — 미러 모드로 떴다']);
    await clickSidebar(page, '/notes');
    await sleep(2500);
    await page.evaluate((id) => document.querySelector(`[data-qnote-session="${id}"]`)?.click(), sid);
    await sleep(2500);
    const started = await startRec(page, sid);
    push('녹음 시작(가짜 마이크)', started, [JSON.stringify(await local(page))]);
    if (!started) return results;
    const recTab = (await local(page)).tabs.find((t) => t.sel)?.id;

    const aliveAfter = async (label, extra) => {
      // 15초 동안 3초마다 잠금을 본다 — 판정은 마지막 값(심박이 이어지는가), 사이 값은 진단용으로 남긴다
      const samples = [];
      for (let i = 0; i < 5; i++) { await sleep(LOCK_WAIT / 5); samples.push(await lockActive(page, tok, sid) ? 1 : 0); }
      const l = await local(page);
      const lk = samples[samples.length - 1] === 1;
      if (samples.includes(0)) console.log(`  [recleave] ${label} 잠금 표본 ${samples.join('')}`);
      const ok = l.flag && lk && (!extra || extra(l));
      push(label, ok, [`flag=${l.flag} lock=${lk} path=${l.path} tabs=${JSON.stringify(l.tabs)} dialog=${l.dialog}`]);
      return l;
    };
    const backToRec = async () => { await page.click(`[data-testid="tabstrip-tab-${recTab}"]`).catch(() => null); await sleep(1200); };

    // T1 메뉴 이동 → 새 탭, 녹음 탭 생존 + 빨간 점 + 안내 줄
    await clickSidebar(page, '/docs');
    await sleep(1500);
    const t1 = await local(page);
    push('T1 메뉴 이동 = 새 탭으로(확인창 0 · 안내 줄 · 빨간 점)', !t1.dialog && t1.path.startsWith('/docs') && t1.diverted && t1.tabs.some((t) => t.id === recTab && !t.sel && t.rec),
      [JSON.stringify(t1)]);
    await aliveAfter('T1 15초 뒤 녹음 생존');

    // T2 브라우저 뒤로 가기(녹음 탭에서) — 탭 안 앞 화면이면 새 탭으로 돌리고, 사이트 밖이면 beforeunload 로 묻는다(머무르기)
    await backToRec();
    await page.evaluate(() => { setTimeout(() => history.back(), 0); });
    await sleep(2500);
    await aliveAfter('T2 뒤로 가기 뒤 녹음 생존', (l) => l.tabs.some((t) => t.id === recTab));

    // T4 탭 여러 개 — 녹음 탭을 가장 오래된 비활성 탭으로 만든 뒤에도 정지되지 않는다(LRU)
    const menus = ['/talk', '/calendar', '/files', '/mail', '/projects', '/dashboard'];
    for (const m of menus) { await backToRec(); await clickSidebar(page, m); await sleep(1200); }
    const others = (await local(page)).tabs.filter((t) => t.id !== recTab).map((t) => t.id);
    for (const id of others) { await page.click(`[data-testid="tabstrip-tab-${id}"]`).catch(() => null); await sleep(700); }
    const t4 = await aliveAfter('T4 탭 여러 개·녹음 탭이 가장 오래됨 → 생존', (l) => l.tabs.length >= 6);
    push('T4 탭 수', t4.tabs.length >= 6, [`tabs=${t4.tabs.length}`]);

    // T3 탭 X → 확인창 → 취소 = 생존
    await page.click(`[data-testid="tabstrip-close-${recTab}"]`).catch(() => null);
    await sleep(1000);
    const t3 = await local(page);
    push('T3 녹음 탭 X = 확인창', !!t3.dialog, [JSON.stringify(t3)]);
    await clickDialogBtn(page, /^(녹음 계속하기|Keep recording)$/);
    await aliveAfter('T3 취소 → 탭·녹음 생존', (l) => l.tabs.some((t) => t.id === recTab) && !l.dialog);

    // T5 새로고침 → beforeunload 창 → dismiss = 생존
    const nBefore = seenDialogs.length;
    await page.reload({ timeout: 4000 }).catch(() => null);
    await sleep(1500);
    const dlgType = seenDialogs[nBefore] || null;
    push('T5 새로고침 = 브라우저 확인창(beforeunload)', dlgType === 'beforeunload', [`dialog=${dlgType}`]);
    await aliveAfter('T5 머무르기 → 녹음 생존');

    // T6 로그아웃 → 확인창 → 취소 = 로그인·녹음 생존
    await page.click('[data-testid="user-menu-open"]').catch(() => null);
    await sleep(600);
    await page.click('[data-testid="user-menu-logout"]').catch(() => null);
    await sleep(1200);
    const t6 = await local(page);
    push('T6 로그아웃 = 확인창', !!t6.dialog && /로그아웃|log out/i.test(t6.dialog), [JSON.stringify(t6)]);
    await clickDialogBtn(page, /^(녹음 계속하기|Keep recording)$/);
    await aliveAfter('T6 취소 → 로그인 유지·녹음 생존', (l) => !l.path.startsWith('/login'));

    // P1 양성 대조군 — [녹음 멈추고 탭 닫기] → 판정이 죽음을 잡는다
    await page.click(`[data-testid="tabstrip-close-${recTab}"]`).catch(() => null);
    await sleep(800);
    await clickDialogBtn(page, /^(녹음 멈추고 탭 닫기|Pause and close tab)$/);
    await sleep(LOCK_WAIT);
    const p1 = await local(page);
    const p1lock = await lockActive(page, tok, sid);
    push('P1 대조군: 멈추고 닫기 → 탭 없음·flag 꺼짐·잠금 풀림', !p1.tabs.some((t) => t.id === recTab) && !p1.flag && !p1lock, [`lock=${p1lock} ${JSON.stringify(p1)}`]);

    // N1 음성 대조군 — 녹음이 없으면 메뉴 이동은 그 탭에서 그대로(확인창 0)
    const before = (await local(page)).tabs.length;
    await clickSidebar(page, '/tasks');
    await sleep(1500);
    const n1 = await local(page);
    push('N1 대조군: 녹음 없음 → 확인창 0 · 탭 수 그대로', !n1.dialog && n1.tabs.length === before && n1.path.startsWith('/tasks'), [`before=${before} ${JSON.stringify(n1)}`]);
    await page.close();

    // ── 미러 모드(폰 390) ──
    const m = await browser.newPage();
    m.on('dialog', async (d) => { seenDialogs.push(d.type()); await d.dismiss().catch(() => null); });
    await m.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await m.setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36');
    m.setDefaultTimeout(30000);
    page = m;
    await m.goto(`${BASE}/notes/${sid}`, { waitUntil: 'domcontentloaded' });
    await sleep(4000);
    const mTab = !!(await m.$('[data-testid="tabstrip"]'));
    push('미러 모드 부팅(390)', !mTab, ['탭 줄이 있다 — 탭 모드로 떴다']);
    const mStarted = await startRec(m, sid);
    push('미러 녹음 시작', mStarted, [JSON.stringify(await local(m))]);
    if (mStarted) {
      const p0 = (await local(m)).path;
      // M1 머리줄 버튼(Q talk) → 확인창 → 취소
      await m.click('[data-testid="mobile-header-talk"]').catch(() => null);
      await sleep(1000);
      const m1 = await local(m);
      push('M1 미러 메뉴 이동 = 확인창', !!m1.dialog && m1.path === p0, [JSON.stringify(m1)]);
      await clickDialogBtn(m, /^(녹음 계속하기|Keep recording)$/);
      await aliveAfter('M1 취소 → 주소 그대로·녹음 생존', (l) => l.path === p0);
      // M2 뒤로 가기 → 확인창 → 취소
      await m.evaluate(() => { setTimeout(() => history.back(), 0); });
      await sleep(1200);
      const m2 = await local(m);
      push('M2 미러 뒤로 가기 = 확인창·주소 그대로', !!m2.dialog && m2.path === p0, [JSON.stringify(m2)]);
      await clickDialogBtn(m, /^(녹음 계속하기|Keep recording)$/);
      await aliveAfter('M2 취소 → 녹음 생존', (l) => l.path === p0);
      // P2 양성 대조군 — [녹음 멈추고 이동] → 실제로 이동 + 잠금 풀림
      await m.click('[data-testid="mobile-header-talk"]').catch(() => null);
      await sleep(900);
      await clickDialogBtn(m, /^(녹음 멈추고 이동|Pause and leave)$/);
      await sleep(LOCK_WAIT);
      const p2 = await local(m);
      const p2lock = await lockActive(m, tok, sid);
      push('P2 대조군: 멈추고 이동 → /talk·잠금 풀림', p2.path.startsWith('/talk') && !p2.flag && !p2lock, [`lock=${p2lock} ${JSON.stringify(p2)}`]);
    }
  } catch (e) {
    results.push({ name: 'recleave:error', fail: 1, fatal: 1, details: [String(e && e.stack || e).slice(0, 400)] });
  } finally {
    // 시험 노트는 지운다(녹취는 가짜 소리라 쓸모없다)
    if (sid && tok && page && !page.isClosed()) {
      await page.evaluate(async (t, id) => { await fetch(`/qnote/api/sessions/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${t}` } }).catch(() => null); }, tok, sid).catch(() => null);
    }
    await browser.close().catch(() => null);
  }
  return results;
}

module.exports = { name: 'recleave', run };

if (require.main === module) {
  run().then((r) => {
    for (const x of r) console.log(`${x.fail ? '❌' : '✅'} ${x.name}${x.details && x.details.length ? '\n     ' + x.details.join('\n     ') : ''}`);
    const f = r.filter((x) => x.fail).length;
    console.log(`\n[recleave] ${r.length - f}/${r.length} 통과`);
    process.exit(f ? 1 : 0);
  });
}
