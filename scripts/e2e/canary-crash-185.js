require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
// canary-crash-185 — 운영에서 실제로 난 **React #185(무한 setState)** 경로를 돈다 (2026-09-09)
//
//   운영 로그 `[client-crash]` 8건(2026-09-08T17:13~21:26Z)이 전부 #185 였고,
//   trail 이 두 가지 모양을 가리켰다:
//     ① "워크스페이스 전환 → 플랫폼 관리자"  (그리고 그 **반대 방향**)
//     ② "#tabstrip-close 연속"
//   지목된 화면: QTaskPage 2 · QTalkPage 3 · PlanQSelect 2 · /admin/users 1.
//
//   그 뒤 v1.48.16(탭에 워크스페이스 도장)이 나갔고 19시간 동안 0건이다.
//   ★ 그래서 이 카나리의 목적은 "고쳤다" 를 증명하는 것이 **아니다** —
//     같은 것이 **다시 나면 운영에 도달하기 전에** 잡는 것이다.
//     재현이 안 되는 것과 없어진 것은 다르다.
//
//   ★ 왕복을 **양방향으로** 돈다. 처음 재현 시도는 워크스페이스→관리자만 탔고
//     "통과" 가 떴는데, 정작 운영 크래시는 **관리자→워크스페이스** 쪽(/talk·/docs)에서 났다.
//     한 방향만 재면 초록이 거짓말한다.
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const bcrypt = require('/opt/planq/dev-backend/node_modules/bcryptjs');
const b = require('./lib/browser');

const A = 5;   // 워프로랩
const B = 6;   // PlanQ 테스트
const TMP = { email: `crash185-${Date.now()}@test.planq.kr`, password: 'Crash185Canary2026!', name: 'Crash185 Canary' };
// ErrorBoundary 는 ko/en 을 하드코딩해 두고 사용자 언어로 고른다 — 둘 다 본다(admin-crawl 의 교훈).
const CRASH_RE = /문제가 발생했습니다|예기치 못한 오류|Something went wrong|unexpected error occurred|Minified React error/i;
const R185_RE = /#185|Maximum update depth/;

async function click(page, testid) {
  await page.waitForSelector(`[data-testid="${testid}"]`, { timeout: 10000 });
  await page.click(`[data-testid="${testid}"]`);
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });
  let uid = null;
  const { browser, page } = await b.launch();
  // 데스크탑 폭 — 좁으면 사이드바가 화면 밖이라 스위처를 누를 수 없다(scope-tabs 의 실측).
  await page.setViewport({ width: 1400, height: 900 });
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e.message).slice(0, 140)));
  page.on('console', (m) => { const t = m.text(); if (R185_RE.test(t)) errs.push(t.slice(0, 140)); });

  const state = () => page.evaluate((re) => ({
    path: location.pathname,
    crashed: new RegExp(re, 'i').test(document.body.innerText || ''),
    len: (document.body.innerText || '').replace(/\s+/g, ' ').trim().length,
  }), CRASH_RE.source);

  try {
    const hash = await bcrypt.hash(TMP.password, 12);
    // 약관 재동의 모달이 뜨면 전면 백드롭이 스위처를 덮는다 — 현재 버전으로 맞춰 둔다.
    const [[ps]] = await sequelize.query('SELECT terms_version, privacy_version FROM platform_settings LIMIT 1');
    const [id] = await sequelize.query(
      `INSERT INTO users (email, password_hash, name, username, platform_role, active_business_id,
                          terms_version, terms_accepted_at, privacy_version, privacy_accepted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'platform_admin', ?, ?, NOW(), ?, NOW(), NOW(), NOW())`,
      { replacements: [TMP.email, hash, TMP.name, `c185${Date.now()}`, A,
                       (ps && ps.terms_version) || '1.0', (ps && ps.privacy_version) || '1.0'] });
    uid = id;
    for (const biz of [A, B]) {
      await sequelize.query(
        "INSERT INTO business_members (business_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'admin', NOW(), NOW())",
        { replacements: [biz, uid] });
    }

    await b.login(page, TMP);

    // ─── ① 관리자 ↔ 워크스페이스 **양방향** 왕복 ───
    //   운영 crash 는 /talk·/docs 에서 났다 = 관리자에서 **돌아온** 쪽이다.
    const legs = [
      ['/talk', 'ws-switcher-admin', '^/admin'],
      [null, `ws-switcher-item-${A}`, '^/(?!admin)'],
      [null, 'ws-switcher-admin', '^/admin'],
      [null, `ws-switcher-item-${B}`, '^/(?!admin)'],
      [null, 'ws-switcher-admin', '^/admin'],
      [null, `ws-switcher-item-${A}`, '^/(?!admin)'],
    ];
    let reached = 0;
    for (let i = 0; i < legs.length; i++) {
      const [goto_, target, expect] = legs[i];
      if (goto_) { await b.goto(page, goto_); await b.sleep(2000); }
      errs.length = 0;
      await click(page, 'ws-switcher-trigger');
      await b.sleep(600);
      await click(page, target);
      await b.sleep(2200);
      const s = await state();
      const did = new RegExp(expect).test(s.path);
      if (did) reached++;
      push(`전환 ${i + 1}/${legs.length} (${target})`, errs.length === 0 && !s.crashed,
        `path=${s.path} 본문 ${s.len}자${did ? '' : ` ← 기대 ${expect} · **동작 안 함**`}${s.crashed ? ' · 크래시 화면' : ''}${errs.length ? ' · ' + JSON.stringify(errs.slice(0, 1)) : ''}`);
    }
    // ★ 이동이 실제로 일어났는지 자체를 판정한다 — 안 움직였으면 위 초록은 아무 의미가 없다
    //   (첫 재현 시도가 정확히 그랬다: 경로가 /talk 그대로인 채 전부 통과였다).
    push('전환이 실제로 일어났다', reached === legs.length, `${reached}/${legs.length} 도달`);

    // ─── ② 탭 연속 닫기 (trail: #tabstrip-close ×5) ───
    for (const p of ['/tasks', '/docs', '/files', '/bills']) { await b.gotoSPA(page, p); await b.sleep(900); }
    const opened = await page.evaluate(() => document.querySelectorAll('[data-testid^="tabstrip-close"]').length);
    errs.length = 0;
    for (let i = 0; i < 5; i++) {
      const gone = await page.evaluate(() => {
        const c = [...document.querySelectorAll('[data-testid^="tabstrip-close"]')];
        if (!c.length) return true;
        c[c.length - 1].click();
        return false;
      });
      if (gone) break;
      await b.sleep(700);
    }
    const s2 = await state();
    push('탭 연속 닫기', errs.length === 0 && !s2.crashed,
      `닫기 버튼 ${opened}개에서 시작 · path=${s2.path} 본문 ${s2.len}자${s2.crashed ? ' · 크래시 화면' : ''}${errs.length ? ' · ' + JSON.stringify(errs.slice(0, 1)) : ''}`);
    push('탭이 실제로 열려 있었다', opened >= 2, `닫기 버튼 ${opened}개 (2개 미만이면 이 검사는 아무것도 안 한 것)`);

    // ─── ③ 크래시가 잦았던 화면을 관리자 상태에서 직접 ───
    for (const route of ['/admin/users', '/inbox', '/talk']) {
      errs.length = 0;
      await b.goto(page, route);
      await b.sleep(2500);
      const s = await state();
      push(`화면 ${route}`, errs.length === 0 && !s.crashed,
        `본문 ${s.len}자${s.crashed ? ' · 크래시 화면' : ''}${errs.length ? ' · ' + JSON.stringify(errs.slice(0, 1)) : ''}`);
    }
  } catch (e) {
    // ★ 여기서 **앱이 죽은 것**과 **검사기가 죽은 것**을 반드시 가른다.
    //   양성 대조군(렌더 중 setState)에서 실제로 겪었다 — 앱이 통째로 크래시해 사이드바가
    //   렌더되지 않자 스위처 selector 가 타임아웃했고, 메시지가 "하니스 오류" 로 나왔다.
    //   그 문구를 그대로 두면 **사람이 하니스 탓으로 무시한다**
    //   (memory feedback_red_check_may_be_real_bug).
    let st = null;
    try { st = await state(); } catch { /* 페이지 자체를 못 읽으면 아래에서 미상으로 적는다 */ }
    const sawR185 = errs.some((x) => R185_RE.test(x));
    if ((st && st.crashed) || sawR185) {
      push('🔴 앱 크래시', false,
        `**제품이 죽었다** — ${sawR185 ? 'React #185 감지' : '크래시 화면'} · path=${st ? st.path : '?'} · 본문 ${st ? st.len : '?'}자`
        + `${errs.length ? ' · ' + JSON.stringify(errs.slice(0, 2)) : ''}`
        + ` (검사기가 멈춘 것이 아니다: ${e.message.slice(0, 60)})`);
    } else {
      push('하니스', false, `검사기 오류(제품 크래시 신호 없음): ${e.message.slice(0, 120)}`
        + ` · path=${st ? st.path : '?'} 본문 ${st ? st.len : '?'}자`);
    }
  } finally {
    await browser.close().catch(() => null);
    if (uid) {
      await sequelize.query('DELETE FROM business_members WHERE user_id = ?', { replacements: [uid] }).catch(() => null);
      await sequelize.query('DELETE FROM users WHERE id = ?', { replacements: [uid] }).catch(() => null);
    }
  }
  return results;
}

module.exports = { name: 'crash185', run };

if (require.main === module) {
  run().then((rs) => {
    let bad = 0;
    rs.forEach((r) => { if (r.fail) bad++; console.log(`${r.fail ? '❌' : '✅'} ${r.name} — ${r.details[0]}`); });
    console.log(bad ? `\n실패 ${bad}/${rs.length}` : `\n통과 ${rs.length}/${rs.length}`);
    process.exit(bad ? 1 : 0);
  }).catch((e) => { console.error('🔴 하니스 오류:', e.message); process.exit(2); });
}
