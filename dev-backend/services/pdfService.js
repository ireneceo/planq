// PDF Service — Puppeteer 싱글톤 (Phase E1, 자가복구 강화)
//
// 사용 패턴:
//   const pdf = await renderPdfFromHtml('<html>...</html>', { format: 'A4' });
//   res.setHeader('Content-Type', 'application/pdf');
//   res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
//   res.send(pdf);
//
// 설계:
//   - Browser 1회 launch (서버 lifetime) + 매 PDF 새 page (개별 컨텍스트).
//   - 🔴 자가복구: chrome 가 죽으면(--single-process 메모리 압박/OOM) 옛 싱글톤은 죽은 browser 를
//     영구 재사용 → newPage 가 protocolTimeout(30s) 행 → 모든 PDF(청구서·문서·포스트·보고서) 500.
//     → disconnected 이벤트로 싱글톤 리셋 + connected 체크 + render 시 1회 재launch 재시도.

const puppeteer = require('puppeteer');

let browserPromise = null;
// disconnected 핸들러가 "현재 활성 browser 인지" 확인하기 위한 참조
// (race 시 옛 browser 의 disconnect 가 새 browserPromise 를 지우지 않도록)
let activeBrowser = null;

async function launch() {
  const browser = await puppeteer.launch({
    headless: 'new',
    protocolTimeout: 60000, // 죽은 browser 무한 행 방지 (default 180s 너무 김)
    // ★ 종료 신호는 server.js 한 곳이 받는다 (Fable 2026-09-11 FAIL).
    //   puppeteer 기본값 handleSIGINT:true 는 SIGINT(PM2 재시작 신호)를 받자마자 Chrome 그룹을 죽이고 **동기로
    //   process.exit(130)** 한다(@puppeteer/browsers launch.js). 그래서 server.js 의 closeBrowser·server.close 는
    //   한 번도 돌지 않았고 PM2 로그 종료코드가 늘 130 이었다. 끄면 server.js 가 closeBrowser 를 끝까지 기다린 뒤 exit(0).
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      // ★ `--single-process` 를 쓰지 않는다 (2026-09-11 실측). 그 모드의 Chrome 은 **유휴 3분쯤 뒤 새 페이지를 못 만든다** —
      //   newPage 가 30초 기다리다 'Timed out after waiting 30000ms' 로 실패하고, 그 뒤 요청도 계속 실패한다.
      //   그래서 한동안 쉬던 서버의 첫 PDF 가 34.5초 걸렸고(교체 후 재시도), 교체 전 코드에서는 그때마다 Chrome 이
      //   하나씩 누수됐다(dev 9개). 같은 조건 200초 유휴 대조: single-process 30초 실패 · 이 옵션만 빼면 82ms · 프록시 옵션은 무관.
      //   멀티프로세스라 하위 프로세스가 생긴다 — disposeBrowser 가 본체를 죽이면 하위도 끝나는지 검증했다.
      // ★ prefetch·preload·WebSocket 은 request 인터셉션을 지나친다(Fable 실측).
      //   죽은 프록시로 **바깥을 통째로 끊는다** — 루프백도 프록시를 거치게 해서 예외를 없앤다.
      //   문서에 필요한 것은 setContent 로 넣은 인라인 CSS 와 data: URI 뿐이라 잃는 것이 없다.
      '--proxy-server=127.0.0.1:1',
      '--proxy-bypass-list=<-loopback>',
    ],
  });
  activeBrowser = browser;
  browser.on('disconnected', () => {
    if (activeBrowser === browser) { browserPromise = null; activeBrowser = null; }
  });
  return browser;
}

// ★ 버리는 브라우저는 **반드시 끝낸다** (2026-09-11).
//   여태는 싱글톤 참조만 null 로 지우고 새로 띄웠다. 그런데 아래 isBrowserDeadError 는 'Timed out'·'Protocol error'
//   처럼 **브라우저가 살아 있어도 나는 에러**를 죽음으로 친다 — 그때마다 살아 있는 Chrome 하나가 참조 없이 영구히 남았다.
//   dev 실측: 백엔드 자식 헤드리스 Chrome 9개(26분~4시간)가 쌓여 스왑 3.5GB, 검사 체인이 메모리 부족으로 kill 됐다.
//   close() 는 행 걸린 브라우저에서 돌아오지 않을 수 있어 상한을 두고, 넘기면 프로세스를 직접 죽인다.
// 끝났을 때(닫혔거나 상한 뒤 죽였을 때) resolve 한다 — 서버 종료(closeBrowser)는 이것을 **기다려야** 한다.
//   기다리지 않으면 프로세스가 먼저 나가 Chrome 이 남는다. 다른 호출부는 기다리지 않아도 된다.
function disposeBrowser(b) {
  if (!b) return Promise.resolve();
  const proc = typeof b.process === 'function' ? b.process() : null;
  const kill = () => { try { if (proc && proc.exitCode === null && !proc.killed) proc.kill('SIGKILL'); } catch { /* noop */ } };
  return new Promise((resolve) => {
    const timer = setTimeout(() => { kill(); resolve(); }, 3000);
    if (timer.unref) timer.unref();
    Promise.resolve().then(() => b.close()).catch(() => {}).finally(() => { clearTimeout(timer); kill(); resolve(); });
  });
}

// ★ 공유 브라우저는 **쓰는 요청이 남아 있으면 닫지 않는다** (Fable 2026-09-11 재검증 FAIL).
//   위 disposeBrowser 를 실패한 요청이 곧바로 부르자, 같은 브라우저로 동시에 렌더하던 **다른 요청들이
//   'Navigating frame was detached' 로 한꺼번에 죽었다**(동시 5건 중 1건 타임아웃 → 1/5 성공).
//   타임아웃은 부하 때 나서 동시 요청과 겹친다 — 누수를 없앤 대가로 연쇄 실패를 만든 것이었다.
//   그래서 "은퇴" 시킨다: 싱글톤에서 빼 새 요청은 새 브라우저로 가고, 은퇴한 브라우저는 **렌더가 다 끝나면** 닫힌다.
//   이미 끊긴 브라우저는 기다릴 것이 없어 바로 끝낸다. 렌더가 행에 걸려 끝나지 않으면 상한 뒤 끝낸다.
const inflight = new Map();   // browser → 진행 중 렌더 수
const retired = new Set();
const RETIRE_MAX_MS = 90000;  // protocolTimeout(60s) + 여유

function isConnected(b) {
  if (!b) return false;
  return typeof b.connected === 'boolean' ? b.connected : (typeof b.isConnected === 'function' ? b.isConnected() : false);
}
function retainBrowser(b) { if (b) inflight.set(b, (inflight.get(b) || 0) + 1); }
function releaseBrowser(b) {
  if (!b) return;
  const n = (inflight.get(b) || 0) - 1;
  if (n > 0) { inflight.set(b, n); return; }
  inflight.delete(b);
  if (retired.has(b)) { retired.delete(b); disposeBrowser(b); }
}
function retireBrowser(b) {
  if (!b) return;
  if (!isConnected(b) || !(inflight.get(b) > 0)) {
    retired.delete(b); inflight.delete(b); disposeBrowser(b);
    return;
  }
  if (retired.has(b)) return;
  retired.add(b);
  const t = setTimeout(() => { if (retired.has(b)) { retired.delete(b); inflight.delete(b); disposeBrowser(b); } }, RETIRE_MAX_MS);
  if (t.unref) t.unref();
}

async function getBrowser() {
  if (browserPromise) {
    let b = null;
    try {
      b = await browserPromise;
      // puppeteer 21+ : browser.connected (getter). 구버전 호환: isConnected().
      const alive = typeof b.connected === 'boolean' ? b.connected
        : (typeof b.isConnected === 'function' ? b.isConnected() : true);
      if (b && alive) return b;
    } catch { /* launch 실패 캐시 — 아래서 재시도 */ }
    // 끊긴 브라우저도 프로세스는 남아 있을 수 있다 — 끝내고 새로 띄운다(끊겼으면 retireBrowser 가 바로 끝낸다)
    if (b) retireBrowser(b);
    browserPromise = null;
  }
  browserPromise = launch().catch((err) => {
    browserPromise = null;
    throw err;
  });
  return browserPromise;
}

// 브라우저 사망/끊김 계열 에러 — 싱글톤 리셋 후 1회 재시도할 가치가 있음.
// (BASE_CSS 인라인이라 networkidle0 는 즉시 충족 → content 타임아웃 거의 없음)
function isBrowserDeadError(err) {
  const m = String((err && err.message) || err || '');
  // 'detached' — 브라우저가 실제로 죽으면 진행 중이던 다른 렌더는 'Navigating frame was detached' 로 끝난다.
  //   목록에 없어서 재시도 없이 500 이었다(Fable 2026-09-11) — 새 브라우저로 한 번 더 시도할 가치가 있다.
  return /Target closed|Session closed|Connection closed|Protocol error|disconnected|Timed out|browser has disconnected|detached/i.test(m);
}

async function renderPdfFromHtml(html, opts = {}) {
  // ★ 2026-09-09 — 아래 요청 차단(SSRF)은 **우리 이미지까지** 끊고 있었다.
  //   `absolutizeSrc` 가 만든 loopback 주소도 차단 대상이라, 2026-09-02 이후 모든 PDF 에서
  //   에디터 이미지가 전부 사라졌다("문서에서 다운로드 했는데 이미지가 하나도 안나와").
  //   차단은 그대로 두고 — 브라우저가 가져오게 하지 않고 **서버가 읽어 data: 로 심는다.**
  //   여기 한 곳에 두는 이유: 이 렌더러를 부르는 경로가 넷이다(문서·게시글·청구서·KB).
  //   호출부마다 넣으면 반드시 한쪽이 빠진다.
  try {
    const { inlineEditorImages } = require('./pdfInlineImages');
    const r = await inlineEditorImages(html);
    if (r.inlined || r.skipped) {
      console.log(`[pdf] 이미지 인라인 ${r.inlined}장 (건너뜀 ${r.skipped}장 · ${Math.round(r.bytes / 1024)}KB)`);
    }
    html = r.html;
  } catch (e) {
    console.warn('[pdf] 이미지 인라인 실패 — 이미지 없이 계속:', e.message);
  }
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    let page;
    let browser = null;
    try {
      browser = await getBrowser();
      retainBrowser(browser);   // 렌더가 끝날 때까지 이 브라우저를 닫지 않는다(finally 에서 release)
      page = await browser.newPage();
      // ★ 렌더 대상 HTML 에는 **사용자가 쓴 본문**이 들어간다(문서·게시글·청구서 body_html).
      //   그대로 두면 <img src="http://127.0.0.1:3003/…"> 한 줄로 **서버측 요청 위조**가 되고,
      //   내부 응답이 PDF 지면에 그대로 찍힌다 — 게다가 이 렌더러를 부르는 경로 4개가 **무인증**이다
      //   (2026-09-02 보안감사 H-2: 루프백 서버로 실증, 내부 본문이 PDF 에 전문 노출).
      //   그래서 **바깥으로 나가는 모든 요청을 끊는다.** 문서에 필요한 것은 data: URI 와
      //   setContent 로 넣은 인라인 CSS 뿐이라 잃는 것이 없다.
      // ★ "메인 프레임 네비게이션이면 무조건 통과" 는 **구멍이었다.**
      //   본문 한 줄 `<meta http-equiv=refresh url=http://127.0.0.1:3003/…>` · `location.href` ·
      //   `form.submit()` 이 전부 메인 프레임 네비게이션이라, 내부 응답이 그대로 지면에 찍혔다
      //   (Fable 실측 2026-09-02: 32벡터 중 meta refresh·location·form 등이 leak=true).
      //   통과시키는 것은 **setContent 가 쓰는 about:blank 하나뿐**이다.
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const url = req.url();
        if (url === 'about:blank') return req.continue().catch(() => {});
        if (url.startsWith('data:')) return req.continue().catch(() => {});
        return req.abort().catch(() => {});
      });
      // 문서 렌더에 스크립트는 필요 없다 — 끄면 location.href·form.submit 계열이 아예 못 돈다.
      await page.setJavaScriptEnabled(false);
      // 인터셉션이 못 보는 창(window.open)은 열리는 즉시 닫는다.
      page.on('popup', (p) => { p.close().catch(() => {}); });
      await page.setContent(html, { waitUntil: 'networkidle0', timeout: 15000 });
      const pdf = await page.pdf({
        format: opts.format || 'A4',
        printBackground: true,
        margin: opts.margin || { top: '20mm', right: '18mm', bottom: '20mm', left: '18mm' },
        ...(opts.headerTemplate ? { displayHeaderFooter: true, headerTemplate: opts.headerTemplate, footerTemplate: opts.footerTemplate || '<div></div>' } : {}),
      });
      // puppeteer 21+ 는 Uint8Array 반환 — Express res.send 가 JSON 으로 stringify 하므로 Buffer 로 강제 변환
      return Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
    } catch (err) {
      lastErr = err;
      // 브라우저 죽음 → 싱글톤 강제 리셋 후 1회 재시도. 그 외(또는 2번째)는 throw.
      if (attempt === 0 && isBrowserDeadError(err)) {
        // 참조만 지우면 살아 있는 Chrome 이 영구히 남는다(disposeBrowser 주석), 곧바로 닫으면 동시 렌더가 죽는다(retireBrowser 주석).
        //   이 요청이 쓰던 브라우저가 아직 싱글톤이면 **은퇴** — 새 요청은 새 브라우저로, 이 브라우저는 렌더가 다 끝나면 닫힌다.
        //   이미 다른 요청이 교체했으면 건드리지 않는다.
        if (browser && activeBrowser === browser) { browserPromise = null; activeBrowser = null; retireBrowser(browser); }
        continue;
      }
      throw err;
    } finally {
      if (page) await page.close().catch(() => {});
      releaseBrowser(browser);
    }
  }
  throw lastErr;
}

// Graceful shutdown
// 서버 종료용 — 싱글톤과 은퇴분을 **끝까지** 닫는다(각 최대 3초 뒤 SIGKILL)
async function closeBrowser() {
  const all = [...retired];
  retired.clear(); inflight.clear();
  if (browserPromise) {
    try { all.push(await browserPromise); } catch { /* launch 실패 — 닫을 것이 없다 */ }
  }
  browserPromise = null; activeBrowser = null;
  await Promise.all(all.map((b) => disposeBrowser(b)));
}

module.exports = { renderPdfFromHtml, closeBrowser, getBrowser, retainBrowser, releaseBrowser };
