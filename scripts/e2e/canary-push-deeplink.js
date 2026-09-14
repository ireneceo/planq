// scripts/e2e/canary-push-deeplink.js — 알림을 눌러 앱이 **실제로 그 화면에 닿는가** (2026-09-14)
//
// Irene: *"모바일에서 알림이오면 눌러서 갈 수가 없어 커넥션 문제라고 나와 모든 알림 다."*
//
// 그날의 모양: 콜드 스타트에서 딥링크가 SPA 로 못 가면(tabStore 미러 통로가 아직 없다) 400ms 뒤
//   `location.assign` 으로 **문서 전체를 다시 로드**했다. 앱 기동 중의 그 로드가 한 번 실패하면
//   Capacitor 가 errorPath(번들 안 오프라인 화면)로 떨어뜨리는데, 그 화면의 [다시 시도] 는
//   `location.reload()` 라 **로컬 파일을 다시 읽을 뿐** — 거기서 영영 못 나왔다.
//
// 정적 검사로 못 잡는 것만 본다:
//   ① 콜드 스타트 딥링크가 **문서 로드 없이** 목적지에 닿는가 (문서 단위 카운터로 센다 —
//      framenavigated 는 SPA pushState 에도 떠서 못 가른다. 실제로 그걸로 재다가 3건을 오판했다)
//   ② 그래도 폴백이 필요할 때 **여전히 살아 있는가** (양성 대조군: SPA 이동을 막는다)
//   ③ 오프라인 폴백 화면이 **서버로 나가는가** — 사람이 눌렀을 때 · 가만히 둬도(앱이 앞에 나온 순간)
//   ④ 그 URL 이 **그 플랫폼의 server.url 과 같은가** (dev 빌드가 운영을 가리키면 안 된다)
const fs = require('fs');
const path = require('path');
const puppeteer = require('/opt/planq/dev-backend/node_modules/puppeteer');
const { launch, login, sleep, dismissBlockers, BASE } = require('./lib/browser');

const ROOT = '/opt/planq';
const KEY = 'planq_pending_push_link';
const LINKS = ['/talk?conv=7', '/tasks?task=257', '/mail'];
const PLATFORMS = [
  { name: 'android', cfg: 'dev-frontend/android/app/src/main/assets/capacitor.config.json', page: 'dev-frontend/android/app/src/main/assets/public/index.html' },
  { name: 'ios', cfg: 'dev-frontend/ios/App/App/capacitor.config.json', page: 'dev-frontend/ios/App/App/public/index.html' },
];

const results = [];
const push = (name, pass, detail) => results.push({ name, fail: !pass, details: detail ? [detail] : [] });

// ── ①② 콜드 스타트 딥링크 ───────────────────────────────────
async function coldStart(link, { blockSpa = false } = {}) {
  const { browser, page } = await launch({ mobile: true });
  try {
    await login(page);
    await page.evaluateOnNewDocument((k, v) => {
      try {
        const n = Number(sessionStorage.getItem('pq_doc_loads') || 0) + 1;
        sessionStorage.setItem('pq_doc_loads', String(n));
        if (n === 1) sessionStorage.setItem(k, v);   // 보관 링크는 첫 문서에만(매번 심으면 인위적 루프)
      } catch (e) { /* 무시 */ }
    }, KEY, link);
    if (blockSpa) {
      await page.evaluateOnNewDocument(() => { History.prototype.pushState = function () {}; });
    }
    await page.goto(BASE + '/inbox', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(6500);                                // 폴백(2.4s)이 터지고도 남을 시간
    await dismissBlockers(page);
    // ★ `return await` 여야 한다 — 그냥 return 하면 promise 만 돌려주고 finally 의 close() 가
    //   **먼저** 돌아 "Target closed" 로 죽는다(처음에 그렇게 짜서 한 번 겪었다).
    return await page.evaluate(() => ({
      here: location.pathname + location.search,
      loads: Number(sessionStorage.getItem('pq_doc_loads') || 0),
    }));
  } finally { await browser.close(); }
}

// ── ③ 오프라인 폴백 화면 ────────────────────────────────────
async function offlineProbe(file, act) {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    const tried = [];
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      if (r.isNavigationRequest() && !r.url().startsWith('file://')) { tried.push(r.url()); r.abort().catch(() => {}); return; }
      r.continue().catch(() => {});
    });
    await page.goto('file://' + file, { waitUntil: 'domcontentloaded' });
    await act(page);
    await sleep(2500);
    return tried;
  } finally { await browser.close(); }
}

async function run() {
  for (const link of LINKS) {
    const r = await coldStart(link);
    push(`콜드스타트 딥링크 ${link}`, r.here === link && r.loads === 1,
      `도착 ${r.here} · 문서로드 ${r.loads}회 (기대: ${link} · 1회)`);
  }
  // 양성 대조군 — SPA 이동을 막으면 폴백이 터져 문서로드가 2회여야 한다. 0건이면 폴백이 죽은 것.
  const ctl = await coldStart('/mail', { blockSpa: true });
  push('양성 대조군: SPA 이동을 막으면 폴백이 착지시킨다', ctl.here === '/mail' && ctl.loads >= 2,
    `도착 ${ctl.here} · 문서로드 ${ctl.loads}회 (기대 ≥2)`);

  for (const p of PLATFORMS) {
    const cfgPath = path.join(ROOT, p.cfg);
    const pagePath = path.join(ROOT, p.page);
    if (!fs.existsSync(cfgPath) || !fs.existsSync(pagePath)) { push(`${p.name} 오프라인 폴백`, false, '생성물 없음 — cap sync 필요'); continue; }
    const url = ((JSON.parse(fs.readFileSync(cfgPath, 'utf8')).server) || {}).url || '';
    const want = url.replace(/\/$/, '') + '/';
    const clicked = await offlineProbe(pagePath, async (pg) => { await pg.click('#retry'); });
    push(`${p.name} 오프라인 폴백 [다시 시도] → ${want}`, clicked.includes(want), `시도한 주소 ${JSON.stringify(clicked)}`);
    const auto = await offlineProbe(pagePath, async () => { /* 가만히 둔다 */ });
    push(`${p.name} 오프라인 폴백 자동 복귀 → ${want}`, auto.includes(want), `시도한 주소 ${JSON.stringify(auto)}`);
  }

  // 음성 대조군 — 옛 방식(location.reload)은 서버로 **못 나간다**. 검사기가 그걸 구별하는지.
  const tmp = path.join('/tmp', 'pq-old-offline.html');
  fs.writeFileSync(tmp, '<body><button id="retry">다시 시도</button><script>document.getElementById("retry").addEventListener("click",function(){location.reload();});</script></body>');
  const old = await offlineProbe(tmp, async (pg) => { await pg.click('#retry'); });
  fs.unlinkSync(tmp);
  push('음성 대조군: 옛 location.reload 는 서버로 못 나간다', old.length === 0, `서버 요청 ${old.length}건 (0 이어야 정상)`);

  return results;
}

module.exports = { name: 'push-deeplink', run };
