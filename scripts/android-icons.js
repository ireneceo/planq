// 안드로이드 런처 아이콘 생성 — Capacitor 기본 플레이스홀더(파란 X) 교체.
//
// 왜 있어야 하나: `npx cap add android` 가 넣어 준 기본 아이콘이 그대로 남아 있었다(2026-09-03 실측).
//   그대로 출시하면 사용자 홈 화면에 PlanQ 가 아닌 아이콘이 뜬다.
//   iOS 는 이미 브랜드 마크(청록 Q / 흰 배경)라 **같은 그림**으로 맞춘다 —
//   두 플랫폼 아이콘이 다르면 같은 앱으로 안 보인다.
//
// 규격 (Android adaptive icon)
//   ic_launcher / ic_launcher_round : 48·72·96·144·192  (레거시 런처)
//   ic_launcher_foreground          : 108·162·216·324·432 (adaptive 전경)
//     ★ 전경은 108dp 중 **가운데 72dp 만 항상 보인다**(바깥 18dp 는 런처 모양에 따라 잘림).
//       그래서 마크를 캔버스의 66% 로 잡는다. 꽉 채우면 원형 런처에서 잘린다.
//   배경은 values/ic_launcher_background.xml 의 #FFFFFF (iOS 와 동일)
//
// 실행: cd /opt/planq && node scripts/android-icons.js
const fs = require('fs');
const path = require('path');
const puppeteer = require('/opt/planq/dev-backend/node_modules/puppeteer');

const RES = '/opt/planq/dev-frontend/android/app/src/main/res';
const MARK = 'data:image/svg+xml;base64,' + Buffer.from(
  fs.readFileSync('/opt/planq/dev-frontend/public/favicon.svg', 'utf8')).toString('base64');

const DENS = [
  { d: 'mdpi', legacy: 48, fg: 108 },
  { d: 'hdpi', legacy: 72, fg: 162 },
  { d: 'xhdpi', legacy: 96, fg: 216 },
  { d: 'xxhdpi', legacy: 144, fg: 324 },
  { d: 'xxxhdpi', legacy: 192, fg: 432 },
];

// markPct: 캔버스 대비 마크 폭. round: 원형 마스크. bg: null 이면 투명
const html = ({ size, markPct, round, bg }) => `<!doctype html><meta charset="utf-8"><style>
  *{margin:0;padding:0}
  html,body{width:${size}px;height:${size}px;overflow:hidden;background:transparent}
  body{display:flex;align-items:center;justify-content:center}
  .plate{width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;
    ${bg ? `background:${bg};` : ''}${round ? 'border-radius:50%;' : ''}}
  img{width:${Math.round(size * markPct)}px;height:${Math.round(size * markPct)}px}
</style><div class="plate"><img src="${MARK}"></div>`;

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  let n = 0;
  for (const { d, legacy, fg } of DENS) {
    const dir = path.join(RES, `mipmap-${d}`);
    if (!fs.existsSync(dir)) { console.log(`  건너뜀 (없는 폴더): ${dir}`); continue; }
    const jobs = [
      { file: 'ic_launcher.png', size: legacy, markPct: 0.74, round: false, bg: '#FFFFFF' },
      { file: 'ic_launcher_round.png', size: legacy, markPct: 0.64, round: true, bg: '#FFFFFF' },
      // 전경은 배경 레이어가 따로 있으므로 투명. 72/108 = 0.667 안쪽에 들어가게 0.60.
      { file: 'ic_launcher_foreground.png', size: fg, markPct: 0.60, round: false, bg: null },
    ];
    for (const j of jobs) {
      await page.setViewport({ width: j.size, height: j.size, deviceScaleFactor: 1 });
      // ★ networkidle0 은 data: URI 만 있는 문서에서 30초를 그냥 기다리다 죽는다(실측).
      //   문서 로드만 기다리고, 이미지는 decode() 로 직접 확인한다.
      await page.setContent(html(j), { waitUntil: 'domcontentloaded' });
      await page.evaluate(async () => {
        const im = document.querySelector('img');
        if (im && !im.complete) await im.decode().catch(() => null);
      });
      await page.screenshot({ path: path.join(dir, j.file), type: 'png', omitBackground: !j.bg });
      n++;
    }
    console.log(`  ✅ mipmap-${d}  (${legacy}px 레거시 · ${fg}px 전경)`);
  }
  await browser.close();
  console.log(`\n[android-icons] ${n}개 파일 — ${RES}`);
  console.log('  다음: npx cap sync android 후 재빌드해야 반영된다');
})();
