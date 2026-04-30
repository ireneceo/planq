// SVG → PNG 변환 (puppeteer 활용, headless Chrome 으로 렌더링)
//   사용법: node svg-to-png.js <input.svg> <output.png> <size>
//   배경 투명. padding 포함하려면 SVG 자체에 둘러싸여 있어야 함.

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

async function convert(svgPath, outPath, size) {
  const svg = fs.readFileSync(svgPath, 'utf8');
  const html = `<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body { margin:0; padding:0; background:transparent; }
  body { display:flex; align-items:center; justify-content:center; width:${size}px; height:${size}px; }
  svg { width:${size}px; height:${size}px; display:block; }
</style></head><body>${svg}</body></html>`;

  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.screenshot({ path: outPath, type: 'png', omitBackground: true });
    console.log(`  ✓ ${outPath} (${size}x${size})`);
  } finally {
    await browser.close();
  }
}

async function main() {
  const [, , inSvg, outPng, sizeStr] = process.argv;
  if (!inSvg || !outPng || !sizeStr) {
    console.error('Usage: node svg-to-png.js <input.svg> <output.png> <size>');
    process.exit(1);
  }
  await convert(path.resolve(inSvg), path.resolve(outPng), Number(sizeStr));
}

main().catch((e) => { console.error(e); process.exit(1); });
