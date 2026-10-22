// canary-phone-footer — 폰 전면 패널·팝업의 버튼 줄은 화면에 고정하지 않는다 (2026-10-22)
//
//   Irene: "일정 추가할 때 모바일에서 푸터가 이상하게 높게 나오고 아래 뚫려서 뒤 내용 스크롤 하면 다 보여서 …
//           모바일에서는 모든 고정푸터 다 고정 안해야 하는 거 아니야?? 제대로된 ui 체크하고 모두 통일해"
//   재는 것 — 일정 추가(CreateDrawer) · 업무 추가(CreateDrawer) · AI 업무추가(자체 모달 phoneSheetFlow) ×
//     폰 390·360: ① 내용이 넘치면 버튼 줄은 내용 뒤(화면 밖) ② 끝까지 내리면 버튼 줄이 보이고 눌림 · 머리는 위에 붙음
//                 ③ 키보드 흉내(--vvh 480) — 버튼 줄이 키보드 위에 뜨지 않음 ④ 패널 아래 틈이 흰색(스크린샷 픽셀)
//     태블릿 834·데스크탑 1440: 버튼 줄 바닥 고정 그대로(회귀 없음)
//   ★ 음성 대조군: 고치기 전 빌드에서 폰 ③④ 12건이 실패했다(버튼 줄 411~480px · 아래 픽셀 전부 뒤 화면).
const b = require('/opt/planq/scripts/e2e/lib/browser');
const sharp = require('/opt/planq/dev-backend/node_modules/sharp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const VPS = [
  { key: '폰390', vp: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }, phone: true },
  { key: '폰360', vp: { width: 360, height: 740, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }, phone: true },
  { key: '태블릿834', vp: { width: 834, height: 1112, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }, phone: false },
  { key: '데스크탑1440', vp: { width: 1440, height: 900 }, phone: false },
];
const CASES = [
  { key: '일정 추가', path: '/calendar', open: 'calendar-new-event' },
  { key: '업무 추가', path: '/tasks', open: 'task-add-btn' },
  { key: 'AI 업무추가', path: '/tasks', open: 'qtask-ai-open' },
];
async function measure(page) {
  return page.evaluate(() => {
    const ds = [...document.querySelectorAll('[aria-modal="true"]')].filter(e => e.getBoundingClientRect().height > 50);
    const d = ds[ds.length - 1]; if (!d) return null;
    const foot = d.lastElementChild, head = d.firstElementChild;
    const R = (e) => { const r = e.getBoundingClientRect(); return { t: Math.round(r.top), b: Math.round(r.bottom) }; };
    const fr = R(foot), dr = R(d), hr = R(head);
    const fc = document.elementFromPoint(d.getBoundingClientRect().right - 30, Math.min(fr.b - 4, innerHeight - 2));
    return { dlg: dr, foot: fr, head: hr, ovf: getComputedStyle(d).overflowY, sh: d.scrollHeight, ch: d.clientHeight, st: Math.round(d.scrollTop),
      footHit: !!fc && foot.contains(fc), footPos: getComputedStyle(foot).position, inner: innerHeight };
  });
}
async function scrollEnd(page) { await page.evaluate(() => { const ds = [...document.querySelectorAll('[aria-modal="true"]')]; const d = ds[ds.length-1]; d.scrollTop = 1e6; d.querySelectorAll('*').forEach(e => { if (e.scrollHeight > e.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(e).overflowY)) e.scrollTop = 1e6; }); }); await sleep(250); }
async function whiteBelow(page, y0) {
  const buf = await page.screenshot();
  const img = sharp(buf); const meta = await img.metadata();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  let nonWhite = 0, n = 0;
  for (let y = y0 + 4; y < info.height - 2; y += 6) for (let x = 10; x < info.width - 10; x += 12) {
    const i = (y * info.width + x) * info.channels; n++;
    if (data[i] < 245 || data[i+1] < 245 || data[i+2] < 245) nonWhite++;
  }
  return { n, nonWhite };
}
async function run() {
  const results = [];
  const ok = (name, cond, info) => results.push({ name, fail: cond ? 0 : 1, details: [info ? JSON.stringify(info) : ''] });
  let browser = null;
  try {
  browser = (await b.launch()).browser;
  for (const v of VPS) {
    const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
    await page.setViewport(v.vp); if (v.vp.isMobile) await page.setUserAgent(UA);
    await b.login(page);
    for (const c of CASES) {
      await b.goto(page, c.path); await b.dismissBlockers(page); await sleep(900);
      await page.evaluate((id) => document.querySelector(`[data-testid="${id}"]`)?.click(), c.open);
      let m = null; for (let i = 0; i < 15 && !m; i++) { await sleep(300); m = await measure(page); }
      const tag = `${v.key} · ${c.key}`;
      if (!m) { ok(`${tag} 열림`, false); continue; }
      const overflow = m.sh > m.ch + 2;
      if (v.phone) {
        // ① 처음: 내용이 넘치면 버튼 줄은 화면 밖(내용 뒤) · 안 넘치면 바닥
        ok(`${tag} ① 버튼 줄 고정 안 됨(넘침=${overflow})`, overflow ? m.foot.t >= m.dlg.b - 1 : Math.abs(m.foot.b - m.dlg.b) <= 1, m);
        await scrollEnd(page); const e = await measure(page);
        ok(`${tag} ② 끝까지 내리면 버튼 줄 보임·눌림 · 머리 위에 붙음`, e.foot.b <= e.dlg.b + 1 && e.footHit && Math.abs(e.head.t - e.dlg.t) <= 1, e);
        // ③ 키보드 흉내 — 보이는 높이 480
        await page.evaluate(() => { const d=[...document.querySelectorAll('[aria-modal="true"]')].pop(); d.scrollTop = 0; document.documentElement.style.setProperty('--vvh', '480px'); document.body.setAttribute('data-keyboard-up', '1'); });
        await sleep(300); const k = await measure(page);
        ok(`${tag} ③ 키보드 위에 버튼 줄이 뜨지 않음`, k.foot.t >= k.dlg.b - 1, k);
        const w = await whiteBelow(page, k.dlg.b);
        ok(`${tag} ④ 패널 아래 틈이 흰색(뒤 화면 안 비침)`, w.nonWhite === 0, w);
        await page.evaluate(() => { document.documentElement.style.setProperty('--vvh', innerHeight + 'px'); document.body.removeAttribute('data-keyboard-up'); });
      } else {
        ok(`${tag} ① (넓은 화면) 버튼 줄 바닥 고정 그대로`, Math.abs(m.foot.b - m.dlg.b) <= 1 && m.footHit, m);
      }
      await page.keyboard.press('Escape'); await sleep(400);
      await page.keyboard.press('Escape'); await sleep(300);
    }
    await ctx.close();
  }
  } catch (e) {
    ok('오류', false, e.message.slice(0, 200));
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  return results;
}

module.exports = { name: '폰 전면 패널·팝업 버튼 줄 고정 안 함 — 키보드 위에 안 뜸·아래 틈 흰색·넓은 화면은 그대로', run };
