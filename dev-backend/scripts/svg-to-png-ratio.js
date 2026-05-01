// 비율 보존 SVG → PNG 변환
//   사용법: node svg-to-png-ratio.js <input.svg> <output.png> <width>
// SVG viewBox 기반 height 자동 계산.

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

async function main() {
  const [, , inSvg, outPng, widthStr] = process.argv;
  if (!inSvg || !outPng || !widthStr) {
    console.error('Usage: node svg-to-png-ratio.js <input.svg> <output.png> <width>');
    process.exit(1);
  }
  const width = Number(widthStr);
  const svg = fs.readFileSync(path.resolve(inSvg), 'utf8');
  const m = svg.match(/viewBox="([0-9.\- ]+)"/);
  if (!m) { console.error('viewBox not found'); process.exit(1); }
  const [, , vbW, vbH] = m[1].trim().split(/\s+/).map(Number);
  const height = Math.round(width * (vbH / vbW));

  const html = `<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body { margin:0; padding:0; background:transparent; }
  body { width:${width}px; height:${height}px; }
  svg { width:${width}px; height:${height}px; display:block; }
</style></head><body>${svg}</body></html>`;

  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 2 }); // 레티나 대응
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.screenshot({ path: path.resolve(outPng), type: 'png', omitBackground: true });
    console.log(`  ✓ ${outPng} (${width}x${height})`);
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
