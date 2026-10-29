// 시연 영상 녹화기 v2 — 데모 워크스페이스(온무늬)를 실제로 조작하며 **깨끗한 화면만** 2배 해상도로 녹화한다.
//   자막·커서·확대·스포트라이트는 화면에 굽지 않는다 → 이벤트 기록(shot.json)으로 남기고 Remotion 이 그린다.
//   (v1 scripts/demo-video/record.js 는 화면에 HTML 을 주입해 구웠다 — 가로/세로를 같은 소스로 못 만들고, 확대가 화질을 깎았다.)
//
// 선행: dev-backend/.env DEMO_CAPTURE_PASSWORD · `node dev-backend/scripts/seed-demo-workspace.js`(날짜를 오늘 기준으로)
// 실행: node video-engine/capture/record.js [--only=talk,task-m,...]
// 산출: video-engine/out/shots/<id>/raw.mp4 (30fps CFR · 장치 픽셀) + shot.json(뷰포트·이벤트)
// 데모 데이터는 읽기만 한다 — 쓰기 버튼은 커서만 올리고 누르지 않는다.
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env', quiet: true });
const fs = require('fs');
const path = require('path');
const { ff, probe } = require('../lib/ffmpeg');
const { launch, login, goto, gotoSPA, sleep, dismissBlockers, BASE } = require('/opt/planq/scripts/e2e/lib/browser');

const OUT = path.join(__dirname, '..', 'out', 'shots');
const PW = process.env.DEMO_CAPTURE_PASSWORD;
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
if (!BASE.startsWith('https://dev.planq.kr')) throw new Error('dev 에서만');
if (!PW) throw new Error('DEMO_CAPTURE_PASSWORD 없음');

const DESKTOP = { width: 1600, height: 900, deviceScaleFactor: 2 };
const MOBILE = { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ACCOUNTS = { owner: 'capture@demo.planq.kr', client: 'client@demo.planq.kr' };

// ───────── 녹화 + 이벤트 기록 ─────────
// 시각은 모두 «녹화 첫 프레임 = 0초» 기준 초. 화면 프레임(CDP timestamp)과 이벤트(Date.now)는 같은 벽시계다.
async function session(page, vp) {
  const cdp = await page.target().createCDPSession();
  let st = null;
  cdp.on('Page.screencastFrame', (f) => {
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    if (!st || !st.on) return;
    const file = path.join(st.dir, 'frames', String(st.frames.length).padStart(5, '0') + '.jpg');
    fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
    st.frames.push({ file, t: f.metadata.timestamp });
  });
  const now = () => Date.now() / 1000 - st.t0;
  const api = {
    async start(id, meta = {}) {
      const dir = path.join(OUT, id);
      fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(path.join(dir, 'frames'), { recursive: true });
      st = { id, dir, frames: [], events: [], on: true, t0: Date.now() / 1000, meta };
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 93, maxWidth: vp.width * vp.deviceScaleFactor, maxHeight: vp.height * vp.deviceScaleFactor });
      await sleep(250);
      // 첫 프레임이 실제 시작점 — 그 전에 쌓인 이벤트 시각을 보정한다
      if (st.frames.length) { const shift = st.frames[0].t - st.t0; st.t0 = st.frames[0].t; st.events.forEach((e) => { e.t -= shift; }); }
    },
    ev(type, data = {}) { const e = { type, t: +now().toFixed(3), ...data }; st.events.push(e); return e; },
    async stop() {
      const tEnd = Date.now() / 1000;
      await sleep(120); st.on = false;
      await cdp.send('Page.stopScreencast').catch(() => {});
      const { frames, dir } = st;
      if (!frames.length) throw new Error(`${st.id}: 프레임 0`);
      const lines = ['ffconcat version 1.0'];
      frames.forEach((fr, i) => {
        const next = i + 1 < frames.length ? frames[i + 1].t : tEnd;
        lines.push(`file '${fr.file}'`, `duration ${Math.max(0.001, Math.min(next - fr.t, 10)).toFixed(4)}`);
      });
      lines.push(`file '${frames[frames.length - 1].file}'`);
      fs.writeFileSync(path.join(dir, 'list.txt'), lines.join('\n'));
      const W = vp.width * vp.deviceScaleFactor, H = vp.height * vp.deviceScaleFactor;
      const mp4 = path.join(dir, 'raw.mp4');
      ff(['-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'),
        '-vf', `fps=30,scale=${W}:${H}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '15', '-g', '30', mp4]);
      fs.rmSync(path.join(dir, 'frames'), { recursive: true, force: true }); fs.rmSync(path.join(dir, 'list.txt'));
      const p = probe(mp4);
      const shot = {
        id: st.id, file: 'raw.mp4', duration: +p.duration.toFixed(3), fps: 30,
        viewport: { width: vp.width, height: vp.height, dpr: vp.deviceScaleFactor, mobile: !!vp.isMobile },
        pixels: { width: p.width, height: p.height }, recordedAt: new Date().toISOString(), ...st.meta, events: st.events,
      };
      fs.writeFileSync(path.join(dir, 'shot.json'), JSON.stringify(shot, null, 1));
      console.log(`  ▸ ${st.id}: ${frames.length} 프레임 · ${shot.duration}s · ${p.width}×${p.height} · 이벤트 ${st.events.length}`);
      return shot;
    },
  };
  return api;
}

// ───────── 화면 조작 — 실제 마우스를 움직이며 같은 경로를 이벤트로 남긴다 ─────────
function mk(page, rec, vp) {
  let cur = { x: vp.width * 0.62, y: vp.height * 0.7 };
  const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
  const h = {
    page, vp,
    async rectOf(text, { within = null, exact = false, nth = 0, minX = 0, maxX = 1e9 } = {}) {
      return page.evaluate((t, w, ex, n, mx, Mx) => {
        const root = w ? document.querySelector(w) : document.body;
        if (!root) return null;
        const els = [...root.querySelectorAll('*')].filter((e) => {
          const s = (e.textContent || '').trim();
          const own = [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
          const r = e.getBoundingClientRect();
          return own && (ex ? s === t : s.startsWith(t)) && r.width > 0 && r.x >= mx && r.x <= Mx;
        });
        const e = els[n]; if (!e) return null;
        const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
      }, text, within, exact, nth, minX, maxX);
    },
    async rectSel(sel, pick = 'first') {
      return page.evaluate((s, p) => {
        const all = [...document.querySelectorAll(s)].filter((e) => e.getBoundingClientRect().width > 0);
        const e = p === 'last' ? all[all.length - 1] : all[0]; if (!e) return null;
        const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
      }, sel, pick);
    },
    // 문자열을 포함한 요소를 위로 올라가며 maxH 를 넘지 않는 가장 큰 블록(카드·행)
    async blockOf(text, { maxH = 300, maxW = 2000, minX = 0 } = {}) {
      return page.evaluate((t, mH, mW, mx) => {
        const leaf = [...document.querySelectorAll('body *')].find((e) => {
          const own = [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim().startsWith(t));
          return own && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().x >= mx;
        });
        if (!leaf) return null;
        let el = leaf;
        while (el.parentElement) { const r = el.parentElement.getBoundingClientRect(); if (r.height > mH || r.width > mW) break; el = el.parentElement; }
        const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
      }, text, maxH, maxW, minX);
    },
    async move(x, y, ms = 800) {
      const from = { ...cur }; const to = { x: Math.round(x), y: Math.round(y) };
      rec.ev('move', { from, to, dur: ms / 1000 });
      if (!vp.isMobile) {
        const steps = Math.max(6, Math.round(ms / 33));
        for (let i = 1; i <= steps; i++) {
          const u = ease(i / steps);
          await page.mouse.move(from.x + (to.x - from.x) * u, from.y + (to.y - from.y) * u);
          await sleep(ms / steps);
        }
      } else await sleep(ms);
      cur = to;
    },
    async moveTo(r, { ms = 800, dx = 0.5, dy = 0.5 } = {}) { await h.move(r.x + r.w * dx, r.y + r.h * dy, ms); return { ...cur }; },
    async click(r, opts = {}) {
      if (r) await h.moveTo(r, opts);
      rec.ev('click', { x: cur.x, y: cur.y });
      await sleep(90);
      if (vp.isMobile) await page.touchscreen.tap(cur.x, cur.y); else await page.mouse.click(cur.x, cur.y);
      await sleep(250);
    },
    // 강조 구간 — Remotion 이 이 사각형으로 확대·스포트라이트를 건다(시작 이벤트 + 끝 이벤트)
    focus(r, { label = '', pad = 12, zoom = true, spot = true } = {}) {
      return rec.ev('focus', { rect: { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 }, label, zoom, spot });
    },
    unfocus() { return rec.ev('unfocus'); },
    // 대본이 자막을 붙일 수 있는 지점 표시(이 장면에서 무엇을 보여 주는지)
    beat(key, text) { return rec.ev('beat', { key, text }); },
    async scroll(dy, ms = 900, sel = null) {
      rec.ev('scroll', { dy, dur: ms / 1000 });
      const steps = Math.max(8, Math.round(ms / 40));
      for (let i = 0; i < steps; i++) {
        if (vp.isMobile || sel) {
          await page.evaluate((d, s) => {
            const pick = () => {
              if (s) return document.querySelector(s);
              // 화면 가운데 요소에서 위로 올라가며 처음 만나는 스크롤 영역
              let e = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
              while (e && e !== document.body) {
                const cs = getComputedStyle(e);
                if (/(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 20) return e;
                e = e.parentElement;
              }
              return document.scrollingElement;
            };
            const el = pick(); el.scrollBy(0, d);
          }, dy / steps, sel);
        } else await page.mouse.wheel({ deltaY: dy / steps });
        await sleep(ms / steps);
      }
    },
    // 내용이 뜰 때까지 기다림 — 걸린 만큼을 «기다림» 으로 남겨 편집에서 빨리 감는다
    async waitFor(fn, arg, { timeout = 8000, label = 'load', settle = 300 } = {}) {
      const e = rec.ev('wait', { dur: 0, label }); const t0 = Date.now();
      await page.waitForFunction(fn, { timeout, polling: 100 }, arg).catch(() => {});
      await sleep(settle); e.dur = (Date.now() - t0) / 1000; return e;
    },
    // 기다림(로딩·애니메이션) — 편집에서 빨리 감는다
    async wait(ms, label = '') { const e = rec.ev('wait', { dur: ms / 1000, label }); await sleep(ms); return e; },
    hold: (ms) => sleep(ms),
  };
  return h;
}

async function boot(vp, who, route) {
  const { browser, page } = await launch();
  await page.setViewport(vp);
  if (vp.isMobile) await page.setUserAgent(MOBILE_UA);
  await login(page, { email: ACCOUNTS[who], password: PW });
  await page.evaluate(() => {
    try {
      sessionStorage.setItem('pq_push_prompt_dismiss_session', '1');
      sessionStorage.setItem('pq_pwa_install_dismiss_session', '1');
      localStorage.setItem('pq_pwa_install_dismiss_until', String(Date.now() + 7 * 864e5));
    } catch { /* 무시 */ }
  });
  await goto(page, route); await dismissBlockers(page).catch(() => {});
  await sleep(1200);
  // 공지 띠(약관·처리방침 개정 등)는 영상에 남지 않게 닫는다 — 닫기를 누르면 localStorage 에 남아 다음 화면에도 안 뜬다
  await page.evaluate(() => {
    const link = [...document.querySelectorAll('a')].find((a) => /자세히 보기/.test(a.textContent || ''));
    const bar = link && link.closest('div');
    const btn = bar && (bar.parentElement || bar).querySelector('button[aria-label]');
    if (btn) btn.click();
  });
  await sleep(500);
  return { browser, page };
}

// «고객이 아직 이 대화를 볼 수 없습니다» 안내는 대화방마다 [나중에] 로 닫힌다(localStorage) — 녹화 전에 한 번 열어 닫아 둔다
async function dismissGuestPrompt(page, route) {
  const opened = await page.evaluate(() => { const e = [...document.querySelectorAll('[data-qtalk-chat]')].find((el) => el.textContent.includes('노들커머스')); if (e) e.click(); return !!e; });
  if (!opened) return;
  await sleep(1500);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '나중에'); if (b) b.click(); });
  await sleep(400);
  await goto(page, route); await sleep(1200);
}

// 대화방을 미리 열어 내용이 다 뜬 상태에서 녹화를 시작한다(로딩 뼈대·빈 상태가 영상에 들어가지 않게 — Fable A 점검 1번)
async function openChat(page) {
  await page.evaluate(() => { const e = [...document.querySelectorAll('[data-qtalk-chat]')].find((el) => el.textContent.includes('노들커머스')); if (e) e.click(); });
  await page.waitForFunction(() => document.body.innerText.includes('방금 자료실에'), { timeout: 10000, polling: 100 }).catch(() => {});
  await sleep(900);
}

// ───────── 장면 라이브러리 ─────────
// ★ beat 는 «동작 결과가 화면에 보이는 시각» 에 찍는다(누르기 전이 아니라 펼쳐진 뒤) — 자막이 화면에 없는 것을 말하지 않게.
// 각 장면: id · 설명(대본 AI 가 고를 때 보는 문장) · 장치 · 역할 · 녹화 함수.
// beat 키는 대본이 자막을 붙이는 자리다(«무엇을 보여 주는 순간인가»).
const SHOTS = [
  {
    id: 'talk-d', device: 'desktop', who: 'owner', route: '/talk',
    desc: 'Q talk 데스크탑 — 고객(노들커머스) 대화방을 열고, 대화 속 고객 요청을 강조한 뒤, AI 가 대화에서 찾은 «업무 후보» 패널을 연다.',
    beats: { open: '고객 대화방 열기', request: '대화 속 고객 요청 강조', ai: 'AI 업무 후보 패널', candidate: '후보 카드 하나 강조(등록 직전)' },
    async prep(page) { await dismissGuestPrompt(page, this.route); await openChat(page); },
    async run(h) {
      h.beat('open'); await h.move(1000, 520, 900); await h.hold(900);
      const m = await h.blockOf('좋습니다. 경쟁사 비교', { maxH: 140, maxW: 760 });
      if (m) { await h.moveTo(m, { dx: 0.7, dy: 0.5, ms: 900 }); h.beat('request'); h.focus(m, { label: '고객 요청', pad: 14 }); await h.hold(2600); h.unfocus(); await h.hold(500); }
      const cand = await h.rectOf('업무 후보', { minX: 1200 });
      await h.click(cand, { dx: 0.3 });
      await h.wait(1100, 'panel');
      h.beat('ai');
      const card = await h.page.evaluate(() => {
        const leaf = [...document.querySelectorAll('aside *')].find((e) => e.getBoundingClientRect().x > 1000 && ((e.value || '') + (e.children.length ? '' : e.textContent)).trim().startsWith('경쟁사 비교 자료'));
        if (!leaf) return null;
        let el = leaf; while (el.parentElement && el.parentElement.getBoundingClientRect().height < 360) el = el.parentElement;
        const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      if (card) {
        h.beat('candidate'); h.focus(card, { label: 'AI 업무 후보', pad: 8 });
        await h.moveTo({ x: card.x + 40, y: card.y + card.h - 30, w: 1, h: 1 }, { ms: 900 });
        await h.hold(2400); h.unfocus();
      }
      await h.hold(700);
    },
  },
  {
    id: 'task-d', device: 'desktop', who: 'owner', route: '/tasks/workspace',
    desc: 'Q task 데스크탑 — 팀 전체 업무 목록(담당자·마감·진행률)을 훑고, 업무 하나를 눌러 오른쪽 상세(담당자·일정·진행률)를 연다.',
    beats: { list: '팀 업무 목록 — 담당·마감·진행률', open: '업무 상세 열기', detail: '상세의 담당자·진행률 강조' },
    async run(h) {
      h.beat('list');
      const row = await h.rectOf('경쟁사 브랜드 비교표 1장 정리');
      const table = row ? { x: 200, y: row.y - 60, w: h.vp.width - 220, h: 340 } : null;
      if (table) { h.focus(table, { label: '업무 목록', zoom: false, pad: 0 }); }
      await h.move(1100, row ? row.y + 140 : 500, 1000); await h.move(1250, row ? row.y + 8 : 400, 800);
      await h.hold(1600); h.unfocus();
      await h.click(row, { dx: 0.35 });
      await h.wait(1300, 'drawer');
      h.beat('open');
      const lab = await h.rectOf('담당자', { exact: true, minX: 900 });
      if (lab) {
        h.beat('detail');
        const blk = { x: lab.x - 10, y: lab.y - 10, w: h.vp.width - lab.x - 10, h: 220 };
        h.focus(blk, { label: '담당자·진행률', pad: 4 });
        await h.moveTo({ x: lab.x + 220, y: lab.y + 14, w: 1, h: 1 }, { ms: 900 });
        await h.hold(2600); h.unfocus();
      }
      await h.hold(600);
    },
    async after(page) { await page.keyboard.press('Escape'); },
  },
  {
    id: 'note-d', device: 'desktop', who: 'owner', route: '/notes',
    desc: 'Q note 데스크탑 — 회의 기록을 열어 AI 요약과, 회의 중 받은 질문 표시를 보여 준다.',
    beats: { summary: 'AI 회의 요약', question: '회의 중 받은 질문 표시' },
    async prep(page) { await page.evaluate(() => { const r = document.querySelector('[data-qnote-session]'); r && r.click(); }); await sleep(2600); },
    async run(h) {
      await h.hold(400);
      const sum = await h.rectOf('요약', { exact: true });
      if (sum) {
        h.beat('summary');
        const blk = await h.page.evaluate((y) => ({ x: 470, y: y - 14, w: 1100, h: 150 }), sum.y);
        h.focus(blk, { label: 'AI 요약' });
        await h.moveTo({ x: 1000, y: sum.y + 60, w: 1, h: 1 }, { ms: 900 });
        await h.hold(2600); h.unfocus(); await h.hold(400);
      }
      const q = await h.rectOf('결과는 언제쯤 공유 가능할까요?');
      if (q) {
        h.beat('question');
        h.focus({ x: q.x - 40, y: q.y - 18, w: Math.min(1120, q.w + 300), h: q.h + 36 }, { label: '받은 질문', pad: 0 });
        await h.moveTo(q, { dx: 0.9, ms: 900 });
        await h.hold(2400); h.unfocus();
      }
      await h.hold(500);
    },
  },
  {
    id: 'bill-d', device: 'desktop', who: 'owner', route: '/bills',
    desc: 'Q bill 데스크탑 — 이번 달 청구·수금 요약 카드와 월별 매출 그래프.',
    beats: { cards: '이번 달 청구·수금·미수금 카드', chart: '월별 매출 그래프' },
    async run(h) {
      await h.hold(400);
      const cards = await h.rectOf('이번 달 한눈에 보기');
      if (cards) {
        h.beat('cards'); h.focus({ x: 230, y: cards.y + 34, w: h.vp.width - 260, h: 150 }, { label: '이번 달', pad: 0 });
        await h.move(760, cards.y + 110, 900); await h.hold(2200); h.unfocus();
      }
      const chart = await h.rectOf('월별 매출');
      if (chart) {
        h.beat('chart'); h.focus({ x: chart.x - 20, y: chart.y - 16, w: 760, h: 300 }, { label: '월별 매출', pad: 0 });
        await h.move(chart.x + 420, chart.y + 160, 1000); await h.hold(2400); h.unfocus();
      }
      await h.hold(500);
    },
  },
  {
    id: 'client-d', device: 'desktop', who: 'client', route: '/talk',
    desc: '고객(정민아) 데스크탑 — 고객은 자기 프로젝트 대화만 보인다. 링크 하나로 들어와 바로 대화.',
    beats: { client: '고객 화면 — 자기 프로젝트만' },
    async prep(page) { await dismissGuestPrompt(page, this.route); await openChat(page); },
    async run(h) {
      h.beat('client'); await h.hold(400);
      await h.move(1000, 600, 900); await h.hold(2400);
    },
  },
  {
    id: 'talk-m', device: 'mobile', who: 'client', route: '/talk',
    desc: 'Q talk 휴대폰(고객) — 고객이 휴대폰에서 대화방을 열어 우리 팀과 대화. 앱 설치 없이 링크로.',
    beats: { open: '고객이 휴대폰에서 연 대화방(대화 내용 보임)', read: '최근 대화 읽기' },
    async prep(page) { await dismissGuestPrompt(page, this.route); await openChat(page); },
    async run(h) {
      h.beat('open'); await h.hold(2200);
      const last = await h.blockOf('좋습니다. 경쟁사 비교', { maxH: 140, maxW: 380 });
      h.beat('read');
      if (last) { h.focus(last, { label: '최근 요청', pad: 8 }); await h.hold(2400); h.unfocus(); }
      await h.hold(900);
    },
  },
  {
    id: 'task-m', device: 'mobile', who: 'owner', route: '/tasks',
    desc: 'Q task 휴대폰(대표) — 이동 중에도 내 업무 목록과 진행 상황을 확인.',
    beats: { list: '휴대폰 내 업무 목록', open: '업무 하나 열기' },
    async run(h) {
      h.beat('list'); await h.hold(900);
      await h.scroll(380, 1300); await h.hold(700); await h.scroll(-380, 900); await h.hold(500);
      const row = await h.rectOf('경쟁사 브랜드 비교표') || await h.rectOf('월간 운영 리포트');
      if (row) { await h.click(row, { dx: 0.4 }); await h.wait(1400, 'drawer'); h.beat('open'); await h.hold(1600); await h.scroll(300, 1000); await h.hold(900); }
    },
  },
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const list = SHOTS.filter((s) => !ONLY.length || ONLY.includes(s.id));
  for (const s of list) {
    const vp = s.device === 'mobile' ? MOBILE : DESKTOP;
    const { browser, page } = await boot(vp, s.who, s.route);
    try {
      if (s.prep) await s.prep(page);
      const rec = await session(page, vp);
      const h = mk(page, rec, vp);
      await rec.start(s.id, { device: s.device, who: s.who, route: s.route, desc: s.desc, beats: s.beats });
      await s.run(h, rec);
      await rec.stop();
      if (s.after) await s.after(page).catch(() => {});
    } finally { await browser.close(); }
  }
  // 장면 목록(대본 AI 가 읽는다)
  const catalog = SHOTS.map((s) => ({ id: s.id, device: s.device, who: s.who, desc: s.desc, beats: s.beats }));
  fs.writeFileSync(path.join(__dirname, 'catalog.json'), JSON.stringify(catalog, null, 1));
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { SHOTS };
