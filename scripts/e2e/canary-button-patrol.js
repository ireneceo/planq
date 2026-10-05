// canary-button-patrol — «모든 버튼 눌러보기» 순찰 (2026-10-05)
//
//   왜: 운영 크래시는 대개 **누군가 어떤 버튼을 누른 순간** 난다(2026-10-05 Q Talk [더보기] —
//   첫 클릭에 화면 전체가 죽었는데 기능별 카나리는 그 버튼을 한 번도 누르지 않았다).
//   화면을 «여는» 크롤은 있었지만 «누르는» 순찰은 없었다.
//
// 무엇을: 워크스페이스 화면 × 환경(폰·태블릿·PC 웹 + 폰 앱·아이패드 앱 흉내)마다 보이는 버튼을 하나씩 누르고
//   ① pageerror ② 오류 화면(ErrorBoundary) ③ 빈 화면 ④ 가로 넘침 ⑤ 앱에서 우리 주소가 앱 밖(사파리)으로 나감
//   ⑥ 눌러지지 않는 버튼(다른 요소가 덮음 — 경고) 을 센다.
//
// 안전: **쓰기 요청은 전부 막는다** — /api/ 의 POST·PUT·PATCH·DELETE 는 서버에 가지 않고 409 로 돌아온다
//   (로그인·토큰 갱신·크래시 보고만 통과). 그래서 순찰이 데이터를 바꾸거나 메일·푸시를 보낼 수 없다.
//   거기에 더해 위험한 이름의 버튼(삭제·발송·결제·로그아웃·토글 …)은 누르지 않는다(두 겹).
//
// 앱 흉내: window.webkit 브리지 + Capacitor nativePromise 스텁(아이패드 앱은 Mac UA) — 2026-10-04 ipadapp 방식.
//
// 결과: run.js 계약(results 배열) + 사람이 읽는 보고서 /opt/planq/logs/patrol/patrol-YYYY-MM-DD.log
//   ENV: PATROL_ENVS=phone-web,desktop-web (일부만) · PATROL_ROUTES=/tasks,/talk · PATROL_MAX=15(화면당 버튼 수)
const fs = require('fs');
const path = require('path');
const puppeteer = require('/opt/planq/dev-backend/node_modules/puppeteer');
const b = require('./lib/browser');

const ROUTES_ALL = [
  '/dashboard', '/inbox', '/tasks', '/talk', '/mail', '/calendar', '/notes', '/docs', '/files', '/info',
  '/projects', '/sale', '/bills', '/attendance', '/signatures/received', '/notifications', '/whats-new',
  '/business/clients', '/business/members', '/business/org', '/business/settings', '/business/settings/notifications',
  '/settings', '/profile', '/profile/integrations', '/personal-vault', '/me/feedback', '/me/work-settings',
];
const IPAD_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const PHONE_APP_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const ENVS_ALL = [
  { n: 'phone-web', vp: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  { n: 'tablet-web', vp: { width: 820, height: 1180, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  { n: 'desktop-web', vp: { width: 1440, height: 900 } },
  { n: 'phone-app', vp: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, ua: PHONE_APP_UA, native: true },
  { n: 'ipad-app', vp: { width: 1180, height: 820, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, ua: IPAD_UA, native: true },
];

// 누르지 않는 버튼 — 이름(글자·aria-label·title)으로 거른다. 쓰기는 이미 막혀 있지만 두 겹으로.
const DANGER = /삭제|제거|지우기|휴지통|비우기|탈퇴|해지|해제|로그아웃|발송|보내기|전송|재발송|초대|결제|구매|업그레이드|환불|승인|반려|완료 처리|최종 완료|확인완료|모두 읽음|모두 확인|일괄|녹음|마이크|카메라|화면 공유|다운로드|내려받기|인쇄|delete|remove|trash|empty|logout|log out|sign out|send|invite|pay|purchase|upgrade|refund|approve|reject|archive|download|print|record/i;

const BASE_HOST = new URL(b.BASE).host;
const today = () => new Date().toISOString().slice(0, 10);

async function setupPage(ctx, env) {
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  if (env.ua) await page.setUserAgent(env.ua);
  await page.setViewport(env.vp);
  if (env.native) {
    await page.evaluateOnNewDocument(() => {
      window.__nativeCalls = [];
      const rec = (pl, me, op) => { try { window.__nativeCalls.push({ p: pl, m: me, url: op && op.url }); } catch {} return Promise.resolve({}); };
      window.Capacitor = { nativePromise: rec, nativeCallback: (pl, me, op) => { rec(pl, me, op); return String(Math.random()); }, PluginHeaders: [{ name: 'Browser', methods: [{ name: 'open', rtype: 'promise' }, { name: 'close', rtype: 'promise' }, { name: 'addListener', rtype: 'callback' }, { name: 'removeAllListeners', rtype: 'promise' }] }] };
      window.webkit = { messageHandlers: { bridge: { postMessage(m) {
        try { window.__nativeCalls.push({ p: m.pluginId, m: m.methodName, url: m.options && m.options.url }); } catch {}
        setTimeout(() => { try { window.Capacitor.fromNative({ callbackId: m.callbackId, pluginId: m.pluginId, methodName: m.methodName, success: true, data: {} }); } catch {} }, 0);
      } } } };
    });
  }
  // ★ 쓰기 차단 — 순찰은 아무것도 바꾸지 않는다.
  await page.setRequestInterception(true);
  page.__blocked = 0;
  page.__reqs = 0;
  page.on('request', (r) => {
    if (/\/api\//.test(r.url())) page.__reqs += 1;
    const u = r.url();
    const m = r.method();
    if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS' && /\/api\//.test(u)
      && !/\/api\/auth\/(login|refresh|logout-all-check)|\/api\/client-errors/.test(u)) {
      page.__blocked += 1;
      return r.respond({ status: 409, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'patrol_write_blocked' }) }).catch(() => null);
    }
    // 앱 흉내에서 외부(구글 등) 리소스는 그대로 둔다
    r.continue().catch(() => null);
  });
  return page;
}

// 화면 상태 — 오류 화면·빈 화면·가로 넘침
const SCREEN_STATE = () => {
  const boundary = [...document.querySelectorAll('[role="alert"]')].some((a) => a.querySelectorAll('button').length >= 2 && /다시 시도|Try again|Retry/.test(a.innerText));
  const main = document.querySelector('main') || document.body;
  const text = (main.innerText || '').replace(/\s+/g, '').length;
  const overflow = document.documentElement.scrollWidth - window.innerWidth;
  return { boundary, text, overflow };
};

// 화면을 크게 덮는 고정 요소 수 — 누른 뒤 늘었고 Esc 로도 안 줄면 (폰 메뉴 덮개 등) 화면을 다시 연다
const OVERLAY_SIG = () => [...document.querySelectorAll('body *')].filter((e) => {
  const cs = getComputedStyle(e);
  if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
  const r = e.getBoundingClientRect();
  return r.width * r.height >= innerWidth * innerHeight * 0.4;
}).length;

// 누를 후보에 번호를 매긴다 — 보이고(불투명도 사슬·크기) 위험하지 않은 버튼. 내비게이션·탭바는 뺀다(화면 이동은 경로 순회가 맡는다).
const MARK = (maxN, dangerSrc, doneNames = [], scope = 'content') => {
  const danger = new RegExp(dangerSrc, 'i');
  const done = new Set(doneNames);
  // 범위 — 'content': 화면 본문(data-pq-content, 보이는 탭 것만) · 'chrome': 그 밖(머리줄·탭바 — 환경마다 한 번)
  const roots = [...document.querySelectorAll('[data-pq-content]')].filter((r) => !r.closest('[aria-hidden="true"]'));
  const inContent = (el) => roots.some((r) => r.contains(el));
  document.querySelectorAll('[data-patrol-idx]').forEach((e) => e.removeAttribute('data-patrol-idx'));
  const vis = (el) => {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.opacity === '0' || cs.visibility === 'hidden' || cs.display === 'none') return false;
    }
    const r = el.getBoundingClientRect();
    return r.width >= 4 && r.height >= 4;
  };
  const nameOf = (el) => ((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '') + ' ' + (el.innerText || '')).replace(/\s+/g, ' ').trim().slice(0, 60);
  const all = [...document.querySelectorAll('button, [role="button"], [role="tab"], [role="menuitem"]')];
  const out = [];
  const seen = new Set();
  for (const el of all) {
    if (out.length >= maxN) break;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
    if (scope === 'content' ? !inContent(el) : (inContent(el) || el.closest('[aria-hidden="true"]'))) continue;
    if (el.closest('nav, aside[data-sidebar], [data-testid^="nav-"], [data-testid="tab-bar"], [data-tabbar], [role="tablist"][data-chrome]')) continue;
    if (el.getAttribute('role') === 'switch' || el.closest('[role="switch"]')) continue;
    // ★ type 이 없는 <button> 은 기본이 submit 이다 — type 만 보면 앱 버튼 거의 전부가 빠진다(양성 대조군이 잡았다).
    //   실제로 폼을 제출하는 것만 뺀다.
    if (el.type === 'submit' && el.form) continue;
    if (!vis(el)) continue;
    const name = nameOf(el);
    if (!name || danger.test(name)) continue;
    const key = name + '|' + el.tagName;
    if (seen.has(key)) continue;   // 같은 이름 버튼(행마다 반복)은 하나만
    if (done.has(name)) continue;  // 앞 화면에서 이미 누른 것(머리줄·공용 크롬) — 화면마다 다시 누르지 않는다
    seen.add(key);
    el.setAttribute('data-patrol-idx', String(out.length));
    out.push(name);
  }
  return out;
};

async function patrolEnv(browser, env, routes, maxN, report) {
  const ctx = await browser.createBrowserContext();
  const page = await setupPage(ctx, env);
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error' && /\[ErrorBoundary\]/.test(m.text())) errs.push('boundary: ' + m.text().slice(0, 180)); });
  let newTargets = 0;
  ctx.on('targetcreated', (t) => { if (t.type() === 'page' && t !== page.target()) newTargets += 1; });
  const findings = [];   // { route, button, kind, detail, severity }
  const doneSet = new Set();   // 이 환경에서 이미 누른 버튼 이름
  let clicked = 0;
  try {
    await b.login(page);
    await b.goto(page, '/dashboard');
    await b.dismissBlockers(page).catch(() => null);
    // 머리줄·탭바(공용 크롬)는 환경마다 한 번만 — 화면마다 누르면 예산을 다 먹는다
    const units = [{ route: '/dashboard', scope: 'chrome' }, ...routes.map((r) => ({ route: r, scope: 'content' }))];
    for (const { route, scope } of units) {
     // 한 화면이 멈추면(브라우저 응답 없음) 그 화면만 기록하고 다음 화면으로 — 환경 전체를 끝내지 않는다
     try {
      const e0 = errs.length;
      await b.goto(page, route);
      await b.dismissBlockers(page).catch(() => null);
      await b.sleep(800);
      const st = await page.evaluate(SCREEN_STATE);
      if (st.boundary) findings.push({ route, button: '(열기)', kind: '오류 화면', detail: errs.slice(e0).join(' / ').slice(0, 200), severity: 'FAIL' });
      if (st.text < 20) findings.push({ route, button: '(열기)', kind: '빈 화면', detail: `글자 ${st.text}`, severity: 'FAIL' });
      if (st.overflow > 1) findings.push({ route, button: '(열기)', kind: '가로 넘침', detail: `${st.overflow}px`, severity: 'FAIL' });
      if (errs.length > e0 && !st.boundary) findings.push({ route, button: '(열기)', kind: 'pageerror', detail: errs.slice(e0).join(' / ').slice(0, 200), severity: 'FAIL' });
      if (st.boundary) continue;

      // 양성 대조군 — 누르면 던지는 버튼을 심는다. 순찰이 이것을 못 잡으면 초록은 거짓이다.
      if (process.env.PATROL_CONTROL === '1' && scope === 'content') {
        await page.evaluate(() => {
          const host = [...document.querySelectorAll('[data-pq-content]')].find((r) => !r.closest('[aria-hidden="true"]')) || document.body;
          const btn = document.createElement('button');
          btn.textContent = 'patrol-control';
          btn.style.cssText = 'position:relative;z-index:2147483646;padding:8px';
          btn.addEventListener('click', () => { setTimeout(() => { throw new Error('patrol-control-crash'); }, 0); });
          host.prepend(btn);
        });
      }
      const markN = process.env.PATROL_CONTROL === '1' ? Math.max(maxN, 60) : maxN;
      const doneSnap = [...doneSet];
      const names = await page.evaluate(MARK, markN, DANGER.source, doneSnap, scope);
      names.forEach((nm) => doneSet.add(nm));
      if (process.env.PATROL_DEBUG) console.error('[patrol]', env.n, route, scope, names.length, JSON.stringify(names));
      for (let i = 0; i < names.length; i++) {
        const name = names[i];
        // 앞 버튼이 화면을 바꿨으면 다시 연 뒤 다시 번호를 매긴다(같은 규칙이라 같은 번호가 같은 버튼이다)
        let el = await page.$(`[data-patrol-idx="${i}"]`);
        const elName = el ? await el.evaluate((x, src) => ((x.getAttribute('aria-label') || '') + ' ' + (x.getAttribute('title') || '') + ' ' + (x.innerText || '')).replace(/\s+/g, ' ').trim().slice(0, 60), DANGER.source) : null;
        if (!el || elName !== name) {
          // 앞 버튼이 화면을 바꿨다 — 다시 열고 **이름으로** 같은 버튼을 찾는다(순서는 바뀔 수 있다). 없으면 이 버튼만 건너뛴다.
          await b.goto(page, route); await b.sleep(500);
          const again = await page.evaluate(MARK, 999, DANGER.source, doneSnap.filter((d) => !names.includes(d)), scope);
          const j = again.indexOf(name);
          if (process.env.PATROL_DEBUG && j < 0) console.error('[patrol] gone after reopen', route, name);
          if (j < 0) continue;
          el = await page.$(`[data-patrol-idx="${j}"]`);
          if (!el) continue;
        }
        const pt = await el.evaluate((x) => {
          x.scrollIntoView({ block: 'center', inline: 'center' });
          const r = x.getBoundingClientRect();
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          const h = document.elementFromPoint(cx, cy);
          // 안쪽 요소가 바깥 버튼 안에 들어 있으면(h ⊃ x) 누르는 곳은 같은 버튼이다 — 덮인 것이 아니다
          return { x: cx, y: cy, hit: !!h && (h === x || x.contains(h) || h.contains(x)), cover: h ? (h.getAttribute('aria-label') || h.getAttribute('data-testid') || h.tagName) : null, inView: cx >= 0 && cy >= 0 && cx <= innerWidth && cy <= innerHeight };
        });
        // 화면 밖 = 접힌 서랍(폰 사이드바 등) 속 버튼 — 사용자도 못 누르는 자리라 판정하지 않는다
        if (!pt.inView) continue;
        if (!pt.hit) {
          findings.push({ route, button: name, kind: '눌러지지 않음', detail: `덮은 것: ${pt.cover}`, severity: 'WARN' });
          continue;
        }
        const e1 = errs.length;
        const t1 = newTargets;
        const nc1 = env.native ? await page.evaluate(() => (window.__nativeCalls || []).length) : 0;
        const p1 = await page.evaluate(() => location.pathname + location.search);
        // «눌러도 반응 없음» 판정용 — 화면 변화·요청·주소·새 창 어느 것도 없으면 죽은 버튼이다(2026-10-05 Irene:
        //   «이런 문제를 내가 찾기 전에 너가 안돼?» — 상담 «메일에서 보기» 신고)
        const r1 = page.__reqs;
        await page.evaluate(() => {
          window.__pqMut = 0;
          if (window.__pqObs) window.__pqObs.disconnect();
          window.__pqObs = new MutationObserver((m) => { window.__pqMut += m.length; });
          window.__pqObs.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
        });
        const o1 = await page.evaluate(OVERLAY_SIG);
        try {
          if (env.vp.hasTouch) await page.touchscreen.tap(pt.x, pt.y); else await page.mouse.click(pt.x, pt.y);
        } catch { continue; }
        clicked += 1;
        await b.sleep(700);
        const after = await page.evaluate(SCREEN_STATE).catch(() => ({ boundary: false, text: 999, overflow: 0 }));
        const react = await page.evaluate(() => ({
          mut: window.__pqMut || 0,
          url: location.pathname + location.search,
          // 눌렀더니 «찾을 수 없음·권한 없음·오류» 상세 화면 — 공용 DetailFallback 의 손잡이(하니스 계약)
          fallback: [...document.querySelectorAll('[data-testid="detail-fallback-notfound"],[data-testid="detail-fallback-forbidden"],[data-testid="detail-fallback-error"]')]
            .filter((e) => !e.closest('[aria-hidden="true"]') && e.getBoundingClientRect().width > 0).map((e) => e.getAttribute('data-testid')),
        })).catch(() => ({ mut: 1, url: '', fallback: [] }));
        if (react.fallback.length) findings.push({ route, button: name, kind: '눌렀더니 찾을 수 없음', detail: `${react.fallback.join(',')} @ ${react.url}`, severity: 'FAIL' });
        // 이미 선택된 탭·필터를 다시 누른 것은 반응이 없는 게 정상이다(aria-selected/pressed/current)
        const alreadyOn = await el.evaluate((x) => ['aria-selected', 'aria-pressed', 'aria-current'].some((k) => { const v = x.getAttribute(k); return v && v !== 'false'; })).catch(() => false);
        if (!alreadyOn && react.mut === 0 && page.__reqs === r1 && react.url === p1 && newTargets === t1) {
          findings.push({ route, button: name, kind: '눌러도 반응 없음', detail: '화면 변화·요청·이동 0', severity: 'WARN' });
        }
        const newErrs = errs.slice(e1);
        if (after.boundary) findings.push({ route, button: name, kind: '오류 화면', detail: newErrs.join(' / ').slice(0, 200), severity: 'FAIL' });
        else if (newErrs.length) findings.push({ route, button: name, kind: 'pageerror', detail: newErrs.join(' / ').slice(0, 200), severity: 'FAIL' });
        if (env.native) {
          const calls = await page.evaluate((n) => (window.__nativeCalls || []).slice(n), nc1);
          // 우리 **화면** 주소가 인앱 브라우저로 가면 결함이다(앱 탭으로 열려야 한다 — services/nativeLinks).
          //   우리 /api/·/uploads/ (PDF·첨부)는 설계상 인앱 브라우저로 연다(SPA 탭으로 열면 빈 탭) — 정상.
          const ours = calls.filter((c) => {
            if (c.p !== 'Browser' || c.m !== 'open' || !c.url) return false;
            let u; try { u = new URL(c.url, b.BASE); } catch { return false; }
            if (u.host !== BASE_HOST) return false;
            return !/^\/(api|uploads)\//.test(u.pathname);
          });
          if (ours.length) findings.push({ route, button: name, kind: '앱 밖으로 나감', detail: ours.map((c) => c.url).join(', ').slice(0, 200), severity: 'FAIL' });
          if (newTargets > t1) findings.push({ route, button: name, kind: '앱에서 새 창', detail: `${newTargets - t1}개`, severity: 'FAIL' });
        }
        // 정리 — 열린 것 닫기, 새 창 닫기, 화면이 바뀌었으면 다시 연다
        for (const pg of await ctx.pages()) if (pg !== page) await pg.close().catch(() => null);
        await page.keyboard.press('Escape').catch(() => null);
        await b.sleep(150);
        await page.keyboard.press('Escape').catch(() => null);
        await b.sleep(150);
        const p2 = await page.evaluate(() => location.pathname + location.search).catch(() => '');
        const stillModal = await page.evaluate(() => !!document.querySelector('[aria-modal="true"]')).catch(() => false);
        const o2 = await page.evaluate(OVERLAY_SIG).catch(() => 0);
        if (after.boundary || p2 !== p1 || stillModal || o2 > o1) { await b.goto(page, route); await b.sleep(400); await page.evaluate(MARK, markN, DANGER.source, doneSnap, scope); }
      }
     } catch (e) {
      findings.push({ route, button: '-', kind: '화면 응답 없음', detail: String(e.message || e).slice(0, 160), severity: 'FAIL' });
      try { await b.goto(page, '/dashboard'); } catch { /* 다음 화면에서 다시 연다 */ }
     }
    }
  } catch (e) {
    findings.push({ route: '-', button: '-', kind: 'FATAL', detail: String(e.message || e).slice(0, 200), severity: 'FAIL' });
  } finally {
    report.push({ env: env.n, clicked, blocked: page.__blocked, findings });
    await ctx.close().catch(() => null);
  }
}

async function run() {
  const routes = process.env.PATROL_ROUTES ? process.env.PATROL_ROUTES.split(',') : ROUTES_ALL;
  const envs = process.env.PATROL_ENVS ? ENVS_ALL.filter((e) => process.env.PATROL_ENVS.split(',').includes(e.n)) : ENVS_ALL;
  const maxN = Number(process.env.PATROL_MAX || 15);
  const report = [];
  const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 120000, args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  try {
    for (const env of envs) await patrolEnv(browser, env, routes, maxN, report);
  } finally {
    await browser.close().catch(() => null);
  }

  // 사람이 읽는 보고서
  const lines = [`# 버튼 순찰 ${new Date().toISOString()}`, `화면 ${routes.length} × 환경 ${envs.map((e) => e.n).join(', ')} · 화면당 최대 ${maxN}개`, ''];
  for (const r of report) {
    const fails = r.findings.filter((f) => f.severity === 'FAIL');
    const warns = r.findings.filter((f) => f.severity === 'WARN');
    lines.push(`## ${r.env} — 누름 ${r.clicked} · 막은 쓰기 ${r.blocked} · 실패 ${fails.length} · 경고 ${warns.length}`);
    for (const f of [...fails, ...warns]) lines.push(`- [${f.severity}] ${f.route} · «${f.button}» · ${f.kind} — ${f.detail}`);
    lines.push('');
  }
  try {
    const dir = '/opt/planq/logs/patrol';
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `patrol-${today()}.log`), lines.join('\n'));
  } catch { /* 보고서 실패는 판정에 영향 없음 */ }

  const results = [];
  for (const r of report) {
    const fails = r.findings.filter((f) => f.severity === 'FAIL');
    const warns = r.findings.filter((f) => f.severity === 'WARN');
    // ★ 하나도 못 눌렀으면 초록이 아니다 — 미측정이다
    results.push({ name: `${r.env} · 버튼 ${r.clicked}개 눌러 봄`, fail: r.clicked === 0 ? 1 : 0, details: [r.clicked === 0 ? '미측정 — 누른 버튼 0' : `막은 쓰기 ${r.blocked}`] });
    results.push({ name: `${r.env} · 오류·빈 화면·넘침·앱 이탈 0`, fail: fails.length ? 1 : 0, details: fails.length ? fails.slice(0, 12).map((f) => `${f.route} «${f.button}» ${f.kind} — ${f.detail}`) : ['없음'] });
    if (warns.length) results.push({ name: `${r.env} · (경고) 눌러지지 않음·반응 없음 ${warns.length}`, fail: 0, details: warns.slice(0, 8).map((f) => `${f.route} «${f.button}» ${f.detail}`) });
  }
  return results;
}

module.exports = { run, name: 'canary-button-patrol', DANGER, MARK };
