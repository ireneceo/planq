// canary-scope-tabs — 상단 탭은 **지금 있는 자리(워크스페이스·플랫폼 관리자)의 것만** 이어야 한다.
//
//   Irene 2026-09-08: "플랫폼관리자랑 다른 워크스페이스 갈 때 에러 안나오고 상단 탭이 해당
//                      워크스페이스나 플랫폼관리자 기준으로 바뀌어야 해."
//   앞선 신고: "다른 워크스페이스 만들어서 갔는데도 워프로랩 탭 열려있던게 나와."
//
//   #405 로 저장 키는 범위별로 갈렸지만, **기록 시점이 범위 전환보다 앞서** 있었다:
//   경로가 먼저 바뀌고(→ 그 순간의 범위 = 옛 범위에 새 경로가 탭으로 박힘) 그 다음에
//   MainLayout 의 effect 가 setTabScope 를 건다. 그래서 플랫폼 관리자로 들어가면
//   **워크스페이스 쪽 목록에 관리자 탭이 남고**, 돌아오면 그 탭이 같이 열려 있었다.
//   저장 키만 보면 갈라져 있어 정상으로 보인다 — 그래서 여기서는 **키 안의 내용**까지 본다.
//
//   판정: ①범위별 탭 목록이 서로의 경로를 갖지 않는다 ②왕복 후 원래 탭이 그대로 돌아온다
//         ③전환 중 에러(pageerror·요청 실패·ErrorBoundary) 0
const b = require('./lib/browser');
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env', quiet: true });
const { sequelize } = require('/opt/planq/dev-backend/config/database');

const A = 5;   // Health Check Biz
const B = 6;   // PlanQ 테스트 워크스페이스
const TMP = { email: `scope-canary-${Date.now()}@test.planq.kr`, password: 'ScopeCanary2026!', name: 'Scope Canary' };
const CRASH_RE = /Something went wrong|Minified React error|문제가 발생/i;

const snap = (page) => page.evaluate(() => {
  const strip = document.querySelector('[data-testid="tabstrip"]');
  const tabs = strip ? Array.from(strip.querySelectorAll('[role="tab"],button'))
    .map((e) => (e.innerText || '').trim().split('\n')[0]).filter(Boolean) : null;
  const store = {};
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i);
    if (k && k.startsWith('planq_tabs_v1')) {
      try { store[k] = (JSON.parse(sessionStorage.getItem(k)).tabs || []).map((t) => t.path); }
      catch { store[k] = ['<parse fail>']; }
    }
  }
  return { url: location.pathname, tabs, store, body: (document.body.innerText || '').slice(0, 300) };
});

async function click(page, testid) {
  await page.waitForSelector(`[data-testid="${testid}"]`, { timeout: 10000 });
  await page.click(`[data-testid="${testid}"]`);
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });
  let uid = null;
  const { browser, page } = await b.launch();
  // ★ 데스크탑 폭을 명시한다 — lib/browser 의 기본 뷰포트(800×600)는 태블릿 분기라
  //   사이드바가 화면 밖(x=-232)에 있어 스위처를 누를 수 없다(실측). 탭 막대도 이 폭부터다.
  await page.setViewport({ width: 1400, height: 900 });
  const errs = [], failed = [];
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 160)));
  page.on('requestfailed', (r) => {
    const t = r.failure() && r.failure().errorText;
    if (t && !/ERR_ABORTED/.test(t)) failed.push(`${t} ${r.url().slice(0, 80)}`);
  });
  try {
    const bcrypt = require('/opt/planq/dev-backend/node_modules/bcryptjs');
    const hash = await bcrypt.hash(TMP.password, 12);
    // ★ 약관 버전을 현재값으로 맞춰 둔다 — 안 그러면 TermsReacceptModal 의 전면 백드롭
    //   (fixed·inset:0·z-index 300)이 사이드바를 덮어 스위처를 **누를 수 없다**(실측).
    const [[ps]] = await sequelize.query('SELECT terms_version, privacy_version FROM platform_settings LIMIT 1');
    const [id] = await sequelize.query(
      `INSERT INTO users (email, password_hash, name, username, platform_role, active_business_id,
                          terms_version, terms_accepted_at, privacy_version, privacy_accepted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'platform_admin', ?, ?, NOW(), ?, NOW(), NOW(), NOW())`,
      { replacements: [TMP.email, hash, TMP.name, `sccan${Date.now()}`, A,
                       (ps && ps.terms_version) || '1.0', (ps && ps.privacy_version) || '1.0'] });
    uid = id;
    for (const biz of [A, B]) {
      await sequelize.query(
        "INSERT INTO business_members (business_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'admin', NOW(), NOW())",
        { replacements: [biz, uid] });
    }

    await b.login(page, TMP);
    await b.goto(page, '/talk');
    await b.sleep(1500);
    // 워크스페이스 A 에서 탭 3개
    await b.gotoSPA(page, '/tasks');
    await b.gotoSPA(page, '/files');
    await b.sleep(1200);
    const s1 = await snap(page);
    const aTabs = (s1.store[`planq_tabs_v1::b${A}`] || []);
    push('① A 에서 탭 3개가 A 키에 쌓인다', aTabs.length === 3, `::b${A} = ${JSON.stringify(aTabs)}`);

    // ② 플랫폼 관리자로 (사이드바 스위처 실클릭)
    errs.length = 0; failed.length = 0;
    await click(page, 'ws-switcher-trigger');
    await b.sleep(400);
    await click(page, 'ws-switcher-admin');
    await b.sleep(3000);
    const s2 = await snap(page);
    const adminTabs = s2.store['planq_tabs_v1::admin'] || [];
    const aAfterAdmin = s2.store[`planq_tabs_v1::b${A}`] || [];
    push('② 관리자 화면의 탭은 관리자 경로만',
      adminTabs.length > 0 && adminTabs.every((p) => p.startsWith('/admin')),
      `::admin = ${JSON.stringify(adminTabs)}`);
    push('② 워크스페이스 목록에 관리자 탭이 안 남는다',
      aAfterAdmin.length > 0 && !aAfterAdmin.some((p) => p.startsWith('/admin')),
      `::b${A} = ${JSON.stringify(aAfterAdmin)}`);
    push('② 관리자 진입 중 에러 0', errs.length === 0 && failed.length === 0 && !CRASH_RE.test(s2.body),
      `pageerror ${errs.length} ${JSON.stringify(errs.slice(0, 2))} · 요청실패 ${failed.length} ${JSON.stringify(failed.slice(0, 3))}` +
      (CRASH_RE.test(s2.body) ? ` · 🔴 화면: ${JSON.stringify(s2.body.slice(0, 120))}` : ''));

    // ③ 관리자 → 워크스페이스 A 로 복귀 (왕복 복원 — 2026-09-08 까지 미실측이던 구간)
    errs.length = 0; failed.length = 0;
    await click(page, 'ws-switcher-trigger');
    await b.sleep(400);
    await click(page, `ws-switcher-item-${A}`);
    await b.sleep(4500);
    const s3 = await snap(page);
    const aBack = s3.store[`planq_tabs_v1::b${A}`] || [];
    push('③ A 로 돌아오면 A 탭이 그대로', aBack.length === 3 && !aBack.some((p) => p.startsWith('/admin')),
      `::b${A} = ${JSON.stringify(aBack)} · 화면 탭 ${JSON.stringify(s3.tabs)}`);
    push('③ 화면 탭 막대에도 관리자 탭이 없다',
      !!s3.tabs && !s3.tabs.some((t) => /설정|관리자/.test(t)),
      `탭 = ${JSON.stringify(s3.tabs)}`);
    push('③ 복귀 중 에러 0', errs.length === 0 && failed.length === 0 && !CRASH_RE.test(s3.body),
      `pageerror ${errs.length} ${JSON.stringify(errs.slice(0, 2))} · 요청실패 ${failed.length} ${JSON.stringify(failed.slice(0, 3))}`);

    // ④ A → B (다른 워크스페이스). B 는 자기 탭만 가져야 한다.
    errs.length = 0; failed.length = 0;
    await click(page, 'ws-switcher-trigger');
    await b.sleep(400);
    await click(page, `ws-switcher-item-${B}`);
    await b.sleep(5000);
    const s4 = await snap(page);
    const bTabs = s4.store[`planq_tabs_v1::b${B}`] || [];
    push('④ B 는 자기 범위 키를 갖는다', bTabs.length > 0, `::b${B} = ${JSON.stringify(bTabs)}`);
    push('④ B 에 A 의 탭이 안 따라온다',
      bTabs.length > 0 && !bTabs.some((p) => p.startsWith('/tasks') || p.startsWith('/files')),
      `::b${B} = ${JSON.stringify(bTabs)} · 화면 탭 ${JSON.stringify(s4.tabs)}`);
    push('④ 워크스페이스 전환 중 에러 0', errs.length === 0 && failed.length === 0 && !CRASH_RE.test(s4.body),
      `pageerror ${errs.length} ${JSON.stringify(errs.slice(0, 2))} · 요청실패 ${failed.length} ${JSON.stringify(failed.slice(0, 3))}` +
      (CRASH_RE.test(s4.body) ? ` · 🔴 화면: ${JSON.stringify(s4.body.slice(0, 120))}` : ''));
  } catch (e) {
    results.push({ name: 'scope-tabs:하니스', error: true, fatal: 1, details: [e.message] });
  } finally {
    if (uid) {
      await sequelize.query('DELETE FROM business_members WHERE user_id = ?', { replacements: [uid] }).catch(() => null);
      await sequelize.query('DELETE FROM refresh_tokens WHERE user_id = ?', { replacements: [uid] }).catch(() => null);
      await sequelize.query('DELETE FROM users WHERE id = ?', { replacements: [uid] }).catch(() => null);
    }
    await browser.close().catch(() => null);
  }
  return results;
}

module.exports = { name: 'scope-tabs — 탭은 지금 있는 자리의 것만', run };
if (require.main === module) run().then((r) => { r.forEach((x) => console.log((x.fail || x.fatal ? '❌' : '✅'), x.name, '—', (x.details || []).join(' '))); });
