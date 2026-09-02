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
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--no-zygote',
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

async function getBrowser() {
  if (browserPromise) {
    try {
      const b = await browserPromise;
      // puppeteer 21+ : browser.connected (getter). 구버전 호환: isConnected().
      const alive = typeof b.connected === 'boolean' ? b.connected
        : (typeof b.isConnected === 'function' ? b.isConnected() : true);
      if (b && alive) return b;
    } catch { /* launch 실패 캐시 — 아래서 재시도 */ }
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
  return /Target closed|Session closed|Connection closed|Protocol error|disconnected|Timed out|browser has disconnected/i.test(m);
}

async function renderPdfFromHtml(html, opts = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    let page;
    try {
      const browser = await getBrowser();
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
        browserPromise = null; activeBrowser = null;
        continue;
      }
      throw err;
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }
  throw lastErr;
}

// Graceful shutdown
async function closeBrowser() {
  if (!browserPromise) return;
  try {
    const b = await browserPromise;
    await b.close();
  } catch { /* ignore */ }
  browserPromise = null; activeBrowser = null;
}

module.exports = { renderPdfFromHtml, closeBrowser, getBrowser };
