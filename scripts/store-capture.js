// 스토어 등록용 스크린샷 자동 캡처 (Play Console / App Store)
//
// 왜 따로 두나: scripts/marketing-capture.js 는 **랜딩페이지용 1440×900 webp** 다.
//   스토어는 규격이 다르다 — 폰 세로(9:16 계열) · PNG/JPEG · 최소 2장.
//   같은 파일에 옵션을 얹으면 랜딩 asset 규격이 스토어 요구에 끌려간다. 캡처 뼈대(로그인·이동·대기)만 공유한다.
//
// 실행: cd /opt/planq && node scripts/store-capture.js [--only=talk,task] [--device=phone|tab7|tab10|all]
// 산출물: /opt/planq/store-assets/screenshots/{phone|tab7|tab10}-{n}-{key}.png
//   phone 1080×1920(9:16) · tab7 1920×1080(16:9) · tab10 2560×1440(16:9)
//   ★ 태블릿은 **가로**로 찍는다. 세로로 찍으면 폰과 같은 한 컬럼 레이아웃이라
//     태블릿 스크린샷을 따로 올리는 의미가 없다 — 가로에서만 좌/우 패널이 같이 보인다.
//
// ★ dev 에서만 캡처한다 — 운영 화면을 스토어에 올리는 사고 차단(marketing-capture 와 같은 fail-closed).
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const fs = require('fs');
const path = require('path');
const { launch, login, sleep, BASE } = require('./e2e/lib/browser');

const OUT_DIR = '/opt/planq/store-assets/screenshots';
// Play 폰 스크린샷 권장 — 9:16, 1080×1920. deviceScaleFactor 3 으로 잡고 360×640 뷰포트를 쓴다
//   (실제 폰 논리 해상도. 1080 을 그대로 뷰포트로 주면 데스크탑 레이아웃이 나온다).
// 논리 뷰포트 × deviceScaleFactor = 최종 픽셀. 1080 을 그대로 뷰포트로 주면 데스크탑 레이아웃이 나온다.
const DEVICES = {
  phone: { prefix: 'phone', vp: { width: 360,  height: 640, deviceScaleFactor: 3, isMobile: true,  hasTouch: true  }, spec: '1080×1920 (9:16)' },
  tab7:  { prefix: 'tab7',  vp: { width: 960,  height: 540, deviceScaleFactor: 2, isMobile: false, hasTouch: true  }, spec: '1920×1080 (16:9)' },
  tab10: { prefix: 'tab10', vp: { width: 1280, height: 720, deviceScaleFactor: 2, isMobile: false, hasTouch: true  }, spec: '2560×1440 (16:9)' },
};
const ALLOWED_BASE = ['https://dev.planq.kr', 'http://localhost:3003'];
const CREDS = { email: 'capture@demo.planq.kr', password: process.env.DEMO_CAPTURE_PASSWORD };

const SHOTS = [
  { key: 'talk',  route: '/talk',            pick: '[data-qtalk-chat]' },
  { key: 'task',  route: '/tasks',           wait: null },
  { key: 'note',  route: '/notes',           pick: '[data-qnote-session]' },
  { key: 'docs',  route: '/docs',            wait: null },
  { key: 'bill',  route: '/bills',           wait: null },
  { key: 'home',  route: '/dashboard',       wait: null },
];

(async () => {
  if (!ALLOWED_BASE.includes(BASE)) { console.error(`[store-capture] dev 에서만 캡처한다 (BASE=${BASE})`); process.exit(2); }
  if (!CREDS.password) { console.error('[store-capture] DEMO_CAPTURE_PASSWORD 없음'); process.exit(2); }
  const only = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1];
  const devArg = (process.argv.find((a) => a.startsWith('--device=')) || '').split('=')[1] || 'phone';
  const devKeys = devArg === 'all' ? Object.keys(DEVICES) : devArg.split(',');
  for (const k of devKeys) if (!DEVICES[k]) { console.error(`[store-capture] 모르는 device: ${k}`); process.exit(2); }
  const targets = only ? SHOTS.filter((s) => only.split(',').includes(s.key)) : SHOTS;
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const { browser, page } = await launch({});
  const made = [];
  for (const dk of devKeys) {
  const DEV = DEVICES[dk];
  await page.setViewport(DEV.vp);
  await login(page, CREDS);
  let n = 0;
  for (const shot of targets) {
    try {
      await page.goto(BASE + shot.route, { waitUntil: 'networkidle2', timeout: 45000 });
      await sleep(2600);
      // 안내 배너는 스토어 이미지에 어울리지 않는다 — 텍스트로 찾아 지운다.
      //   ★ styled-components 는 클래스명이 해시라 [class*="PushPrompt"] 로는 안 잡힌다(실측).
      await page.evaluate(() => {
        const KILL = /디바이스 알림|앱으로 설치|알림을 켜|Device notifications|Install/;
        for (const el of [...document.querySelectorAll('div,section,aside')]) {
          const t = (el.textContent || '').trim();
          if (t && t.length < 120 && KILL.test(t) && el.getBoundingClientRect().height < 220) { el.remove(); }
        }
      });
      // 상세가 있는 화면은 첫 항목을 열어 둔다 — 목록만 찍으면 제품이 안 보인다
      if (shot.pick) {
        await page.evaluate((sel) => { document.querySelector(sel)?.click(); }, shot.pick);
        await sleep(1800);
      }
      await sleep(400);
      n += 1;
      const out = path.join(OUT_DIR, `${DEV.prefix}-${n}-${shot.key}.png`);
      await page.screenshot({ path: out });
      const kb = Math.round(fs.statSync(out).size / 1024);
      made.push({ file: path.basename(out), kb });
      console.log(`  ✅ ${path.basename(out)}  ${kb}KB`);
    } catch (e) {
      console.log(`  ❌ ${shot.key}: ${String(e.message).slice(0, 70)}`);
    }
  }
  console.log(`  — ${dk} 완료 (${DEV.spec})`);
  }
  await browser.close();
  console.log(`\n[store-capture] ${made.length}장 — ${OUT_DIR}`);
  for (const k of devKeys) console.log(`  ${k}: ${DEVICES[k].spec}`);
  process.exit(made.length >= 2 ? 0 : 1);
})().catch((e) => { console.error('[store-capture] 크래시', e.message); process.exit(2); });
