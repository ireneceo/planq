// 시험 전용 IPC — main.js 가 개발 실행 + PLANQ_DESKTOP_TEST=1 일 때만 부른다. 이 폴더(test/)는 패키지에 들어가지 않는다.
//   e2e `desktop` 스위트(scripts/e2e/canary-desktop.js)가 창 목록·항상 위·알림·바깥 열기 기록을 읽는다.
'use strict';

module.exports = function installTestHooks({ ipcMain, BrowserWindow, getMain, testLog, getBadge, showMain, deliverDeepLink, openQuickAdd, getQuick, shortcutState }) {
  ipcMain.handle('planq:test:state', () => ({
    windows: BrowserWindow.getAllWindows().map((w) => ({
      id: w.id,
      url: w.webContents.getURL(),
      alwaysOnTop: w.isAlwaysOnTop(),
      visible: w.isVisible(),
      bounds: w.getBounds(),
      main: w === getMain(),
      quick: w === getQuick(),
      focused: w.isFocused(),
    })),
    shortcut: shortcutState(),
    notify: testLog.notify.slice(),
    openExternal: testLog.openExternal.slice(),
    badge: getBadge(),
  }));
  ipcMain.handle('planq:test:hide-main', () => { const m = getMain(); if (m) m.hide(); return true; });
  ipcMain.handle('planq:test:show-main', () => { showMain(); return true; });
  // 단축키를 누른 것과 같은 함수(globalShortcut 콜백 = openQuickAdd). xvfb 에서 전역 키 입력을 흉내 낼 수 없어 함수로 부른다
  ipcMain.handle('planq:test:quick-add', () => { openQuickAdd(); return true; });
  // 빠른 창에 «진짜 키 입력» 길(sendInputEvent → before-input-event)로 키를 보낸다 — puppeteer(CDP) 키는 before-input-event 를 거치지 않는다
  ipcMain.handle('planq:test:quick-key', (_e, keyCode) => {
    const q = getQuick();
    if (!q || q.isDestroyed()) return false;
    q.webContents.sendInputEvent({ type: 'keyDown', keyCode: String(keyCode) });
    q.webContents.sendInputEvent({ type: 'keyUp', keyCode: String(keyCode) });
    return true;
  });
  ipcMain.handle('planq:test:deep-link', (_e, url) => { deliverDeepLink(String(url)); return true; });
};
