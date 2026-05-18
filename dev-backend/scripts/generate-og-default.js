// scripts/generate-og-default.js
//
// PlanQ 기본 OG 썸네일 (1200×630) 생성. puppeteer 로 HTML 렌더 → PNG screenshot.
// dev-frontend/public/og-default.png 로 저장. SNS 공유 표준 사이즈.
//
// 사용: node scripts/generate-og-default.js

const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');

const OUT = path.join(__dirname, '..', '..', 'dev-frontend', 'public', 'og-default.png');
const SLOGAN_SVG = path.join(__dirname, '..', '..', 'dev-frontend', 'public', 'planQ-slogan_color.svg');

const slogan = fs.readFileSync(SLOGAN_SVG, 'utf8');

const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 1200px; height: 630px; overflow: hidden; }
  body {
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    background: linear-gradient(135deg, #F0FDFA 0%, #FFFFFF 60%, #FEF3F4 100%);
    font-family: -apple-system, 'Pretendard', 'Apple SD Gothic Neo', system-ui, sans-serif;
  }
  .logo { width: 720px; max-width: 80%; height: auto; }
  .logo svg { width: 100%; height: auto; display: block; }
  .tag {
    margin-top: 40px;
    font-size: 32px; font-weight: 500;
    color: #475569; letter-spacing: -0.5px;
    text-align: center; line-height: 1.4;
  }
  .domain {
    position: absolute; bottom: 40px; right: 48px;
    font-size: 22px; font-weight: 700; color: #14B8A6;
    letter-spacing: 0.5px;
  }
</style></head><body>
  <div class="logo">${slogan}</div>
  <div class="tag">일이 일이 되지 않게 — 수익성 엔진</div>
  <div class="domain">planq.kr</div>
</body></html>`;

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
    await page.setContent(HTML, { waitUntil: 'networkidle0' });
    await page.screenshot({ path: OUT, type: 'png', clip: { x: 0, y: 0, width: 1200, height: 630 } });
    const stat = fs.statSync(OUT);
    console.log(`  wrote ${OUT} (${(stat.size/1024).toFixed(1)} KB)`);
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
