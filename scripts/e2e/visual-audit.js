// scripts/e2e/visual-audit.js — 전 화면 비주얼 감사: 모바일+데스크탑 스크린샷 + 품질 신호.
//   출력 PNG 를 사람/Claude 가 직접 보고 "허접한 디테일" 을 전수 점검. INSPECTION_PLAYBOOK §8.
const fs = require('fs');
const path = require('path');
const b = require('./lib/browser');

const OUT = process.env.AUDIT_OUT || '/tmp/planq-audit';

// 알려진 잔여 아티팩트: /mail(requiredRole 라우트)은 감사 후반 누적 헤드리스 쿠키 소실 시 /login 으로
//   바운스할 수 있다. 제품 버그 아님(로그인 직후 첫 방문·mobile-keyboard 스위트에선 정상 확인). 스크린샷은
//   그대로 생성되므로 사람 리뷰엔 지장 없음. redirect 플래그는 보조 휴리스틱으로만 취급.
// 운영 핵심(워크스페이스/개인 앱) 화면. 마케팅/admin/auth 는 2차.
const ROUTES = [
  '/dashboard', '/inbox', '/tasks', '/todo', '/talk', '/calendar', '/notes', '/docs',
  '/files', '/mail', '/bills', '/insights', '/wiki', '/records', '/info', '/knowledge',
  '/signatures/received', '/personal-vault',
  '/business/clients', '/business/members', '/business/org', '/business/settings',
  '/profile', '/me/work-settings', '/profile/integrations',
];

async function shoot(page, route, label, viewport) {
  await page.setViewport(viewport);
  // 하드 goto 반복은 앱 리부트마다 refresh 토큰 rotation 이 겹쳐 세션이 죽고(/mail·/files 가 /login 으로
  //   튕기는 오탐), /insights 등도 공개 랜딩으로 잘못 잡힌다(browser.js:39). run() 에서 1회만 full goto 로
  //   부팅·인증하고, 이후 라우트 전환은 SPA 네비로 — 실제 인앱 상태를 아티팩트 없이 캡처.
  await b.gotoSPA(page, route);
  await b.sleep(1200);
  // 회복 안전망 — 헤드리스에서 rotated refresh 쿠키가 깔끔히 persist 안 되면 백그라운드 refresh 가
  //   no_cookie 로 실패→accessToken=null→미인증→/login 바운스(특히 requiredRole 라우트). 실제 제품
  //   버그가 아닌 하니스 쿠키 아티팩트이므로, /login 으로 튕기면 1회 full goto 로 재부팅·재인증 후 재캡처.
  if (!route.startsWith('/login') && page.url().replace(b.BASE, '').startsWith('/login')) {
    await b.login(page).catch(() => {});   // 쿠키 재확립 (누적 소실 회복)
    await page.goto(b.BASE + route, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
    await b.sleep(1200);
  }
  const redirected = page.url().replace(b.BASE, '');
  // 품질 신호 수집
  const signal = await page.evaluate(() => {
    const txt = (document.body.innerText || '').trim();
    return {
      textLen: txt.length,
      hScroll: document.documentElement.scrollWidth - window.innerWidth,
      emptyHint: /No data|없습니다|비어|아직 없|empty/i.test(txt) && txt.length < 400,
      loadingStuck: /로드 중|loading|불러오는/i.test(txt) && txt.length < 200,
      h1: (document.querySelector('h1, [class*=Title]') || {}).innerText || null,
    };
  }).catch(() => ({}));
  const file = path.join(OUT, `${route.replace(/[\/]/g, '_').replace(/^_/, '')}__${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return { route, label, redirected, file, ...signal };
}

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  const results = [];
  const { browser, page } = await b.launch({ mobile: false });
  try {
    await b.login(page);
    // 최초 1회 full goto 로 앱 부팅·인증 (메모리 access 토큰 확보). 이후 shoot 은 SPA 네비만 사용.
    await page.goto(b.BASE + '/dashboard', { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
    await b.sleep(1200);
    for (const route of ROUTES) {
      const m = await shoot(page, route, 'mobile', { width: 375, height: 812, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      const d = await shoot(page, route, 'desktop', { width: 1280, height: 800, deviceScaleFactor: 1 });
      results.push({ route, mobile: m, desktop: d });
      const flags = [];
      if (m.redirected !== route && !m.redirected.startsWith(route)) flags.push(`리다이렉트→${m.redirected}`);
      if (m.hScroll > 1) flags.push(`모바일 가로스크롤 ${m.hScroll}px`);
      if (d.hScroll > 1) flags.push(`데스크탑 가로스크롤 ${d.hScroll}px`);
      if (m.loadingStuck) flags.push('로딩 멈춤 의심');
      if (m.textLen < 60) flags.push(`내용 거의 없음(${m.textLen}자)`);
      console.log(`${flags.length ? '⚠️' : '·'} ${route} — h1:${(m.h1 || '').slice(0, 24)} ${flags.join(' / ')}`);
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(OUT, '_index.json'), JSON.stringify(results, null, 1));
  console.log(`\n스크린샷 ${results.length * 2}장 → ${OUT}`);
  return results;
}

module.exports = { run, name: 'visual-audit', OUT };
if (require.main === module) run().then(() => process.exit(0)).catch((e) => { console.error('FATAL', e.message); process.exit(2); });
