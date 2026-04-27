// PDF Service — Puppeteer 싱글톤 (Phase E1)
//
// 사용 패턴:
//   const pdf = await renderPdfFromHtml('<html>...</html>', { format: 'A4' });
//   res.setHeader('Content-Type', 'application/pdf');
//   res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
//   res.send(pdf);
//
// 설계:
//   - Browser 1회 launch (서버 lifetime).
//   - 매 PDF 생성마다 새 page (개별 컨텍스트 — 메모리 누수 방지).
//   - 로드 실패해도 다른 endpoint 차단 안 함 (try/catch + 명시적 에러).
//   - Linux 서버용 args (--no-sandbox 등).

const puppeteer = require('puppeteer');

let browserPromise = null;

async function getBrowser() {
  if (browserPromise) return browserPromise;
  browserPromise = puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--no-zygote',
    ],
  }).catch(err => {
    browserPromise = null;
    throw err;
  });
  return browserPromise;
}

async function renderPdfFromHtml(html, opts = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 15000 });
    const pdf = await page.pdf({
      format: opts.format || 'A4',
      printBackground: true,
      margin: opts.margin || { top: '20mm', right: '18mm', bottom: '20mm', left: '18mm' },
      ...(opts.headerTemplate ? { displayHeaderFooter: true, headerTemplate: opts.headerTemplate, footerTemplate: opts.footerTemplate || '<div></div>' } : {}),
    });
    // puppeteer 21+ 는 Uint8Array 반환 — Express res.send 가 JSON 으로 stringify 하므로 Buffer 로 강제 변환
    return Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
  } finally {
    await page.close().catch(() => {});
  }
}

// Graceful shutdown
async function closeBrowser() {
  if (!browserPromise) return;
  try {
    const b = await browserPromise;
    await b.close();
  } catch { /* ignore */ }
  browserPromise = null;
}

module.exports = { renderPdfFromHtml, closeBrowser };
