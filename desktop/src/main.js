// PlanQ 데스크탑 앱 — main 프로세스 (Electron). 설계 docs/DESKTOP_APP_DESIGN.md (Fable DESIGN-READY 2026-11-06)
//
// 원격 껍데기: 창은 APP_ORIGIN(운영 https://planq.kr · 개발 빌드 https://dev.planq.kr)을 띄운다 — 웹 배포로 화면도 같이 바뀐다.
// 이 파일이 지키는 계약(§5 보안):
//   · 모든 창 contextIsolation·sandbox·nodeIntegration:false · 탐색 잠금(같은 출처만 창 안, http(s) 바깥은 OS 브라우저)
//   · 렌더러에 주는 것은 preload 의 planqDesktop 표면뿐 · 모든 IPC 는 보낸 프레임의 출처를 본다
//   · main 은 토큰을 보지도 받지도 않는다(세션은 httpOnly 쿠키 그대로)
//   · planq:// 는 oauth/native-return 만 처리한다
'use strict';

const path = require('path');
const fs = require('fs');
const {
  app, BrowserWindow, WebContentsView, ipcMain, shell, Tray, Menu, Notification, nativeImage, session, screen, net, globalShortcut,
} = require('electron');
const { DEFAULT_ACCEL, validateAccel, displayAccel, ACTION_ARG, actionFromArgv } = require('./shortcut');

// ── 출처 — 빌드 때 한 값으로 고정(scripts/build.js 가 src/origin.json 을 쓴다). 실행 중 바꿀 수 없다. ──
function readOrigin() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'origin.json'), 'utf8'));
    if (j && typeof j.origin === 'string') return new URL(j.origin).origin;
  } catch { /* 개발 실행 */ }
  // 패키지 빌드는 origin.json 이 없으면 운영. 환경변수는 개발 실행(electron .)에서만 받는다.
  if (!app.isPackaged && process.env.PLANQ_DESKTOP_ORIGIN) return new URL(process.env.PLANQ_DESKTOP_ORIGIN).origin;
  return 'https://planq.kr';
}
const APP_ORIGIN = readOrigin();
const TEST_MODE = !app.isPackaged && process.env.PLANQ_DESKTOP_TEST === '1';
const START_HIDDEN = process.argv.includes('--hidden');   // 로그인 시 자동 실행은 트레이로만 뜬다
const SCHEME = 'planq';

// ── 문구(트레이·메뉴) — 화면 문구는 웹(i18n)이 들고, 껍데기는 이 몇 줄뿐이다 ──
const KO = {
  open: 'PlanQ 열기', autoLaunch: '컴퓨터 켤 때 자동 실행', installUpdate: '새 버전 설치하고 다시 시작',
  quit: '종료', tooltip: 'PlanQ', tooltipCount: (n) => `PlanQ — 확인할 것 ${n}개`,
  quickAdd: (k) => (k ? `빠른 업무 추가 (${k})` : '빠른 업무 추가'), shortcutOn: '단축키로 빠른 업무 추가',
  openTask: 'Q task 열기', openTalk: 'Q talk 열기', openNote: 'Q note 열기', fileMenu: '파일',
};
const EN = {
  open: 'Open PlanQ', autoLaunch: 'Start when the computer starts', installUpdate: 'Install update and restart',
  quit: 'Quit', tooltip: 'PlanQ', tooltipCount: (n) => `PlanQ — ${n} to check`,
  quickAdd: (k) => (k ? `Quick add task (${k})` : 'Quick add task'), shortcutOn: 'Quick add with shortcut',
  openTask: 'Open Q task', openTalk: 'Open Q talk', openNote: 'Open Q note', fileMenu: 'File',
};
const L = () => (String(app.getLocale() || '').toLowerCase().startsWith('ko') ? KO : EN);

// ── 단일 인스턴스 — 두 번째 실행·planq:// 는 기존 창으로 ──
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    // 점프 목록·독 메뉴 — 고정 허용 목록 이름만(§4-5). 그 밖의 --pq-action 값은 버리고 평소처럼 메인 창
    const action = actionFromArgv(argv);
    if (action) { runAction(action); return; }
    const link = argv.find((a) => typeof a === 'string' && a.startsWith(`${SCHEME}://`));
    if (link) deliverDeepLink(link);
    showMain();
  });
}

// planq:// 등록 — 윈도우는 NSIS 가 레지스트리도 쓴다(electron-builder protocols). 개발 실행은 인자를 붙여 등록.
if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient(SCHEME, process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient(SCHEME);
}

let mainWin = null;
let tray = null;
let quitting = false;
let updateReady = false;
let pendingDeepLink = null;
let badgeCount = 0;
let pendingAction = actionFromArgv(process.argv);   // 점프 목록으로 콜드 스타트

// 맥: planq:// 는 open-url 로 온다(앱이 안 떠 있으면 ready 전에 올 수 있다 — 들고 있다가 보낸다)
app.on('open-url', (e, url) => { e.preventDefault(); deliverDeepLink(url); showMain(); });
// 윈도우 콜드 스타트: 첫 실행 인자에 planq:// 가 실려 온다
{
  const first = process.argv.find((a) => typeof a === 'string' && a.startsWith(`${SCHEME}://`));
  if (first) pendingDeepLink = first;
}

// ── 판정 도구 ──
function sameOrigin(u) {
  try { return new URL(u).origin === APP_ORIGIN; } catch { return false; }
}
function isHttp(u) {
  try { const p = new URL(u).protocol; return p === 'http:' || p === 'https:'; } catch { return false; }
}
// OS 알림 설정 화면 두 곳만 예외로 연다(설정 › «컴퓨터 알림 설정 열기»)
const OS_SETTINGS = new Set([
  'x-apple.systempreferences:com.apple.preference.notifications',
  'ms-settings:notifications',
]);
function fromAppFrame(event) {
  try { return sameOrigin(event.senderFrame && event.senderFrame.url); } catch { return false; }
}
function cap(s, n) { return typeof s === 'string' ? s.slice(0, n) : ''; }
/** 알림 링크 — 상대경로(/로 시작, //는 아님) 또는 같은 출처만. 그 외는 버린다 */
function safeLink(link) {
  if (typeof link !== 'string' || !link) return null;
  if (link.startsWith('/') && !link.startsWith('//')) return link.slice(0, 1000);
  if (sameOrigin(link)) { const u = new URL(link); return (u.pathname + u.search + u.hash).slice(0, 1000); }
  return null;
}

// ── 창 자리 기억 — 도구(팝아웃 경로)별 {x,y,w,h}. 화면 밖이면 버린다 ──
const BOUNDS_FILE = () => path.join(app.getPath('userData'), 'window-bounds.json');
let boundsCache = null;
function loadBounds() {
  if (boundsCache) return boundsCache;
  try { boundsCache = JSON.parse(fs.readFileSync(BOUNDS_FILE(), 'utf8')) || {}; } catch { boundsCache = {}; }
  return boundsCache;
}
function saveBounds(key, b) {
  const all = loadBounds();
  all[key] = { x: b.x, y: b.y, w: b.width, h: b.height };
  try { fs.writeFileSync(BOUNDS_FILE(), JSON.stringify(all)); } catch { /* 디스크 문제 — 다음에 */ }
}
function onSomeScreen(b) {
  try {
    return screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return b.x + 40 < a.x + a.width && b.x + b.w - 40 > a.x && b.y >= a.y - 10 && b.y + 40 < a.y + a.height;
    });
  } catch { return false; }
}
/** 팝아웃 열쇠 = 경로 첫 칸(/talk-popout 등) — 같은 도구의 창(대화방별 창 포함)은 같은 자리를 쓴다 */
/**
 * 창 자리를 들고 있다가 저장한다.
 * ★ 실측(2026-11-07, xvfb): 창 안에서 window.close() 로 닫으면 'close' 가 **오지 않고** 바로 'closed' 다(그땐 getBounds 불가).
 *   리눅스는 이동 끝('moved'·'resized')도 안 온다. 그래서 움직이는 동안('move'·'resize') 마지막 자리를 들고 있다가
 *   0.5초 조용하면 저장 + 닫힐 때 마지막 자리를 한 번 더 저장한다.
 */
function trackBounds(win, key) {
  let last = null; let timer = null;
  const grab = () => { try { if (!win.isDestroyed() && !win.isMinimized() && !win.isMaximized() && !win.isFullScreen()) last = win.getBounds(); } catch { /* */ } };
  const flush = () => { if (timer) { clearTimeout(timer); timer = null; } if (last) saveBounds(key, last); };
  const later = () => { grab(); if (timer) clearTimeout(timer); timer = setTimeout(flush, 500); };
  win.on('move', later);
  win.on('resize', later);
  win.on('close', () => { grab(); flush(); });
  win.on('closed', flush);
  return { grab, flush };
}
function popoutKey(url) {
  try { const p = new URL(url).pathname.split('/')[1] || ''; return /-popout$/.test(p) ? p : null; } catch { return null; }
}

// 렌더러에 주는 인자 — 시험 인자는 아래 «시험 전용» 구역에서만 붙는다(scripts/build.js 가 패키지에서 잘라낸다, check.js 가 확인)
const RENDERER_ARGS = [];
// @test-only-start
if (TEST_MODE) RENDERER_ARGS.push('--planq-desktop-test');
// @test-only-end

function baseWebPreferences() {
  return {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    webviewTag: false,
    spellcheck: false,
    devTools: !app.isPackaged,
    additionalArguments: [`--planq-version=${app.getVersion()}`, ...RENDERER_ARGS],
  };
}

// ── 탐색 잠금 — 모든 webContents(메인·팝아웃·같은 출처 보통 창)에 건다 ──
app.on('web-contents-created', (_e, contents) => {
  const guard = (event, url) => {
    if (sameOrigin(url)) return;
    event.preventDefault();
    if (isHttp(url)) openExternalLogged(url);
  };
  contents.on('will-navigate', guard);
  contents.on('will-redirect', guard);
  contents.setWindowOpenHandler(({ url, frameName, features }) => {
    if (sameOrigin(url)) {
      const key = popoutKey(url);
      const o = { autoHideMenuBar: true, backgroundColor: '#ffffff', webPreferences: baseWebPreferences() };
      if (key) {
        const saved = loadBounds()[key];
        if (saved && onSomeScreen(saved)) Object.assign(o, { x: saved.x, y: saved.y, width: saved.w, height: saved.h });
        else {
          // features 의 width/height/left/top(웹이 계산한 계단 자리)을 그대로 쓴다
          const f = Object.fromEntries(String(features || '').split(',').map((kv) => kv.split('=').map((s) => s.trim())));
          const n = (k) => (Number.isFinite(Number(f[k])) ? Number(f[k]) : undefined);
          if (n('width')) o.width = n('width');
          if (n('height')) o.height = n('height');
          if (n('left') !== undefined) o.x = n('left');
          if (n('top') !== undefined) o.y = n('top');
        }
        o.alwaysOnTop = false;          // 핀은 사용자가 창에서 켠다(재시작 때 복원 안 함 — 설계 §3-3)
      }
      return { action: 'allow', overrideBrowserWindowOptions: o };
    }
    if (isHttp(url)) openExternalLogged(url);
    return { action: 'deny' };
  });
  contents.on('did-create-window', (win, { url }) => {
    const key = popoutKey(url);
    win.setMenuBarVisibility(false);
    if (!key) return;
    trackBounds(win, key);
  });
});

// ── 바깥 열기 기록(시험용) ──
const testLog = { notify: [], openExternal: [] };
function openExternalLogged(url) {
  if (TEST_MODE) { testLog.openExternal.push(url); return; }
  shell.openExternal(url).catch(() => {});
}

// ── 메인 창 ──
function createMain() {
  mainWin = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 380,
    minHeight: 500,
    show: false,
    title: 'PlanQ',
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { ...baseWebPreferences(), backgroundThrottling: false },   // 트레이로 숨은 동안에도 소켓·알림이 늦춰지지 않게
  });
  const saved = loadBounds().__main;
  if (saved && onSomeScreen(saved)) mainWin.setBounds({ x: saved.x, y: saved.y, width: saved.w, height: saved.h });
  const mainTrack = trackBounds(mainWin, '__main');
  const rememberMain = () => { mainTrack.grab(); mainTrack.flush(); };

  mainWin.webContents.setUserAgent(`${mainWin.webContents.getUserAgent()} PlanQDesktop/${app.getVersion()}`);
  watchMainLoad(mainWin.webContents);
  mainWin.loadURL(`${APP_ORIGIN}/`);
  mainWin.once('ready-to-show', () => { if (!START_HIDDEN) mainWin.show(); });
  mainWin.webContents.on('did-finish-load', () => {
    if (pendingDeepLink) { const l = pendingDeepLink; pendingDeepLink = null; deliverDeepLink(l); }
    if (pendingAction) { const a = pendingAction; pendingAction = null; runAction(a); }
  });
  // 닫기(X) = 숨김 — 트레이에 남아 알림을 받는다. 진짜 종료는 트레이 «종료»·맥 Cmd+Q.
  mainWin.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    rememberMain();
    mainWin.hide();
  });
}

// ── 연결 끊김 화면 (2단계 D · docs/DESKTOP_APP_PHASE2.md · Fable DESIGN-FIX 4) ──
//   메인 프레임을 못 불러오면(네트워크 오류 · 5xx 응답) 흰 화면 대신 껍데기 안 offline.html 을 덮는다.
//   ★ 그 화면은 **preload 없는 전용 보기**(WebContentsView)다 — file:// 출처에 다리를 붙이지 않는다.
//   ★ 다시 시도는 main 타이머(10초) — 출처가 응답하면(5xx 아님) 덮개를 걷고 메인 창을 다시 읽는다.
//   ★ ERR_ABORTED(-3)는 오류가 아니다(이동 도중 취소·탐색 잠금이 막은 것) — 넘긴다.
let offlineView = null;
let offlineTimer = null;
let offlineChecking = false;
function fitOffline() {
  if (!offlineView || !mainWin || mainWin.isDestroyed()) return;
  const [w, h] = mainWin.getContentSize();
  offlineView.setBounds({ x: 0, y: 0, width: w, height: h });
}
async function originAlive() {
  try {
    const r = await net.fetch(`${APP_ORIGIN}/`, { method: 'GET', cache: 'no-store' });
    return r.status < 500;
  } catch { return false; }
}
async function retryOnline() {
  if (offlineChecking || !offlineView) return;
  offlineChecking = true;
  try {
    if (await originAlive()) { hideOffline(); if (mainWin && !mainWin.isDestroyed()) mainWin.loadURL(`${APP_ORIGIN}/`); }
  } finally { offlineChecking = false; }
}
function showOffline() {
  if (!mainWin || mainWin.isDestroyed() || offlineView) return;
  offlineView = new WebContentsView({
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, javascript: true, devTools: !app.isPackaged },
  });
  const wc = offlineView.webContents;
  wc.on('will-navigate', (e) => e.preventDefault());                 // 이 화면은 어디로도 가지 않는다
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('page-title-updated', (_e, title) => { if (/^retry-/.test(title)) retryOnline(); });
  wc.loadFile(path.join(__dirname, 'offline.html'));
  mainWin.contentView.addChildView(offlineView);
  fitOffline();
  mainWin.on('resize', fitOffline);
  offlineTimer = setInterval(retryOnline, 10000);
  if (!START_HIDDEN && !mainWin.isVisible()) mainWin.show();   // 첫 화면부터 실패하면 ready-to-show 를 기다리지 않는다
}
function hideOffline() {
  if (offlineTimer) { clearInterval(offlineTimer); offlineTimer = null; }
  if (!offlineView) return;
  try { if (mainWin && !mainWin.isDestroyed()) { mainWin.removeListener('resize', fitOffline); mainWin.contentView.removeChildView(offlineView); } } catch { /* */ }
  try { offlineView.webContents.close(); } catch { /* */ }
  offlineView = null;
}
function watchMainLoad(wc) {
  wc.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    if (url && !sameOrigin(url)) return;
    showOffline();
  });
  wc.on('did-navigate', (_e, url, httpCode) => {
    if (!sameOrigin(url)) return;
    if (httpCode >= 500) showOffline();
    else if (httpCode > 0) hideOffline();
  });
}

function showMain() {
  if (!mainWin || mainWin.isDestroyed()) { createMain(); return; }
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}

function deliverDeepLink(url) {
  // planq://oauth/native-return 만 받는다(설계 §5)
  try {
    const u = new URL(url);
    if (u.protocol !== `${SCHEME}:` || `${u.hostname}${u.pathname}`.replace(/\/+$/, '') !== 'oauth/native-return') return;
  } catch { return; }
  if (!mainWin || mainWin.isDestroyed() || mainWin.webContents.isLoading()) { pendingDeepLink = url; return; }
  mainWin.webContents.send('planq:deep-link', url);
}

// ── 빠른 업무 추가 (2단계 C · docs/DESKTOP_APP_PHASE2.md §4-3) ──
//   전역 단축키 → 작은 창(기존 /task-popout?quick=1 — 새 화면을 그리지 않는다). 저장 키는 그 화면의 입력 규칙 그대로.
//   ★ 창은 baseWebPreferences() 그대로(같은 preload·탐색 잠금) · Esc = 숨김(다음 단축키에 바로 뜬다)
//   ★ 로그아웃이면(창이 /task-popout 을 벗어나 로그인으로 가면) 이 창을 닫고 메인 창을 보인다
//   ★ 단축키 바꾸기는 메인 창만 · 형식 검증은 main(shortcut.js — 수식키 필수)
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'desktop-settings.json');
function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8')) || {}; } catch { return {}; }
}
function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  try { fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(next)); } catch { /* 디스크 문제 — 이번 실행만 */ }
  return next;
}
const shortcut = { enabled: true, accel: DEFAULT_ACCEL, registered: false, error: null };
function loadShortcutSetting() {
  const q = loadSettings().quickAdd || {};
  shortcut.enabled = q.enabled !== false;
  const v = validateAccel(q.accel || DEFAULT_ACCEL);
  shortcut.accel = v.ok ? v.accel : DEFAULT_ACCEL;
}
/** 지금 설정대로 등록. 실패(다른 프로그램이 이미 씀)는 registered:false + error:'in_use' — 설정 화면에 보인다 */
function applyShortcut() {
  try { globalShortcut.unregisterAll(); } catch { /* */ }
  shortcut.registered = false; shortcut.error = null;
  if (shortcut.enabled) {
    let ok = false;
    try { ok = globalShortcut.register(shortcut.accel, openQuickAdd); } catch { ok = false; }
    shortcut.registered = !!ok;
    if (!ok) shortcut.error = 'in_use';
  }
  rebuildTrayMenu();
  setupMenu();   // 맥 파일 메뉴의 단축키 표기를 같이 맞춘다
  return shortcut.registered;
}
function shortcutState() {
  return { enabled: shortcut.enabled, accel: shortcut.accel, display: displayAccel(shortcut.accel, process.platform),
    registered: shortcut.registered, error: shortcut.error, defaultAccel: DEFAULT_ACCEL };
}
/** 설정 바꾸기 — 형식 거절이면 아무것도 안 바뀐다. 새 키가 이미 쓰이고 있으면 옛 키로 되돌리고 'in_use' */
function setShortcut(req) {
  const enabled = req && typeof req.enabled === 'boolean' ? req.enabled : shortcut.enabled;
  let accel = shortcut.accel;
  if (req && req.accel !== undefined) {
    const v = validateAccel(req.accel);
    if (!v.ok) return { ok: false, error: v.error, state: shortcutState() };
    accel = v.accel;
  }
  const prev = { enabled: shortcut.enabled, accel: shortcut.accel };
  shortcut.enabled = enabled; shortcut.accel = accel;
  applyShortcut();
  if (shortcut.enabled && !shortcut.registered) {
    shortcut.enabled = prev.enabled; shortcut.accel = prev.accel;
    applyShortcut();
    return { ok: false, error: 'in_use', state: shortcutState() };
  }
  saveSettings({ quickAdd: { enabled: shortcut.enabled, accel: shortcut.accel } });
  return { ok: true, state: shortcutState() };
}

let quickWin = null;
const QUICK_PATH = '/task-popout';
function quickBounds() {
  const saved = loadBounds().__quick;
  if (saved && onSomeScreen(saved)) return { x: saved.x, y: saved.y, width: saved.w, height: saved.h };
  const w = 520; const h = 640;
  try {
    const a = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    return { x: Math.round(a.x + (a.width - w) / 2), y: Math.round(a.y + Math.max(40, (a.height - h) / 3)), width: w, height: h };
  } catch { return { width: w, height: h }; }
}
function openQuickAdd() {
  if (quickWin && !quickWin.isDestroyed()) {
    if (quickWin.isMinimized()) quickWin.restore();
    quickWin.show(); quickWin.focus();
    if (!quickWin.webContents.isLoading()) quickWin.webContents.send('planq:quick-add');
    return quickWin;
  }
  quickWin = new BrowserWindow({
    ...quickBounds(),
    minWidth: 360, minHeight: 300,
    show: false,
    title: 'PlanQ',
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: baseWebPreferences(),
  });
  const win = quickWin;
  win.setMenuBarVisibility(false);
  trackBounds(win, '__quick');
  const leftQuick = (url) => {
    if (!sameOrigin(url)) return false;
    try { return new URL(url).pathname !== QUICK_PATH; } catch { return false; }
  };
  // 로그아웃·세션 만료 — 이 창은 로그인 화면을 그리지 않는다. 메인 창에서 로그인하게
  const onNav = (_e, url) => {
    if (!leftQuick(url)) return;
    try { win.destroy(); } catch { /* */ }
    showMain();
  };
  win.webContents.on('did-navigate', onNav);
  win.webContents.on('did-navigate-in-page', onNav);
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape' && !input.alt && !input.control && !input.meta && !input.shift) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('close', (e) => { if (quitting) return; e.preventDefault(); win.hide(); });   // 닫기 = 숨김(다음 단축키에 바로)
  win.on('closed', () => { if (quickWin === win) quickWin = null; });
  win.once('ready-to-show', () => { win.show(); win.focus(); });
  win.loadURL(`${APP_ORIGIN}${QUICK_PATH}?quick=1`);
  return win;
}

// ── 점프 목록(윈도우)·파일 메뉴/독 메뉴(맥) — 고정 허용 목록 동작만 (2단계 E · §4-5) ──
//   팝아웃은 웹의 단일 진입점(launchDockTool)이 연다 — 같은 pq-* 창을 다시 쓴다(창 자리·계단 규칙 그대로).
function runAction(action) {
  if (action === 'quick-task') { openQuickAdd(); return; }
  if (!['qtask', 'qtalk', 'qnote'].includes(action)) return;
  if (!mainWin || mainWin.isDestroyed()) { pendingAction = action; createMain(); return; }
  if (mainWin.webContents.isLoading() || !sameOrigin(mainWin.webContents.getURL())) { pendingAction = action; showMain(); return; }
  mainWin.webContents.send('planq:action', action);
}
function actionMenuItems(withAccel) {
  const s = L();
  return [
    { label: s.quickAdd(''), accelerator: withAccel && shortcut.enabled && shortcut.registered ? shortcut.accel : undefined, registerAccelerator: false, click: () => runAction('quick-task') },
    { type: 'separator' },
    { label: s.openTask, click: () => runAction('qtask') },
    { label: s.openTalk, click: () => runAction('qtalk') },
    { label: s.openNote, click: () => runAction('qnote') },
  ];
}
function setupJumpList() {
  if (process.platform === 'darwin') {
    try { app.dock.setMenu(Menu.buildFromTemplate(actionMenuItems(false))); } catch { /* */ }
    return;
  }
  if (process.platform !== 'win32') return;
  const s = L();
  const pre = process.defaultApp && process.argv.length >= 2 ? `"${path.resolve(process.argv[1])}" ` : '';
  const task = (action, title) => ({
    program: process.execPath, arguments: `${pre}${ACTION_ARG}${action}`,
    iconPath: process.execPath, iconIndex: 0, title, description: title,
  });
  try {
    app.setUserTasks([
      task('quick-task', s.quickAdd('')), task('qtask', s.openTask), task('qtalk', s.openTalk), task('qnote', s.openNote),
    ]);
  } catch { /* */ }
}

// ── 트레이 ──
function trayImage() {
  const img = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png'));
  const size = process.platform === 'darwin' ? 18 : 16;
  return img.isEmpty() ? img : img.resize({ width: size, height: size });
}
function rebuildTrayMenu() {
  if (!tray) return;
  const s = L();
  const items = [
    { label: s.open, click: showMain },
    { label: s.quickAdd(shortcut.enabled && shortcut.registered ? displayAccel(shortcut.accel, process.platform) : ''), click: openQuickAdd },
    { label: s.shortcutOn, type: 'checkbox', checked: shortcut.enabled, click: (mi) => setShortcut({ enabled: mi.checked }) },
    { type: 'separator' },
    { label: s.autoLaunch, type: 'checkbox', checked: getAutoLaunch(), click: (mi) => setAutoLaunch(mi.checked) },
  ];
  if (updateReady) items.push({ type: 'separator' }, { label: s.installUpdate, click: installUpdate });
  items.push({ type: 'separator' }, { label: s.quit, click: () => { quitting = true; app.quit(); } });
  tray.setContextMenu(Menu.buildFromTemplate(items));
  tray.setToolTip(badgeCount > 0 ? s.tooltipCount(badgeCount) : s.tooltip);
}
function createTray() {
  tray = new Tray(trayImage());
  tray.on('click', showMain);
  rebuildTrayMenu();
}

// ── 자동 실행 — 기본 끔. 켜면 트레이로만 뜬다(--hidden) ──
function getAutoLaunch() {
  try { return !!app.getLoginItemSettings().openAtLogin; } catch { return false; }
}
function setAutoLaunch(on) {
  try {
    app.setLoginItemSettings({ openAtLogin: !!on, openAsHidden: !!on, args: on ? ['--hidden'] : [] });
    rebuildTrayMenu();
    return getAutoLaunch() === !!on;
  } catch { return false; }
}

// ── 배지 — 맥 독 숫자 · 윈도우 작업 표시줄 겹침 점 + 트레이 툴팁 ──
let dotImage = null;
function redDot() {
  if (dotImage) return dotImage;
  const S = 16; const buf = Buffer.alloc(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4; const d = Math.hypot(x - 7.5, y - 7.5);
    if (d <= 7) { buf[i] = 0x44; buf[i + 1] = 0x44; buf[i + 2] = 0xEF; buf[i + 3] = 0xFF; }   // BGRA #EF4444
  }
  dotImage = nativeImage.createFromBitmap(buf, { width: S, height: S });
  return dotImage;
}
function applyBadge(n) {
  badgeCount = Math.max(0, Math.min(9999, Math.floor(Number(n) || 0)));
  try {
    if (process.platform === 'darwin' || process.platform === 'linux') app.setBadgeCount(badgeCount);
    if (process.platform === 'win32' && mainWin && !mainWin.isDestroyed()) {
      mainWin.setOverlayIcon(badgeCount > 0 ? redDot() : null, badgeCount > 0 ? String(badgeCount) : '');
    }
  } catch { /* 지원 안 하는 환경 */ }
  rebuildTrayMenu();
  return true;
}

// ── 알림 — 메인 창만 보낸다 + id 60초 중복 차단(설계 §3-5) ──
const recentNotif = new Map();
function notify(payload) {
  const id = cap(payload && payload.id, 200);
  if (!id) return false;
  const now = Date.now();
  for (const [k, t] of recentNotif) if (now - t > 60000) recentNotif.delete(k);
  if (recentNotif.has(id)) return false;
  recentNotif.set(id, now);
  const title = cap(payload.title, 120) || 'PlanQ';
  const body = cap(payload.body, 500);
  const link = safeLink(payload.link);
  if (TEST_MODE) { testLog.notify.push({ id, title, body, link }); return true; }
  if (!Notification.isSupported()) return false;
  const n = new Notification({ title, body, silent: false, urgency: payload.urgent ? 'critical' : 'normal' });
  n.on('click', () => {
    showMain();
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('planq:notification-click', link);
  });
  n.show();
  return true;
}

// ── IPC — preload 표면과 1:1. 모든 핸들러가 보낸 프레임 출처를 본다 ──
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!fromAppFrame(event)) { console.warn('[planq-desktop] 출처 밖 IPC 무시:', channel); return false; }
    try { return await fn(event, ...args); } catch (e) { console.warn('[planq-desktop]', channel, e && e.message); return false; }
  });
}
handle('planq:set-always-on-top', (event, on) => {
  const win = BrowserWindow.fromWebContents(event.sender);   // 보낸 창 자신에만
  if (!win) return false;
  win.setAlwaysOnTop(!!on, 'floating');
  if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(!!on, { visibleOnFullScreen: true });
  return win.isAlwaysOnTop() === !!on;
});
handle('planq:notify', (event, payload) => {
  if (!mainWin || event.sender !== mainWin.webContents) return false;   // 메인 창만(팝아웃도 같은 소켓 이벤트를 받는다)
  return notify(payload || {});
});
handle('planq:set-badge', (event, n) => {
  if (!mainWin || event.sender !== mainWin.webContents) return false;
  return applyBadge(n);
});
handle('planq:open-external', (_event, url) => {
  if (typeof url !== 'string') return false;
  if (OS_SETTINGS.has(url)) { if (!TEST_MODE) shell.openExternal(url).catch(() => {}); else testLog.openExternal.push(url); return true; }
  if (!isHttp(url)) return false;
  openExternalLogged(url);
  return true;
});
handle('planq:get-auto-launch', () => getAutoLaunch());
handle('planq:get-shortcut', () => shortcutState());
handle('planq:set-shortcut', (event, req) => {
  if (!mainWin || event.sender !== mainWin.webContents) return { ok: false, error: 'not_main', state: shortcutState() };   // 메인 창만(§4-3)
  return setShortcut(req && typeof req === 'object' ? { enabled: req.enabled, accel: req.accel } : {});
});
handle('planq:set-auto-launch', (_event, on) => setAutoLaunch(!!on));

// @test-only-start — 시험 전용 IPC(test/ 폴더는 패키지에 들어가지 않고, 이 구역도 build.js 가 잘라낸다)
if (TEST_MODE) {
  require('../test/test-hooks')({ ipcMain, BrowserWindow, getMain: () => mainWin, testLog, getBadge: () => badgeCount, showMain, deliverDeepLink,
    openQuickAdd, getQuick: () => quickWin, shortcutState });
}
// @test-only-end

// ── 권한 — 앱 출처의 알림·마이크(Q Note)·클립보드 읽기만 ──
const ALLOWED_PERMS = new Set(['notifications', 'media', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen']);
function setupPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, cb, details) => {
    const origin = (details && (details.requestingUrl || details.securityOrigin)) || (wc && wc.getURL());
    if (permission === 'media' && details && Array.isArray(details.mediaTypes) && details.mediaTypes.includes('video')) return cb(false);
    cb(sameOrigin(origin) && ALLOWED_PERMS.has(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => sameOrigin(requestingOrigin) && ALLOWED_PERMS.has(permission));
}

// ── 자동 업데이트 — planq.kr/desktop/ (generic). 조용히 받아 종료 때 설치(설계 §3-8) ──
let autoUpdater = null;
function setupUpdater() {
  if (!app.isPackaged) return;
  try { ({ autoUpdater } = require('electron-updater')); } catch { return; }
  autoUpdater.setFeedURL({ provider: 'generic', url: `${APP_ORIGIN}/desktop/` });
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', () => { updateReady = true; rebuildTrayMenu(); });
  autoUpdater.on('error', (e) => console.warn('[planq-desktop] update', e && e.message));
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 6 * 60 * 60 * 1000);
}
function installUpdate() {
  if (!autoUpdater || !updateReady) return;
  quitting = true;
  autoUpdater.quitAndInstall(false, true);
}

// ── 앱 메뉴 — 맥은 편집 메뉴가 있어야 Cmd+C/V 가 된다. 윈도우는 메뉴 막대를 숨긴다 ──
function setupMenu() {
  if (process.platform !== 'darwin') { Menu.setApplicationMenu(null); return; }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' }, { label: L().fileMenu, submenu: actionMenuItems(true) },
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ]));
}

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('kr.planq.desktop');   // 윈도우 알림에 앱 이름이 붙게
  setupPermissions();
  loadShortcutSetting();
  setupMenu();
  createMain();
  createTray();
  applyShortcut();
  setupJumpList();
  setupUpdater();
  if (pendingAction === 'quick-task') { pendingAction = null; openQuickAdd(); }
});
app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch { /* */ } });
app.on('activate', showMain);             // 맥 독 아이콘 누름
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { /* 트레이에 남는다 — 종료하지 않는다 */ });
