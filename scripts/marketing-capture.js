// 마케팅 스크린샷 자동 캡처 (#146 랜딩 /features Q 시리즈 5블록)
//
// 데모 워크스페이스(dev-backend/scripts/seed-demo-workspace.js 로 시드)에 로그인해
// 실제 PlanQ 화면을 캡처하고 webp 로 최적화해 프론트 정적 asset 으로 떨어뜨린다.
//
// 실행: cd /opt/planq && node scripts/marketing-capture.js [--only talk,task]
// 선행: dev-backend/.env 의 DEMO_CAPTURE_PASSWORD + seed-demo-workspace.js 실행
//
// 산출물: dev-frontend/public/screenshots/features/q-{talk,task,note,file,bill}.webp
//   → git 에 커밋되는 정적 asset (런타임에 데모 데이터를 부르지 않는다)

require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const fs = require('fs');
const path = require('path');
const sharp = require('/opt/planq/dev-backend/node_modules/sharp');
const { launch, login, goto, sleep, BASE } = require('./e2e/lib/browser');

const OUT_DIR = path.join(__dirname, '..', 'dev-frontend', 'public', 'screenshots', 'features');
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 };
const MAX_BYTES = 150 * 1024;

// ★ 캡처는 dev 에서만 — 운영 화면을 마케팅 asset 으로 굽는 사고 차단 (fail-closed)
const ALLOWED_BASE = ['https://dev.planq.kr', 'http://localhost:3003'];

const CREDS = {
  email: 'capture@demo.planq.kr',
  password: process.env.DEMO_CAPTURE_PASSWORD,
};

// pick: 캡처 직전 목록에서 한 항목을 여는 선택자 (상세 패널이 빈 상태로 찍히는 것 방지).
//   match 를 주면 그 텍스트를 포함한 항목을 우선 고른다.
const SHOTS = [
  { key: 'talk', route: '/talk', label: 'Q talk', pick: '[data-qtalk-chat]', match: '노들커머스' },
  { key: 'task', route: '/tasks/workspace', label: 'Q task' },   // 워크스페이스 전체 업무 — 팀 전원의 일이 보이는 화면
  { key: 'note', route: '/notes', label: 'Q note', pick: '[data-qnote-session]' },
  { key: 'file', route: '/files', label: 'Q file' },
  { key: 'bill', route: '/bills', label: 'Q bill' },
];

function abort(msg) {
  console.error(`\n❌ 중단: ${msg}\n`);
  process.exit(1);
}

// 온보딩 배너를 "이미 닫은 사용자" 상태로 만든다 — 제품 코드를 건드리지 않고, 배너 자신이 보는
// 저장키를 미리 심는 방식 (실 사용자가 × 를 눌렀을 때와 동일한 상태).
// ★ 반드시 앱 부팅(goto) 전에 호출 — 배너 상태는 mount 시 1회만 읽는다.
async function suppressOnboardingBanners(page) {
  await page.evaluate(() => {
    try {
      sessionStorage.setItem('pq_push_prompt_dismiss_session', '1');           // 디바이스 알림 안내
      sessionStorage.setItem('pq_pwa_install_dismiss_session', '1');           // PWA 설치 안내 (이번 세션)
      localStorage.setItem('pq_pwa_install_dismiss_until', String(Date.now() + 7 * 864e5));
    } catch { /* storage 불가 환경 무시 */ }
  });
}

// 캡처 직전 잔여 오버레이 정리. 데이터가 아니라 크롬만 건드린다.
//   - cloud-connect-notice: 상시 노출되는 Drive 연결 권장(닫기 없음) — 제품 소개 화면에는 노이즈
//   - 토스트/알림은 캡처 타이밍에 따라 뜰 수 있어 같이 제거
async function clearOverlays(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(() => {
    const kill = ['[data-testid="cloud-connect-notice"]', '[role="alert"]', '[data-toaster]'];
    for (const sel of kill) document.querySelectorAll(sel).forEach((el) => el.remove());
  });
  await sleep(250);
}

// 목록에서 항목 하나 열기 — 상세 패널이 빈 상태로 찍히지 않게 한다.
async function pickListItem(page, selector, match) {
  const clicked = await page.evaluate((sel, m) => {
    const rows = Array.from(document.querySelectorAll(sel));
    if (!rows.length) return null;
    const target = (m && rows.find((el) => (el.textContent || '').includes(m))) || rows[0];
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return (target.textContent || '').trim().slice(0, 30);
  }, selector, match || null);
  await sleep(2000);
  return clicked;
}

async function optimize(pngBuffer, outPath) {
  let quality = 88;
  let buf = null;
  while (quality >= 40) {
    buf = await sharp(pngBuffer)
      .resize({ width: VIEWPORT.width })      // 2x 캡처 → 1440 폭 (표시 폭의 약 2.8배, 레티나 충분)
      .webp({ quality })
      .toBuffer();
    if (buf.length <= MAX_BYTES) break;
    quality -= 8;
  }
  fs.writeFileSync(outPath, buf);
  return { bytes: buf.length, quality };
}

(async () => {
  if (!ALLOWED_BASE.includes(BASE)) abort(`BASE '${BASE}' 는 캡처 허용 대상이 아닙니다 (허용: ${ALLOWED_BASE.join(', ')})`);
  if (!CREDS.password) abort('dev-backend/.env 의 DEMO_CAPTURE_PASSWORD 가 없습니다');

  const onlyArg = process.argv.indexOf('--only');
  const only = onlyArg >= 0 ? (process.argv[onlyArg + 1] || '').split(',').filter(Boolean) : null;
  const targets = only ? SHOTS.filter((s) => only.includes(s.key)) : SHOTS;
  if (!targets.length) abort('--only 대상이 비었습니다');

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const { browser, page } = await launch();
  await page.setViewport(VIEWPORT);

  try {
    await login(page, CREDS);
    console.log(`로그인 OK — ${CREDS.email} @ ${BASE}`);

    await suppressOnboardingBanners(page);   // 로그인 페이지에서 미리 심고 부팅
    await goto(page, targets[0].route);
    await sleep(2500);

    // ★ 캡처 전 워크스페이스 확인 — 데모 아닌 워크스페이스가 열려 있으면 즉시 중단 (fail-closed)
    const wsName = await page.evaluate(() => document.body.innerText.includes('온무늬'));
    if (!wsName) abort('현재 화면에 데모 워크스페이스(온무늬)가 보이지 않습니다 — 시드/로그인 상태 확인');

    for (const shot of targets) {
      // 탭 상태(sessionStorage)를 비우고 full goto — 각 컷이 자기 탭 하나만 연 깨끗한 화면이 된다.
      // (SPA 이동만 반복하면 멀티탭 스트립에 이전 컷의 탭이 계속 쌓인다)
      await page.evaluate(() => { try { sessionStorage.clear(); } catch { /* */ } });
      await suppressOnboardingBanners(page);
      await goto(page, shot.route);
      await sleep(2600);                        // 리스트 로드 + reveal 애니메이션 안착
      if (shot.pick) {
        const picked = await pickListItem(page, shot.pick, shot.match);
        if (!picked) console.warn(`    ⚠️ ${shot.label}: ${shot.pick} 항목을 열지 못했습니다 (빈 상세로 캡처될 수 있음)`);
      }
      await clearOverlays(page);

      const png = await page.screenshot({ type: 'png' });
      const outPath = path.join(OUT_DIR, `q-${shot.key}.webp`);
      const { bytes, quality } = await optimize(png, outPath);
      console.log(`  ${shot.label.padEnd(7)} ${shot.route.padEnd(8)} → q-${shot.key}.webp  ${(bytes / 1024).toFixed(0)} KB (q${quality})`);
      if (bytes > MAX_BYTES) console.warn(`    ⚠️ ${MAX_BYTES / 1024}KB 초과 — 품질 하한(40)에서도 초과했습니다`);
    }

    console.log(`\n완료 — ${OUT_DIR}`);
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error('실패:', err.message);
  console.error(err);
  process.exit(1);
});
