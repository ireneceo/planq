#!/usr/bin/env node
// Microsoft Store(MSIX) 타일 그림을 build/icon.png 하나에서 만든다 → build/appx/*.png (저장소에 넣어 둔다 — 빌드 기계는 이 파일을 쓴다).
//   없으면 electron-builder 가 Electron 기본 그림을 넣는다(Store 화면·시작 메뉴에 남의 로고). 아이콘이 바뀐 때만 다시 돌린다.
//   사용: node desktop/scripts/make-appx-assets.js   (서버 메모리 자리표 안에서 크롬을 잠깐 띄운다)
require('../../scripts/e2e/lib/mem-slot');
const fs = require('fs');
const path = require('path');
const puppeteer = require('/opt/planq/dev-backend/node_modules/puppeteer');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'build', 'appx');
// 이름은 electron-builder appx 가 찾는 이름 그대로(AppxTarget computeUserAssets). 여백 비율은 MS 권장(로고가 타일의 약 2/3)
const ASSETS = [
  { name: 'StoreLogo.png', w: 50, h: 50, pad: 0 },
  { name: 'Square44x44Logo.png', w: 44, h: 44, pad: 0 },
  { name: 'Square150x150Logo.png', w: 150, h: 150, pad: 0.16 },
  { name: 'Wide310x150Logo.png', w: 310, h: 150, pad: 0.16 },
  { name: 'SmallTile.png', w: 71, h: 71, pad: 0.14 },
  { name: 'LargeTile.png', w: 310, h: 310, pad: 0.16 },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const icon = 'data:image/png;base64,' + fs.readFileSync(path.join(ROOT, 'build', 'icon.png')).toString('base64');
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent('<html><body></body></html>');
    for (const a of ASSETS) {
      const b64 = await page.evaluate(async (src, a) => {
        const img = new Image();
        await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = src; });
        const c = document.createElement('canvas');
        c.width = a.w; c.height = a.h;
        const g = c.getContext('2d');
        g.imageSmoothingQuality = 'high';
        const side = Math.round(Math.min(a.w, a.h) * (1 - a.pad * 2));
        g.drawImage(img, Math.round((a.w - side) / 2), Math.round((a.h - side) / 2), side, side);
        return c.toDataURL('image/png').split(',')[1];
      }, icon, a);
      fs.writeFileSync(path.join(OUT, a.name), Buffer.from(b64, 'base64'));
      console.log(`  ${a.name} ${a.w}x${a.h}`);
    }
  } finally {
    await browser.close();
  }
  console.log(`[appx-assets] → ${OUT}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
