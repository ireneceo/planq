// 시험 전용 IPC — main.js 가 개발 실행 + PLANQ_DESKTOP_TEST=1 일 때만 부른다. 이 폴더(test/)는 패키지에 들어가지 않는다.
//   e2e `desktop` 스위트(scripts/e2e/canary-desktop.js)가 창 목록·항상 위·알림·바깥 열기 기록을 읽는다.
'use strict';

module.exports = function installTestHooks({ ipcMain, BrowserWindow, getMain, testLog, getBadge, showMain, deliverDeepLink }) {
  ipcMain.handle('planq:test:state', () => ({
    windows: BrowserWindow.getAllWindows().map((w) => ({
      id: w.id,
      url: w.webContents.getURL(),
      alwaysOnTop: w.isAlwaysOnTop(),
      visible: w.isVisible(),
      bounds: w.getBounds(),
      main: w === getMain(),
    })),
    notify: testLog.notify.slice(),
    openExternal: testLog.openExternal.slice(),
    badge: getBadge(),
  }));
  ipcMain.handle('planq:test:hide-main', () => { const m = getMain(); if (m) m.hide(); return true; });
  ipcMain.handle('planq:test:show-main', () => { showMain(); return true; });
  ipcMain.handle('planq:test:deep-link', (_e, url) => { deliverDeepLink(String(url)); return true; });
};
