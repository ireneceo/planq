// 스토어 피처 그래픽 · 앱 아이콘 생성 (Play Console)
//
// 왜 스크립트인가: 규격(1024×500 / 512×512)과 브랜드 색이 코드에 남아야 재현된다.
//   디자인 툴에서 한 번 만들고 파일만 남기면, 문구가 바뀔 때 무엇을 어떻게 만들었는지 아무도 모른다.
//
// 실행: cd /opt/planq && node scripts/store-graphic.js
// 산출물: /opt/planq/store-assets/feature-graphic.png (1024×500)
//         /opt/planq/store-assets/app-icon-512.png   (512×512)
const fs = require('fs');
const path = require('path');
const puppeteer = require('/opt/planq/dev-backend/node_modules/puppeteer');

const OUT = '/opt/planq/store-assets';
const MARK = fs.readFileSync('/opt/planq/dev-frontend/public/favicon.svg', 'utf8');
// COLOR_GUIDE.md 의 Primary — 사이드바(800/900) 그라데이션 + Primary 500 포인트
const C = { deep: '#134E4A', mid: '#115E59', teal: '#14B8A6', light: '#5EEAD4' };

const markDataUri = 'data:image/svg+xml;base64,' + Buffer.from(MARK).toString('base64');

const featureHtml = `<!doctype html><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1024px;height:500px;overflow:hidden}
  body{
    background:linear-gradient(120deg, ${C.deep} 0%, ${C.mid} 55%, #0B3B37 100%);
    font-family:'Pretendard','Noto Sans KR',system-ui,sans-serif;
    display:flex;align-items:center;gap:56px;padding:0 72px;position:relative;
  }
  /* 배경 장식 — 브랜드 마크를 크게 흐리게 깔아 빈 오른쪽을 채운다 */
  .ghost{position:absolute;right:-70px;top:-60px;width:520px;opacity:.10}
  .mark{width:132px;height:132px;flex-shrink:0}
  .copy{position:relative;z-index:1}
  .brand{font-size:64px;font-weight:800;color:#fff;letter-spacing:-1.5px;line-height:1}
  .brand em{font-style:normal;color:${C.light}}
  .tag{margin-top:18px;font-size:27px;font-weight:600;color:rgba(255,255,255,.94);line-height:1.45}
  .sub{margin-top:14px;font-size:19px;color:rgba(255,255,255,.62);letter-spacing:.2px}
</style>
<img class="ghost" src="${markDataUri}">
<img class="mark" src="${markDataUri}">
<div class="copy">
  <div class="brand">Plan<em>Q</em></div>
  <div class="tag">요청은 Queue로, 실행은 Cue로.</div>
  <div class="sub">고객 채팅 · 업무 · 회의노트 · 문서 · 청구를 한 곳에서</div>
</div>`;

// ★ 스토어 아이콘은 **기기에 설치된 앱 아이콘과 같아야 한다**.
//   iOS(Assets.xcassets AppIcon)·안드로이드(mipmap ic_launcher) 모두 흰 배경 + 청록 마크다.
//   스토어만 다른 그림을 쓰면 "받은 앱이 그 앱이 맞나" 싶어진다.
const iconHtml = `<!doctype html><meta charset="utf-8"><style>
  *{margin:0;padding:0}
  html,body{width:512px;height:512px;overflow:hidden}
  body{background:#FFFFFF;display:flex;align-items:center;justify-content:center}
  img{width:340px;height:340px}
</style><img src="${markDataUri}">`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const shots = [
    { name: 'feature-graphic.png', html: featureHtml, w: 1024, h: 500 },
    { name: 'app-icon-512.png', html: iconHtml, w: 512, h: 512 },
  ];
  for (const s of shots) {
    const page = await browser.newPage();
    await page.setViewport({ width: s.w, height: s.h, deviceScaleFactor: 1 });
    await page.setContent(s.html, { waitUntil: 'networkidle0' });
    const out = path.join(OUT, s.name);
    await page.screenshot({ path: out, type: 'png' });
    await page.close();
    console.log(`  ✅ ${s.name}  ${s.w}×${s.h}  ${Math.round(fs.statSync(out).size / 1024)}KB`);
  }
  await browser.close();
  console.log(`\n[store-graphic] ${OUT}`);
})();
