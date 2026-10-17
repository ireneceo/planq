// scripts/e2e/canary-mail-zoom.js — 메일 본문 확대 (전체 화면 [−][100%][+] · 두 손가락)
//
// ★ 2026-10-17 (Irene): *"메일이 너무 작은 글자로 오면 보기가 어려운데 모바일에서 손가락으로 확대 어렵지? 확대기능"*
//   폰은 넓은 뉴스레터를 폭 맞춤으로 0.4배까지 줄이고(mail-frame.js fitWidth), 페이지 확대는 막혀 있다.
//   그래서 본문 iframe 안에서만 배율 = 맞춤 × 사용자 배율을 건다.
//
// 재는 것 — 선언(style)이 아니라 **글자의 실제 화면 높이**까지:
//   ① 폰 375: 넓은 메일 → 전체 화면 → [+] 두 번 → % 150 · zoom = 맞춤×1.5 · 글자 높이 ≈1.5배
//   ② [100%] → 맞춤 배율로 돌아온다
//   ③ 두 손가락 벌리기(CDP 터치 2점) → 배율이 커지고 % 가 따라온다 / 한 손가락 끌기는 배율 불변(음성 대조군)
//   ④ 전체 화면에서 확대해도 **뒤 상세 iframe 높이**는 그대로(전체 화면은 높이 보고를 안 한다)
//   ⑤ 데스크탑 1440: 상세 본문 iframe 에 zoom 이 안 걸린다(확대 안 한 메일의 렌더 불변)
const b = require('./lib/browser');
const { sequelize } = require('/opt/planq/dev-backend/config/database');

const BIZ = Number(process.env.E2E_BUSINESS_ID || 5);

async function frameOf(page, testid) {
  const h = await page.$(`[data-testid="${testid}"]`);
  if (!h) return null;
  return h.contentFrame();
}
async function frameState(fr) {
  return fr.evaluate(() => {
    const de = document.documentElement;
    // 글자의 실제 화면 높이 — 가장 먼저 나오는 보이는 글자 덩어리
    let glyph = null;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!n.textContent || n.textContent.trim().length < 4) continue;
      const r = document.createRange(); r.selectNodeContents(n);
      const rects = r.getClientRects();
      if (rects.length && rects[0].height > 0 && rects[0].width > 0) { glyph = { el: n, h: rects[0].height }; break; }
    }
    // 글자 없는 메일(그림만)이면 첫 그림의 화면 높이로 잰다
    if (!glyph) {
      const img = Array.from(document.images).find((i) => i.getBoundingClientRect().height > 4);
      if (img) glyph = { el: img, h: img.getBoundingClientRect().height };
    }
    if (glyph) window.__zoomProbe = glyph.el;
    return { zoom: parseFloat(de.style.zoom || '') || 1, glyphH: glyph ? glyph.h : null };
  });
}
async function probeH(fr) {
  return fr.evaluate(() => {
    const n = window.__zoomProbe; if (!n) return null;
    if (n.nodeType === 1) return n.getBoundingClientRect().height;
    const r = document.createRange(); r.selectNodeContents(n);
    const rr = r.getClientRects(); return rr.length ? rr[0].height : null;
  });
}
const pct = (page) => page.$eval('[data-testid="mail-zoom-reset"]', (el) => el.textContent.trim()).catch(() => null);

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: msg ? [msg] : [] });
  const unmeasured = (name, why) => results.push({ name, unmeasured: true, details: [why] });

  // 폭 맞춤 축소가 걸리는 넓은 메일(고정폭 7xx)이 있어야 잰 것이다.
  const [rows] = await sequelize.query(
    `SELECT m.thread_id tid FROM email_messages m JOIN email_threads t ON t.id = m.thread_id
      WHERE t.business_id = ? AND m.body_html REGEXP 'width=.?7[0-9]{2}' AND LENGTH(m.body_html) < 60000
        AND (SELECT COUNT(*) FROM email_messages x WHERE x.thread_id = m.thread_id) = 1
      ORDER BY m.id DESC LIMIT 12`, { replacements: [BIZ] });
  if (!rows.length) return [{ name: 'canary-mail-zoom', unmeasured: true, details: ['넓은 메일이 없다 — 판정 불가'] }];
  let tid = rows[0].tid;

  // ── 폰 ──
  {
    const { browser, page } = await b.launch({ mobile: true });
    try {
      // 높이 보고를 보낸 창을 기억한다 — 전체 화면 iframe 이 보낸 높이 보고는 0 건이어야 한다.
      await page.evaluateOnNewDocument(() => {
        window.__frameMsgs = [];
        window.addEventListener('message', (e) => {
          if (e.data && e.data.planqMailFrame) window.__frameMsgs.push({ src: e.source, h: e.data.h });
        });
      });
      await b.login(page);
      // 고정폭 표기만으로는 실제로 넘치는지 모른다 — 폭 맞춤이 실제로 걸린 메일을 찾을 때까지 연다.
      let detailFrame = null; let fit = 1;
      for (const r of rows) {
        await b.goto(page, `/mail?folder=all&thread=${r.tid}`);
        await b.sleep(4000);
        detailFrame = await page.$('[data-testid="mail-body-block"]');
        if (!detailFrame) continue;
        fit = (await frameState(await detailFrame.contentFrame())).zoom;
        tid = r.tid;
        if (fit < 1) break;
      }
      if (!detailFrame) { unmeasured('폰 확대', `상세 본문을 못 찾음 (thread ${tid})`); return results; }
      const detailH0 = await detailFrame.evaluate((el) => el.getBoundingClientRect().height);
      push('폰 넓은 메일은 폭 맞춤으로 줄어 있다(전제)', fit < 1, `맞춤 배율 ${fit} (thread ${tid})`);

      await page.click('[data-testid="mail-fullview"]');
      await b.sleep(1500);
      const ff = await frameOf(page, 'mail-fullview-frame');
      if (!ff) { unmeasured('전체 화면', '전체 화면 iframe 없음'); return results; }
      await b.sleep(800);
      const s0 = await frameState(ff);
      push('전체 화면 처음은 100%', (await pct(page)) === '100%', `표시 ${await pct(page)} · zoom ${s0.zoom}`);

      await page.click('[data-testid="mail-zoom-in"]'); await b.sleep(250);
      await page.click('[data-testid="mail-zoom-in"]'); await b.sleep(500);
      const s1 = await frameState(ff);
      const h1 = await probeH(ff);
      const p1 = await pct(page);
      push('[+] 두 번 → 150%', p1 === '150%', `표시 ${p1}`);
      push('iframe 배율 = 맞춤 × 1.5', Math.abs(s1.zoom - s0.zoom * 1.5) < 0.02, `${s0.zoom} → ${s1.zoom}`);
      const g0 = s0.glyphH;
      push('글자가 실제로 커졌다(화면 높이 ≈1.5배)', g0 && h1 && h1 / g0 > 1.35 && h1 / g0 < 1.65, `글자 높이 ${g0} → ${h1}`);

      await page.click('[data-testid="mail-zoom-reset"]'); await b.sleep(500);
      const s2 = await frameState(ff);
      push('[100%] → 맞춤 배율로 돌아온다', Math.abs(s2.zoom - s0.zoom) < 0.005 && (await pct(page)) === '100%', `zoom ${s2.zoom}`);

      // 두 손가락 벌리기 — iframe 가운데에서 두 점을 60 → 180px 로
      const box = await (await page.$('[data-testid="mail-fullview-frame"]')).boundingBox();
      const cx = box.x + box.width / 2, cy = box.y + Math.min(box.height / 2, 250);
      const cdp = await page.target().createCDPSession();
      const tp = (d) => [{ x: cx - d / 2, y: cy, id: 1 }, { x: cx + d / 2, y: cy, id: 2 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(60) });
      for (let d = 70; d <= 180; d += 10) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(d) });
        await b.sleep(40);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await b.sleep(600);
      const s3 = await frameState(ff);
      const p3 = await pct(page);
      const user3 = s3.zoom / s0.zoom;
      push('두 손가락 벌리기 → 본문 배율이 커진다', user3 > 2, `사용자 배율 ${user3.toFixed(2)} (기대 ≈3)`);
      push('두 손가락 배율이 [%] 표시에 따라온다', p3 === `${Math.round(user3 * 100)}%`, `표시 ${p3}`);

      // 음성 대조군 — 한 손가락 끌기는 스크롤일 뿐 배율 불변
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy + 80, id: 1 }] });
      for (let k = 1; k <= 6; k++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx - k * 10, y: cy + 80 - k * 15, id: 1 }] });
        await b.sleep(30);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await b.sleep(400);
      const s4 = await frameState(ff);
      push('한 손가락 끌기는 배율을 안 바꾼다(음성 대조군)', Math.abs(s4.zoom - s3.zoom) < 0.005, `${s3.zoom} → ${s4.zoom}`);

      const fromFull = await page.evaluate(() => {
        const f = document.querySelector('[data-testid="mail-fullview-frame"]');
        return f ? window.__frameMsgs.filter((m) => m.src === f.contentWindow).length : -1;
      });
      push('전체 화면 본문은 높이 보고를 안 보낸다(뒤 상세와 같은 id)', fromFull === 0, `전체 화면이 보낸 높이 보고 ${fromFull}건`);
      const detailH1 = await page.$eval('[data-testid="mail-body-block"]', (el) => el.getBoundingClientRect().height);
      push('전체 화면 확대가 뒤 상세 iframe 높이를 안 바꾼다', Math.abs(detailH1 - detailH0) < 2, `${detailH0} → ${detailH1}`);
    } finally { try { await browser.close(); } catch { /* ignore */ } }
  }

  // ── 데스크탑 ──
  {
    const { browser, page } = await b.launch();
    try {
      await page.setViewport({ width: 1440, height: 900 });
      await b.login(page);
      await b.goto(page, `/mail?folder=all&thread=${tid}`);
      await b.sleep(4500);
      const df = await frameOf(page, 'mail-body-block');
      if (!df) unmeasured('데스크탑', '상세 본문 없음');
      else {
        const z = await df.evaluate(() => document.documentElement.style.zoom);
        push('데스크탑 상세 본문에 zoom 미설정(렌더 불변)', z === '', `zoom='${z}'`);
      }
    } finally { try { await browser.close(); } catch { /* ignore */ } }
  }
  return results;
}

module.exports = { run, name: 'canary-mail-zoom' };
