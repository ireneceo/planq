// PlanQ 시연 영상 샘플 — 데모 워크스페이스(온무늬)를 실제로 조작하며 CDP 화면 녹화 → 장면별 mp4 → ffmpeg 로 이어 붙임 (2026-10-26)
//
// 선행: dev-backend/.env 의 DEMO_CAPTURE_PASSWORD · `node dev-backend/scripts/seed-demo-workspace.js`(날짜가 «최근» 으로 다시 맞춰진다)
//       ffmpeg — 시스템 ffmpeg 가 없으면 `cd scripts/demo-video && npm i --no-save ffmpeg-static@5.2.0` 또는 FFMPEG=경로
// 실행: node scripts/demo-video/record.js [--only=intro,talk,...]   (장면만 다시 찍을 때 --only, 이어 붙이기만: --assemble)
// 산출: dev-backend/scripts/out/demo-video/planq-demo-sample.mp4 (1920×1080 · 30fps · 무음 트랙)
// 데모 데이터는 읽기만 한다 — 업무 후보 [등록] 등 쓰기 버튼은 커서만 올리고 누르지 않는다.
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { launch, login, goto, gotoSPA, sleep, dismissBlockers, BASE } = require('/opt/planq/scripts/e2e/lib/browser');

const FFMPEG = process.env.FFMPEG || (() => {
  const local = path.join(__dirname, 'node_modules', 'ffmpeg-static', 'ffmpeg');
  return fs.existsSync(local) ? local : 'ffmpeg';
})();
const OUT = path.join(__dirname, '..', '..', 'dev-backend', 'scripts', 'out', 'demo-video');
const OVERLAY = fs.readFileSync(path.join(__dirname, 'overlay.js'), 'utf8');
const PW = process.env.DEMO_CAPTURE_PASSWORD;
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
if (!BASE.startsWith('https://dev.planq.kr')) throw new Error('dev 에서만');
fs.mkdirSync(OUT, { recursive: true });

// ───────── 녹화기 ─────────
async function recorder(page) {
  const cdp = await page.target().createCDPSession();
  let dir = null; let frames = []; let on = false;
  cdp.on('Page.screencastFrame', async (f) => {
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    if (!on) return;
    const file = path.join(dir, String(frames.length).padStart(5, '0') + '.jpg');
    fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
    frames.push({ file, t: f.metadata.timestamp });
  });
  return {
    async start(name) {
      dir = path.join(OUT, 'frames-' + name); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
      frames = []; on = true; this.name = name; this.t0 = Date.now() / 1000;
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
    },
    async stop() {
      const tEnd = Date.now() / 1000;
      await sleep(150); on = false;
      await cdp.send('Page.stopScreencast').catch(() => {});
      // 프레임 표시 시간 = 다음 프레임까지(마지막은 정지 시각까지) → 30fps 고정으로 다시 찍음
      const lines = ['ffconcat version 1.0'];
      frames.forEach((fr, i) => {
        const next = i + 1 < frames.length ? frames[i + 1].t : Math.max(fr.t + 0.04, tEnd - (this.t0 - frames[0].t) * 0);
        const d = Math.max(0.001, Math.min(next - fr.t, 5));
        lines.push(`file '${fr.file}'`, `duration ${d.toFixed(4)}`);
      });
      lines.push(`file '${frames[frames.length - 1].file}'`);
      const list = path.join(dir, 'list.txt'); fs.writeFileSync(list, lines.join('\n'));
      const mp4 = path.join(OUT, `seg-${this.name}.mp4`);
      execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
        '-vf', 'fps=30,scale=1920:1080:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', mp4]);
      const span = frames.length ? (frames[frames.length - 1].t - frames[0].t) : 0;
      console.log(`  ▸ ${this.name}: 프레임 ${frames.length} · ${span.toFixed(1)}s → ${path.basename(mp4)}`);
      return mp4;
    },
  };
}

// ───────── 화면 조작 도우미 ─────────
const inject = (page) => page.evaluate(OVERLAY);
const pq = (page, fn, ...args) => page.evaluate((f, a) => window.__pq[f](...a), fn, args);
async function rectOf(page, text, { within = null, exact = false, nth = 0, minX = 0 } = {}) {
  return page.evaluate((t, w, ex, n, mx) => {
    const root = w ? document.querySelector(w) : document.getElementById('root');
    if (!root) return null;
    const els = [...root.querySelectorAll('*')].filter((e) => {
      if (e.closest('#pqv-layer')) return false;
      const s = (e.textContent || '').trim();
      const own = [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
      return own && (ex ? s === t : s.startsWith(t)) && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().x >= mx;
    });
    const e = els[n]; if (!e) return null;
    const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, text, within, exact, nth, minX);
}
async function rectSel(page, sel) {
  return page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
}
async function rectChat(page, t) {
  return page.evaluate((x) => { const e = [...document.querySelectorAll('[data-qtalk-chat]')].find((el) => el.textContent.includes(x)); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, t);
}
async function moveTo(page, r, { ms = 800, dx = 0.35, dy = 0.5 } = {}) {
  const x = Math.round(r.x + r.w * dx), y = Math.round(r.y + r.h * dy);
  await pq(page, 'move', x, y, ms); await sleep(ms + 80);
  return { x, y };
}
async function clickAt(page, r, opts) {
  const { x, y } = await moveTo(page, r, opts);
  await pq(page, 'press'); await sleep(120);
  await page.mouse.click(x, y); await sleep(200);
}
async function prep(page) {
  await page.evaluate(() => {
    try {
      sessionStorage.setItem('pq_push_prompt_dismiss_session', '1');
      sessionStorage.setItem('pq_pwa_install_dismiss_session', '1');
      localStorage.setItem('pq_pwa_install_dismiss_until', String(Date.now() + 7 * 864e5));
    } catch { /* 무시 */ }
  });
}
async function boot(page, email, route) {
  await login(page, { email, password: PW });
  await prep(page);
  await goto(page, route); await dismissBlockers(page).catch(() => {});
  await inject(page); await sleep(1200);
}

// ───────── 카드(인트로·아웃트로·역할 비교) ─────────
const CARD_HEAD = `<base href="${BASE}/"><meta charset="utf-8"><link rel="preconnect" href="https://fonts.gstatic.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@500;700;800;900&family=Outfit:wght@600;700;800&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box;margin:0}html,body{width:1920px;height:1080px;overflow:hidden}
body{font-family:'Noto Sans KR','Outfit',sans-serif;color:#fff;background:radial-gradient(1200px 800px at 20% 10%,#0F766E 0%,#115E59 40%,#0B3B38 100%);position:relative}
.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(94,234,212,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(94,234,212,.06) 1px,transparent 1px);background-size:64px 64px;mask-image:radial-gradient(900px 600px at 50% 50%,#000,transparent)}
.glow{position:absolute;width:900px;height:900px;border-radius:50%;background:radial-gradient(circle,rgba(45,212,191,.35),transparent 60%);filter:blur(20px);animation:float 8s ease-in-out infinite}
@keyframes float{50%{transform:translate(60px,-40px) scale(1.08)}}
.up{opacity:0;transform:translateY(30px);animation:up .8s cubic-bezier(.2,.8,.2,1) forwards}
@keyframes up{to{opacity:1;transform:none}}
.pop{opacity:0;transform:scale(.9);animation:pop .7s cubic-bezier(.2,1.3,.4,1) forwards}
@keyframes pop{to{opacity:1;transform:none}}
em{font-style:normal;color:#5EEAD4}
</style>`;

const INTRO = `${CARD_HEAD}<div class="grid"></div><div class="glow" style="left:-200px;top:-260px"></div><div class="glow" style="right:-300px;bottom:-400px;animation-delay:-4s"></div>
<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:34px">
  <div class="up" style="animation-delay:.1s;display:inline-flex;gap:12px;align-items:center;padding:12px 24px;border-radius:999px;background:rgba(255,255,255,.1);box-shadow:inset 0 0 0 1px rgba(94,234,212,.35);font:700 26px Outfit,'Noto Sans KR';color:#CCFBF1">
    <span style="width:10px;height:10px;border-radius:50%;background:#5EEAD4;box-shadow:0 0 0 5px rgba(94,234,212,.25)"></span>1분 만에 보는 PlanQ</div>
  <div style="font-weight:900;font-size:96px;line-height:1.18;letter-spacing:-.035em">
    <div class="up" style="animation-delay:.45s">고객 요청, 아직도</div>
    <div class="up" style="animation-delay:.8s"><em>카톡·메일</em>에서 찾고 계세요?</div>
  </div>
  <div class="up" style="animation-delay:1.9s;font-weight:700;font-size:38px;color:#CCFBF1;display:flex;gap:18px;align-items:center">
    대화 <span style="color:#5EEAD4">→</span> 업무 <span style="color:#5EEAD4">→</span> 회의 <span style="color:#5EEAD4">→</span> 청구,
    <img src="planQ_white_new.svg" style="height:46px;margin-left:6px;transform:translateY(2px)"> 하나로</div>
</div>`;

const OUTRO = `${CARD_HEAD}<div class="grid"></div><div class="glow" style="left:50%;top:50%;margin:-450px 0 0 -450px"></div>
<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:40px">
  <img class="pop" src="planQ_white_new.svg" style="height:150px;animation-delay:.15s">
  <div class="up" style="animation-delay:.7s;font-weight:900;font-size:72px;letter-spacing:-.03em">일을 <em>일답게</em> 하다</div>
  <div class="up" style="animation-delay:1.3s;display:flex;gap:16px;align-items:center;padding:20px 40px;border-radius:999px;background:#fff;color:#0F766E;font:800 36px Outfit,'Noto Sans KR';box-shadow:0 20px 60px rgba(0,0,0,.3)">
    planq.kr 에서 시작하기 <span style="font-size:40px">→</span></div>
</div>`;

const splitCard = (ownerB64, clientB64) => `${CARD_HEAD}<div class="grid"></div>
<style>.shot{position:relative;width:880px;border-radius:22px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.12)}
.shot img{display:block;width:880px}
.tag{display:inline-flex;gap:12px;align-items:center;font-weight:800;font-size:34px;margin-bottom:22px}
.tag b{font:800 20px Outfit,'Noto Sans KR';padding:7px 14px;border-radius:999px}
.ring{position:absolute;left:0;top:0;width:180px;height:100%;border:5px solid #5EEAD4;border-radius:6px;box-shadow:0 0 0 9999px rgba(0,0,0,.0);opacity:0;animation:ring .6s ease forwards}
@keyframes ring{to{opacity:1;box-shadow:0 0 0 9999px rgba(8,30,28,.35)}}
.note{margin-top:22px;font-size:28px;font-weight:700;color:#CCFBF1}
</style>
<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:46px">
  <div class="up" style="font-weight:900;font-size:62px;letter-spacing:-.03em">같은 워크스페이스, <em>역할마다 다른 화면</em></div>
  <div style="display:flex;gap:56px">
    <div class="up" style="animation-delay:.5s"><div class="tag">대표 · 김서연 <b style="background:#5EEAD4;color:#0B3B38">관리자</b></div>
      <div class="shot"><img src="data:image/jpeg;base64,${ownerB64}"><div class="ring" style="animation-delay:1.6s"></div></div>
      <div class="note">팀·청구·설정까지 전 메뉴</div></div>
    <div class="up" style="animation-delay:.9s"><div class="tag">고객 · 정민아 <b style="background:#FDE68A;color:#713F12">고객</b></div>
      <div class="shot"><img src="data:image/jpeg;base64,${clientB64}"><div class="ring" style="animation-delay:2s"></div></div>
      <div class="note">자기 프로젝트의 대화·업무·청구서만</div></div>
  </div>
</div>`;

async function recordCard(rec, page, name, html, secs) {
  await page.setContent('<html><body style="background:#0B3B38"></body></html>');
  await rec.start(name);
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await sleep(secs * 1000);
  return rec.stop();
}

// ───────── 장면 ─────────
async function main() {
  const segs = {};
  const { browser, page } = await launch();
  await page.setViewport({ width: 1920, height: 1080 });
  const rec = await recorder(page);

  // 1) 인트로
  if (want('intro')) segs.intro = await recordCard(rec, page, 'intro', INTRO, 4.6);

  // 2~5) 대표(김서연) 화면
  await boot(page, 'capture@demo.planq.kr', '/talk');

  if (want('talk')) {
    await pq(page, 'cursorAt', 1100, 760);
    await rec.start('talk');
    await pq(page, 'chip', 'Q talk · 고객 대화');
    await sleep(400);
    await pq(page, 'caption', '고객과의 대화는 <em>프로젝트 안에서</em>', '흩어진 메신저 대신, 업무 옆에서');
    await sleep(900);
    await clickAt(page, await rectChat(page, '노들커머스'));
    await sleep(1600); await page.evaluate(() => window.__pq.sweep());
    // 고객의 마지막 요청 강조
    const m = await rectOf(page, '좋습니다. 경쟁사 비교');
    await moveTo(page, { x: m.x, y: m.y, w: m.w, h: m.h }, { dx: 0.62, dy: 1.6 });
    await pq(page, 'hideCaption'); await sleep(300);
    await pq(page, 'zoom', m.x + 260, m.y + 10, 1.45); await sleep(1100);
    const m2 = await rectOf(page, '좋습니다. 경쟁사 비교');
    await pq(page, 'spot', m2.x - 70, m2.y - 40, m2.w + 90, m2.h + 50, 12);
    await pq(page, 'caption', '고객 요청이 <em>대화 속에 묻히지 않게</em>');
    await sleep(2600);
    await pq(page, 'spotOff'); await pq(page, 'hideCaption'); await pq(page, 'unzoom'); await sleep(1100);
    // AI 업무 후보 펼치기
    const cand = await rectOf(page, '업무 후보', { minX: 1600 });
    await pq(page, 'caption', 'AI가 대화에서 <em>할 일 후보</em>를 찾아 줍니다');
    await clickAt(page, cand, { dx: 0.3 });
    await sleep(1200);
    const panel = await page.evaluate(() => { const a = [...document.querySelectorAll('aside')].find((e) => e.getBoundingClientRect().x > 1500); const r = a.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    await pq(page, 'zoom', panel.x + panel.w, panel.y + 260, 1.6); await sleep(1100);
    // 확대 뒤 «경쟁사 비교 자료 작성» 후보 카드(실측 좌표) — 등록 버튼 위에 커서만 올린다(누르지 않음)
    const card = await page.evaluate(() => {
      const leaf = [...document.querySelectorAll('aside *')].find((e) => e.getBoundingClientRect().x > 1300 && ((e.value || '') + (e.children.length ? '' : e.textContent)).trim().startsWith('경쟁사 비교 자료'));
      if (!leaf) return null;
      let el = leaf; while (el.parentElement && el.parentElement.getBoundingClientRect().height < 360) el = el.parentElement;
      const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    console.log('    후보 카드', card);
    if (card) {
      await pq(page, 'spot', card.x, card.y, card.w, card.h, 6);
      await moveTo(page, { x: card.x + 40, y: card.y + card.h - 34, w: 1, h: 1 }, { ms: 900 });
    }
    await sleep(2000); await pq(page, 'spotOff'); await pq(page, 'cursorOff');
    await pq(page, 'hideCaption'); await pq(page, 'unzoom'); await sleep(700);
    segs.talk = await rec.stop();
    await page.screenshot({ path: path.join(OUT, 'chk-talk.png') });
  }

  if (want('task')) {
    await pq(page, 'cursorOff'); await pq(page, 'chipOff');
    await gotoSPA(page, '/tasks/workspace'); await sleep(2200); await page.evaluate(() => window.__pq.sweep());
    await pq(page, 'cursorAt', 1200, 820);
    await rec.start('task');
    await pq(page, 'chip', 'Q task · 업무');
    await sleep(300);
    await pq(page, 'caption', '누가 · 언제까지 · 얼마나 했는지 <em>한눈에</em>', '팀 전체 업무와 진행률');
    const row = await rectOf(page, '경쟁사 브랜드 비교표 1장 정리');
    const tbl = await page.evaluate((y) => { const r = { x: 222, y: y - 50, w: 1276, h: 330 }; return r; }, row.y);
    await sleep(700);
    await pq(page, 'spot', tbl.x, row.y - 12, tbl.w - 4, 290, 4);
    await moveTo(page, { x: 1300, y: row.y + 120, w: 1, h: 1 }, { ms: 900 });
    await moveTo(page, { x: 1320, y: row.y, w: 1, h: 10 }, { ms: 700 });
    await sleep(1300);
    await pq(page, 'spotOff'); await pq(page, 'hideCaption');
    await clickAt(page, row, { dx: 0.4 });
    await sleep(1500);
    await pq(page, 'caption', '대화에서 나온 요청이 <em>담당자 있는 업무</em>로');
    const dr = await rectOf(page, '담당자', { exact: true });
    if (dr) { await pq(page, 'zoom', 1915, dr.y + 40, 1.45); await sleep(1100); }
    await pq(page, 'cursorOff');
    await sleep(2700);
    await pq(page, 'hideCaption'); await pq(page, 'unzoom'); await sleep(700);
    segs.task = await rec.stop();
    await page.keyboard.press('Escape'); await sleep(400);
  }

  if (want('note')) {
    await pq(page, 'cursorOff'); await pq(page, 'chipOff');
    await gotoSPA(page, '/notes'); await sleep(2000);
    await page.evaluate(() => { const r = document.querySelector('[data-qnote-session]'); r && r.click(); });
    await sleep(2500); await page.evaluate(() => window.__pq.sweep());
    await pq(page, 'cursorAt', 1300, 700);
    await rec.start('note');
    await pq(page, 'chip', 'Q note · 회의 기록');
    await sleep(300);
    await pq(page, 'caption', '회의는 기록만, <em>요약과 업무</em>는 AI가', '말한 그대로 받아 적고 핵심만 정리');
    await sleep(1200);
    const sum = await rectOf(page, '요약', { exact: true });
    await moveTo(page, { x: 1150, y: sum.y + 58, w: 1, h: 1 });
    await pq(page, 'spot', 540, sum.y - 16, 1360, 100, 6);
    await pq(page, 'cursorOff');
    await sleep(2800);
    await pq(page, 'spotOff'); await pq(page, 'hideCaption'); await sleep(600);
    const q = await rectOf(page, '결과는 언제쯤 공유 가능할까요?');
    if (q) {
      await pq(page, 'caption', '회의 중 받은 질문도 <em>놓치지 않게</em> 표시');
      await moveTo(page, q, { dx: 0.8 }); await pq(page, 'spot', 552, q.y - 24, 1336, q.h + 48, 2);
      await sleep(2600); await pq(page, 'spotOff'); await pq(page, 'hideCaption'); await sleep(500);
    }
    segs.note = await rec.stop();
  }

  let ownerShot = null;
  if (want('bill') || want('split')) {
    await pq(page, 'cursorOff'); await pq(page, 'chipOff');
    await gotoSPA(page, '/bills'); await sleep(2400); await page.evaluate(() => window.__pq.sweep());
  }
  if (want('bill')) {
    await pq(page, 'cursorAt', 1000, 820);
    await rec.start('bill');
    await pq(page, 'chip', 'Q bill · 청구');
    await sleep(300);
    await pq(page, 'caption', '청구 · 수금까지 <em>같은 흐름</em>으로', '미수금과 월별 매출을 자동으로');
    const cards = await rectOf(page, '이번 달 한눈에 보기');
    await sleep(800);
    await pq(page, 'spot', 240, cards.y + 40, 1660, 140, 6);
    await moveTo(page, { x: 860, y: cards.y + 110, w: 1, h: 1 }, { ms: 900 });
    await sleep(1500);
    await pq(page, 'spotOff');
    const chart = await rectOf(page, '월별 매출');
    await pq(page, 'zoom', 790, chart.y + 120, 1.25); await sleep(1100);
    await moveTo(page, { x: 1100, y: chart.y + 140, w: 1, h: 1 }, { ms: 900 });
    await pq(page, 'cursorOff');
    await sleep(1800);
    await pq(page, 'hideCaption'); await pq(page, 'unzoom'); await sleep(800);
    segs.bill = await rec.stop();
  }
  if (want('split')) {
    await pq(page, 'cursorOff'); await pq(page, 'chipOff');
    await gotoSPA(page, '/dashboard'); await sleep(2500); await page.evaluate(() => window.__pq.sweep()); await sleep(300);
    ownerShot = (await page.screenshot({ type: 'jpeg', quality: 92, clip: { x: 0, y: 0, width: 1100, height: 760 } })).toString('base64');
  }
  await browser.close();

  // 6~7) 고객(정민아) 화면 + 역할 비교 카드
  if (want('split') || want('client') || want('outro')) {
    const b2 = await launch(); const p2 = b2.page;
    await p2.setViewport({ width: 1920, height: 1080 });
    const rec2 = await recorder(p2);
    await boot(p2, 'client@demo.planq.kr', '/dashboard');
    await sleep(800); await p2.evaluate(() => window.__pq.sweep());
    const clientShot = (await p2.screenshot({ type: 'jpeg', quality: 92, clip: { x: 0, y: 0, width: 1100, height: 760 } })).toString('base64');
    if (want('client')) {
      await gotoSPA(p2, '/talk'); await sleep(2000); await p2.evaluate(() => window.__pq.sweep());
      await pq(p2, 'cursorAt', 1100, 760);
      await rec2.start('client');
      await pq(p2, 'chip', '고객 화면 · 정민아');
      await sleep(300);
      await pq(p2, 'caption', '고객은 <em>링크 하나로</em> 바로 대화에', '앱 설치 없이, 자기 프로젝트만 보입니다');
      await sleep(900);
      await clickAt(p2, await rectChat(p2, '노들커머스'));
      await sleep(1800); await p2.evaluate(() => window.__pq.sweep());
      await pq(p2, 'cursorOff');
      await sleep(2400);
      await pq(p2, 'hideCaption'); await sleep(600);
      segs.client = await rec2.stop();
    }
    if (want('split') && ownerShot) {
      const page3 = (await b2.browser.newPage()); await page3.setViewport({ width: 1920, height: 1080 });
      const rec3 = await recorder(page3);
      segs.split = await recordCard(rec3, page3, 'split', splitCard(ownerShot, clientShot), 5.2);
    }
    if (want('outro')) {
      const page4 = (await b2.browser.newPage()); await page4.setViewport({ width: 1920, height: 1080 });
      const rec4 = await recorder(page4);
      segs.outro = await recordCard(rec4, page4, 'outro', OUTRO, 4.2);
    }
    await b2.browser.close();
  }
  fs.writeFileSync(path.join(OUT, 'segs.json'), JSON.stringify(segs, null, 1));
  console.log('장면 완료', Object.keys(segs).join(', '));
}

// ───────── 이어 붙이기 — 장면 사이 xfade, 끝에 페이드아웃 ─────────
const ORDER = ['intro', 'talk', 'task', 'note', 'bill', 'split', 'client', 'outro'];
const TRANS = ['fade', 'smoothleft', 'smoothleft', 'smoothleft', 'fadeblack', 'fade', 'fadeblack'];
function duration(file) {
  let out = '';
  try { execFileSync(FFMPEG, ['-i', file], { stdio: 'pipe' }); } catch (e) { out = String(e.stderr || ''); }
  const m = out.match(/Duration: (\d+):(\d+):([\d.]+)/);
  if (!m) throw new Error('길이를 못 읽음: ' + file);
  return +m[1] * 3600 + +m[2] * 60 + +m[3];
}
function assemble() {
  const T = 0.5;
  const files = ORDER.map((k) => path.join(OUT, `seg-${k}.mp4`));
  let off = 0; let prev = '[0:v]'; const parts = [];
  for (let i = 1; i < files.length; i++) {
    off += duration(files[i - 1]) - T;
    parts.push(`${prev}[${i}:v]xfade=transition=${TRANS[i - 1]}:duration=${T}:offset=${off.toFixed(3)}[v${i}]`);
    prev = `[v${i}]`;
  }
  const end = off + duration(files[files.length - 1]);
  parts.push(`${prev}fade=t=out:st=${(end - 0.8).toFixed(3)}:d=0.8[vout]`);
  const mp4 = path.join(OUT, 'planq-demo-sample.mp4');
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', ...files.flatMap((f) => ['-i', f]),
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-filter_complex', parts.join(';'),
    '-map', '[vout]', '-map', `${files.length}:a`, '-shortest',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart',
    '-c:a', 'aac', '-b:a', '96k', mp4]);
  console.log(`완성: ${mp4} · ${duration(mp4).toFixed(1)}s · ${(fs.statSync(mp4).size / 1048576).toFixed(1)}MB`);
}

if (process.argv.includes('--assemble')) assemble();
else main().then(() => { if (ORDER.every((k) => fs.existsSync(path.join(OUT, `seg-${k}.mp4`)))) assemble(); })
  .catch((e) => { console.error(e); process.exit(1); });
