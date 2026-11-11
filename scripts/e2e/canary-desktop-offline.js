// canary-desktop-offline — 데스크탑 앱 2단계 D «연결 끊김 화면»을 실제 앱을 띄워 잰다 (docs/DESKTOP_APP_PHASE2.md).
//   출처를 이 검사가 여는 로컬 포트로 띄운다(개발 실행만 PLANQ_DESKTOP_ORIGIN 을 받는다).
//   ① 아무도 안 듣는 포트 → 덮개(offline.html) 보임 · 덮개에 다리(planqDesktop) 없음
//   ② 서버가 502 → 덮개 그대로(5xx 도 끊김으로 본다) — 대조군: 서버가 떴다는 것만으로 걷히지 않는다
//   ③ 서버가 200 → 10초 타이머 안에 덮개가 걷히고 메인 창이 출처를 띄움
//   ④ «다시 연결» 버튼 → 타이머를 기다리지 않고 바로 붙음
require('./lib/mem-slot');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('/opt/planq/dev-backend/node_modules/puppeteer');

const DESKTOP = '/opt/planq/desktop';
const CDP = 9900 + Math.floor(Math.random() * 300);
const SITE = 18700 + Math.floor(Math.random() * 300);
const ORIGIN = `http://127.0.0.1:${SITE}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 15000, step = 300) {
  const until = Date.now() + ms;
  for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() > until) return null; await sleep(step); }
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => { results.push({ name, fail: ok ? 0 : 1, details: [msg || ''] }); console.log(`${ok ? '✅' : '❌'} ${name} ${msg || ''}`); };
  let mode = 'down'; let server = null;
  const startServer = () => new Promise((res) => {
    server = http.createServer((req, rsp) => {
      if (mode === '502') { rsp.writeHead(502, { 'Content-Type': 'text/html' }); rsp.end('<h1>bad gateway</h1>'); return; }
      rsp.writeHead(200, { 'Content-Type': 'text/html' }); rsp.end('<!doctype html><title>planq-ok</title><body>ok</body>');
    }).listen(SITE, '127.0.0.1', res);
  });
  const electronBin = path.join(DESKTOP, 'node_modules', 'electron', 'dist', 'electron');
  const child = spawn('xvfb-run', ['-a', '-s', '-screen 0 1600x1000x24', electronBin, DESKTOP, `--remote-debugging-port=${CDP}`, '--no-sandbox'], {
    env: { ...process.env, PLANQ_DESKTOP_TEST: '1', PLANQ_DESKTOP_ORIGIN: ORIGIN, ELECTRON_ENABLE_LOGGING: '0' },
    stdio: ['ignore', 'ignore', 'pipe'], detached: true,
  });
  let stderr = ''; child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
  let browser = null;
  const offlinePage = async () => (await browser.pages()).find((p) => p.url().startsWith('file:') && p.url().endsWith('offline.html'));
  try {
    browser = await waitFor(() => puppeteer.connect({ browserURL: `http://127.0.0.1:${CDP}`, defaultViewport: null }), 40000, 1000);
    if (!browser) { push('앱 실행·CDP 연결', false, stderr.slice(-300)); return results; }
    // ①
    const off = await waitFor(offlinePage, 20000);
    push('① 서버 없음 → 연결 끊김 화면', !!off, off ? '' : (await browser.pages()).map((p) => p.url()).join(','));
    if (!off) return results;
    const st = await off.evaluate(() => ({ text: document.body.innerText, bridge: typeof window.planqDesktop }));
    push('① 덮개에 글자 있음 · 다리 없음', st.text.length > 10 && st.bridge === 'undefined', JSON.stringify(st).slice(0, 160));
    // ②
    mode = '502'; await startServer();
    await sleep(13000);
    push('② 502 응답 → 덮개 그대로(대조군)', !!(await offlinePage()), '');
    // ③
    mode = 'ok';
    const back = await waitFor(async () => {
      if (await offlinePage()) return null;
      const m = (await browser.pages()).find((p) => p.url().startsWith(ORIGIN));
      return m && (await m.title()) === 'planq-ok' ? m : null;
    }, 16000);
    push('③ 200 → 10초 타이머로 덮개 걷힘 · 메인 창 출처', !!back, '');
    // ④ 다시 끊고 버튼
    if (back) {
      mode = 'down'; await new Promise((r) => server.close(r)); server.closeAllConnections?.();
      await back.reload().catch(() => null);
      const off2 = await waitFor(offlinePage, 15000);
      push('④ 다시 끊김 → 덮개', !!off2, '');
      if (off2) {
        mode = 'ok'; await startServer();
        const t0 = Date.now();
        await off2.click('#b').catch(() => null);
        const back2 = await waitFor(async () => !(await offlinePage()), 6000, 200);
        push('④ «다시 연결» 누름 → 바로 붙음', !!back2, `${Date.now() - t0}ms`);
      }
    }
  } finally {
    try { if (browser) browser.disconnect(); } catch { /* */ }
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* */ }
    try { server && server.close(); } catch { /* */ }
  }
  return results;
}

module.exports = { run, name: 'desktop-offline' };
if (require.main === module) run().then((r) => { const f = r.filter((x) => x.fail).length; console.log(`FAIL ${f}/${r.length}`); process.exit(f ? 1 : 0); });
