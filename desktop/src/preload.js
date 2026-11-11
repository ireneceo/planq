// PlanQ 데스크탑 앱 — preload. 창에 window.planqDesktop 하나만 붙인다(설계 §5 «preload 표면» — 이 목록이 전부).
//   웹 쪽 타입·판정: dev-frontend/src/services/native.ts (PlanqDesktopBridge · isDesktopApp).
//   ipcRenderer 원본·fs·클립보드 쓰기 등은 절대 내보내지 않는다.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch, ...a) => ipcRenderer.invoke(ch, ...a).then((v) => v, () => false);

function listen(channel, cb) {
  if (typeof cb !== 'function') return () => {};
  const h = (_e, v) => { try { cb(v); } catch { /* 화면 쪽 오류는 화면 몫 */ } };
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
}

const bridge = {
  version: (process.argv.find((a) => a.startsWith('--planq-version=')) || '').slice('--planq-version='.length),
  platform: process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux',
  setAlwaysOnTop: (on) => invoke('planq:set-always-on-top', !!on),
  notify: (n) => invoke('planq:notify', n && typeof n === 'object' ? {
    id: String(n.id || ''), title: String(n.title || ''), body: n.body == null ? '' : String(n.body),
    link: n.link == null ? null : String(n.link), urgent: !!n.urgent, tag: n.tag == null ? '' : String(n.tag),
  } : {}),
  setBadge: (n) => invoke('planq:set-badge', Number(n) || 0),
  openExternal: (url) => invoke('planq:open-external', String(url || '')),
  getAutoLaunch: () => invoke('planq:get-auto-launch'),
  setAutoLaunch: (on) => invoke('planq:set-auto-launch', !!on),
  onNotificationClick: (cb) => listen('planq:notification-click', (link) => cb(typeof link === 'string' ? link : null)),
  onDeepLink: (cb) => listen('planq:deep-link', (url) => { if (typeof url === 'string') cb(url); }),
  // 2단계 C — 전역 단축키 «빠른 업무 추가». 바꾸기는 메인 창만(main 이 거절) · 형식 검증은 main
  getShortcut: () => invoke('planq:get-shortcut'),
  setShortcut: (req) => invoke('planq:set-shortcut', req && typeof req === 'object' ? {
    enabled: typeof req.enabled === 'boolean' ? req.enabled : undefined,
    accel: typeof req.accel === 'string' ? req.accel.slice(0, 64) : undefined,
  } : {}),
  onQuickAdd: (cb) => listen('planq:quick-add', () => cb()),
  // 2단계 E — 점프 목록·맥 메뉴 «Q task·Q talk·Q note 열기»(허용 목록 이름만 온다)
  onAction: (cb) => listen('planq:action', (a) => { if (a === 'qtask' || a === 'qtalk' || a === 'qnote') cb(a); }),
};

// @test-only-start — 시험 다리. 개발 실행 + PLANQ_DESKTOP_TEST=1 일 때만 main 이 --planq-desktop-test 를 준다.
//   scripts/build.js 가 패키지를 만들 때 이 구역을 **잘라낸다**(패키지 asar 에 시험 표면 0 — 검증 G).
if (process.argv.includes('--planq-desktop-test')) {
  bridge.__test = {
    state: () => ipcRenderer.invoke('planq:test:state'),
    hideMain: () => ipcRenderer.invoke('planq:test:hide-main'),
    showMain: () => ipcRenderer.invoke('planq:test:show-main'),
    deepLink: (url) => ipcRenderer.invoke('planq:test:deep-link', String(url)),
    quickAdd: () => ipcRenderer.invoke('planq:test:quick-add'),
    quickKey: (k) => ipcRenderer.invoke('planq:test:quick-key', String(k)),
  };
}
// @test-only-end

contextBridge.exposeInMainWorld('planqDesktop', Object.freeze(bridge));
