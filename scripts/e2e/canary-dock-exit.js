// canary-dock-exit — 우하단 채팅 버튼(바로 열기)의 모든 항목이 «열리고 · 나갈 수 있고 · 다시 안 열리는가» (2026-11-06)
//
//   Irene: «모바일에서 우측 하단 채팅아이콘으로 업무추가 들어가면 업무 넣고 나서도 나갈 수가 없어.
//           뒤로가기 취소 다 작동 안하고 계속 또 열려. … 우측 기능들 모든 디바이스 점검해. 모든 루트»
//   원인 두 갈래(고침 전 실측):
//     ① 폰 — [+업무]·[+일정]·[+메일] 은 `?create=1` 로 한 칸 쌓고 받는 화면이 그 신호를 replace 로 지운다.
//        useBackToClose 는 «주소 이동과 함께 열렸다 = 주소가 뒤로를 맡는다» 로 보고 칸을 안 쌓았는데, 신호가 지워져
//        아무도 뒤로를 맡지 않았다 → 같은 화면(/tasks)에서 열면 뒤로 가도 창이 그대로. 메일 작성·말로 추가·메모 창은 훅이 없었다.
//     ② 태블릿(탭 모드) — 새 탭 칸이 `/calendar?create=1` 로 남아(UrlMirror 가 신호 소비 replace 를 push 로 쌓음),
//        창을 닫고 뒤로 가면 그 칸에 닿아 창이 다시 열렸다.
//   기본 시작 화면 = /tasks·/mail(같은 화면에서 연 경우 + 다른 화면에서 연 경우 둘 다 · 밤 검사 20분 안). 전수는 E2E_DOCK_STARTS=/talk,/tasks,/calendar,/mail,/dashboard.
//   재는 것(폰 390 · 태블릿 768 · 데스크탑 1440 × 시작 화면 × 항목 8개):
//     열림 · [취소]/닫기 → 닫힘 + 1.5초 뒤에도 안 열림 · 닫은 뒤 뒤로 → 다시 안 열림 · (폰) 뒤로 → 닫힘 · 앞으로 가도 안 열림 ·
//     (업무) 저장 → 닫힘 · 저장 뒤 뒤로 → 다시 안 열림 · 열기 도구(Q talk·Q task) 폰은 뒤로 = 원래 화면 · 데스크탑 Q note·Q helper 는 새 창.
//   탭 모드에서 «연 채 뒤로» 는 탭 기록(UrlMirror) 몫이라 재지 않는다(화면 상태 창은 칸을 안 쌓는 것이 설계 — mobilepanels ① 음성 대조).
require('./lib/mem-slot');
const b = require('./lib/browser');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const VPS = (process.env.E2E_DOCK_VPS || 'phone,tablet,desktop').split(',');
const VP = {
  phone: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  tablet: { width: 768, height: 1024, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  tabletL: { width: 1180, height: 820, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  desktop: { width: 1440, height: 900 },
};
const STARTS = (process.env.E2E_DOCK_STARTS || '/tasks,/mail').split(',');
const ITEMS = (process.env.E2E_DOCK_ITEMS || 'task,event,mail,voice,qnote,qhelper,qtalk,qtask').split(',');
// 무엇이 «열림» 인가 (보이는 것만)
const OPEN_SEL = {
  task: '[data-testid="task-create-form"]',
  event: '[data-testid="new-event-title"]',
  mail: '[data-testid="mail-compose-panel"]',
  voice: '[role="dialog"][aria-modal="true"][aria-label="말로 추가"]',
  qnote: '[data-memo-popup="1"]',
  qhelper: '[role="dialog"][aria-label="Q helper"]',
};
const TESTID = { task: 'dock-create-task', event: 'dock-create-event', mail: 'dock-create-mail', voice: 'dock-voice', qnote: 'dock-open-note', qhelper: 'dock-open-helper', qtalk: 'dock-open-talk', qtask: 'dock-open-task' };
let results = [];
const ok = (name, cond, msg) => { results.push({ name, fail: cond ? 0 : 1, details: [msg] }); };

async function visible(page, sel) {
  return page.evaluate((sel) => Array.from(document.querySelectorAll(sel)).some((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 4 && r.height > 4 && cs.visibility !== 'hidden' && !e.closest('[hidden],[aria-hidden="true"]') && r.bottom > 0 && r.top < innerHeight; }), sel);
}
async function anyOverlay(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('[data-pq-drawer-panel], [role="dialog"][aria-modal="true"], [data-testid="mail-compose-panel"]')).some((e) => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4 && !e.closest('[hidden]') && getComputedStyle(e).visibility !== 'hidden'; }));
}
async function openItem(page, item) {
  await page.evaluate(() => document.querySelector('[data-testid="right-dock-fab"]')?.click()); await sleep(500);
  const clicked = await page.evaluate((id) => { const e = document.querySelector(`[data-testid="${id}"]`); if (!e) return false; e.click(); return true; }, TESTID[item]);
  await sleep(2200);
  return clicked;
}
async function closeBtn(page, item) {
  return page.evaluate((item) => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    if (item === 'mail') { const x = document.querySelector('[data-testid="mail-compose-close"]'); if (x && vis(x)) { x.click(); return 'mail-x'; } }
    const own = { qnote: '[data-memo-popup="1"]', qhelper: '[role="dialog"][aria-label="Q helper"]' }[item];
    const roots = Array.from(document.querySelectorAll(own || '[data-pq-drawer-panel], [role="dialog"][aria-modal="true"]')).filter(vis);
    const root = roots[roots.length - 1] || document;
    const btns = Array.from(root.querySelectorAll('button')).filter(vis);
    const c = btns.find((x) => /^(취소|Cancel)$/.test(x.innerText.trim()));
    if (c) { c.click(); return 'cancel'; }
    const x = btns.find((x) => /닫기|close/i.test((x.getAttribute('aria-label') || '') + (x.getAttribute('title') || '')));
    if (x) { x.click(); return 'x'; }
    return null;
  }, item);
}
const path = (page) => page.evaluate(() => location.pathname);
const go = async (page, start) => { await b.goto(page, start); if ((await path(page)) === '/login') { await b.login(page); await b.goto(page, start); } };

async function run() {
  results = [];
  const { browser } = await b.launch();
  try {
  for (const vk of VPS) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport(VP[vk]);
    if (vk !== 'desktop') await page.setUserAgent(UA);
    await b.login(page);
    const popups = [];
    browser.on('targetcreated', (t) => { if (t.type() === 'page') popups.push(t.url()); });
    for (const start of STARTS) {
      for (const item of ITEMS) {
        const tag = `${vk} ${start} ${item}`;
        if (OPEN_SEL[item] === undefined) {
          // 열기 도구(qtalk/qtask): 그 화면으로 가거나(폰) 새 창(데스크탑). 뒤로 = 원래 화면
          await go(page, start); await b.dismissBlockers(page); await sleep(800);
          const before = popups.length;
          await openItem(page, item);
          const p = await path(page);
          const target = item === 'qtalk' ? '/talk' : '/tasks';
          const viaPopup = popups.length > before;
          ok(`${tag} · 열림`, viaPopup || p.startsWith(target), `주소=${p} 새창=${viaPopup}`);
          if (!viaPopup && start !== target && vk === 'phone') { await page.goBack().catch(() => null); await sleep(1500); const p2 = await path(page); ok(`${tag} · 뒤로=원래 화면`, p2 === start, `주소=${p2}`); }
          for (const pg of (await browser.pages())) if (pg !== page && pg.url().includes('popout')) await pg.close().catch(() => null);
          continue;
        }
        const desk = vk === 'desktop' || vk === 'tabletL';
        // ① 취소/닫기
        await go(page, start); await b.dismissBlockers(page); await sleep(800);
        if (!(await openItem(page, item))) { ok(`${tag} · 메뉴 항목`, false, '없음'); continue; }
        if (vk === 'desktop' && (item === 'qnote' || item === 'qhelper')) {
          await sleep(500); const pages = await browser.pages(); const pop = pages.find((pg) => pg !== page && /popout/.test(pg.url()));
          ok(`${tag} · 새 창으로 열림`, !!pop, pop ? pop.url() : '없음'); if (pop) await pop.close().catch(() => null); continue;
        }
        const o1 = await visible(page, OPEN_SEL[item]);
        ok(`${tag} · 열림`, o1, `보임=${o1} 주소=${await path(page)}`);
        if (!o1) continue;
        const how = await closeBtn(page, item); await sleep(1500);
        const c1 = !(await visible(page, OPEN_SEL[item])); await sleep(1500);
        const c1b = !(await visible(page, OPEN_SEL[item]));
        ok(`${tag} · 닫기(${how}) → 닫힘·다시 안 열림`, c1 && c1b, `닫힘=${c1} 1.5초뒤=${c1b}`);
        if (vk !== 'desktop') {
          // 닫은 뒤 뒤로 → 다시 안 열림
          await page.goBack().catch(() => null); await sleep(1500);
          const r1 = !(await visible(page, OPEN_SEL[item]));
          ok(`${tag} · 닫은 뒤 뒤로 → 다시 안 열림`, r1, `주소=${await path(page)}`);
        }
        // ② 뒤로 (폰 = 닫기 · 탭 모드는 탭 기록이라 따로 안 잼)
        if (vk === 'phone') {
          await go(page, start); await b.dismissBlockers(page); await sleep(800);
          await openItem(page, item);
          if (await visible(page, OPEN_SEL[item])) {
            await page.goBack().catch(() => null); await sleep(1500);
            const c2 = !(await visible(page, OPEN_SEL[item])); await sleep(1500);
            const c2b = !(await visible(page, OPEN_SEL[item]));
            ok(`${tag} · 뒤로 → 닫힘·다시 안 열림`, c2 && c2b, `닫힘=${c2} 1.5초뒤=${c2b} 주소=${await path(page)}`);
            await page.goForward().catch(() => null); await sleep(1500);
            const f2 = !(await visible(page, OPEN_SEL[item]));
            ok(`${tag} · 앞으로 가도 안 열림`, f2, `주소=${await path(page)}`);
          }
        }
        // ③ 저장 (업무만)
        if (item === 'task') {
          await go(page, start); await b.dismissBlockers(page); await sleep(800);
          await openItem(page, item);
          const inputs = await page.$$('[data-testid="task-create-title"]'); let inp = null;
          for (const h of inputs) { if (await h.evaluate((e) => e.getBoundingClientRect().width > 4)) { inp = h; break; } }
          if (!inp) { ok(`${tag} · 저장 입력칸`, false, '안 보임'); continue; }
          await inp.type(`[확인용] 우하단 업무추가 ${vk} ${start}`);
          await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="task-create-submit"]')).find((e) => e.getBoundingClientRect().width > 4).click()); await sleep(2500);
          const c3 = !(await visible(page, OPEN_SEL[item]));
          ok(`${tag} · 저장 → 닫힘`, c3, `주소=${await path(page)}`);
          if (vk !== 'desktop') {
            await page.goBack().catch(() => null); await sleep(1500);
            const r3 = !(await visible(page, OPEN_SEL[item])); await sleep(1200);
            const r3b = !(await visible(page, OPEN_SEL[item]));
            ok(`${tag} · 저장 뒤 뒤로 → 다시 안 열림`, r3 && r3b, `주소=${await path(page)}`);
          }
        }
      }
    }
    await ctx.close();
  }
  } finally { await browser.close(); }
  return results;
}

module.exports = { name: '우하단 바로 열기 — 모든 항목 열고·닫고·뒤로·저장 뒤 다시 안 열림 (3폭)', run };
