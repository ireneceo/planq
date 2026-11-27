// canary-phone-bands — 폰(≤640) 상세 밴드2 한 줄 · 버튼 1개 · 나머지는 ⋯ (2026-11-27)
//
//   Irene: "문서랑 다른 리스트들이나 상세에서 상단에 버튼들이 너무 많아서 보기가 어려운데 모바일에서 보기 쉽게
//           위에 접기나 … 내용만 보기 … 메일에 있지" → «권고대로» · Fable 설계(.claude/rules/ui-layout.md «폰 밴드2 는 한 줄»)
//   코드: PostsPage(phonePrimary·phoneMenuItems·«내용만 보기») · MailPage(isPhone 팔로우 → ⋯) · TaskDetailDrawer(metaCollapsible)
//         · PanelHeader DetailMetaBar $phoneOneLine
//
// 재는 것 (owner · ws6 · 폰 375×667 · 390×844 / 데스크탑 1440×900):
//   문서  ① 밴드2 높이 ≤ 60 ② 밴드 오른쪽에 보이는 글자 버튼 ≤ 1 · 아이콘 ≤ 1 ③ 본문 시작 ≤ 화면 30%
//         ④ 문 보존·중복 0 — 밴드에 없는 문(AI 수정·공유·서명·복사)은 ⋯ 에 있고 [편집] 은 ⋯ 에 없다
//         ⑤ «내용만 보기» — 켜면 판(docs-focus-surface)이 서고 밴드2 가 숨는다 · 뒤로 가기 1회에 판만 닫히고 ?post 유지
//   메일  ① ② ③ + 팔로우는 ⋯ 로(밴드엔 없음)
//   업무  속성이 접혀 있고(요약 줄) 설명 칸이 화면 60% 안에서 시작
//   데스크탑 — 문서 밴드 5문 + 내용만 보기 그대로 · ⋯ 에 폰 항목 없음 · 메일 [팔로우] 밴드 · 업무 접기 없음
//   대조군 — 같은 판정을 태블릿 700 폭에 대면 ②가 빨강이어야 한다(측정기가 폭을 가른다는 증명)
require('./lib/mem-slot');
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env', quiet: true });
const crypto = require('crypto');
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const b = require('./lib/browser');

const BASE = process.env.E2E_BASE || 'https://dev.planq.kr';
const API = BASE + '/api';
const b64u = (x) => Buffer.from(x).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
function devCode(as, next = '/') {
  const p = b64u(JSON.stringify({ as, scope: { ws: 6 }, exp: Date.now() + 90000, n: crypto.randomUUID(), next }));
  return `v1.${p}.${b64u(crypto.createHmac('sha256', process.env.DEV_LOGIN_SECRET).update(p).digest())}`;
}
const FIX_TITLE = '[확인용] 폰 밴드 긴 문서';

// 밴드 오른쪽(마지막 자식)에서 **보이는** 버튼 — 화면 안 · elementFromPoint 로 실제 그려짐
const BAND = `(sel) => {
  // 탭을 살려 두는 화면이라 같은 밴드가 숨은 채 여러 벌 있을 수 있다 — 보이는 것만
  const band = [...document.querySelectorAll(sel)].find((x) => { const q = x.getBoundingClientRect(); return q.width > 0 && q.height > 0; });
  if (!band) return { found: false };
  const r = band.getBoundingClientRect();
  const right = band.lastElementChild;
  const btns = right ? [...right.querySelectorAll('button')] : [];
  const vis = btns.filter((x) => {
    const q = x.getBoundingClientRect();
    if (q.width <= 0 || q.height <= 0 || q.right > innerWidth + 1 || q.left < -1) return false;
    const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
    return !!hit && (hit === x || x.contains(hit));
  });
  const text = vis.filter((x) => (x.innerText || '').trim().length > 0).map((x) => x.getAttribute('data-testid') || x.innerText.trim());
  const icon = vis.filter((x) => !(x.innerText || '').trim()).map((x) => x.getAttribute('data-testid') || x.getAttribute('aria-label'));
  return { found: true, h: Math.round(r.height), bottom: Math.round(r.bottom), text, icon, ids: btns.map((x) => x.getAttribute('data-testid')).filter(Boolean) };
}`;
const menuIds = (page) => page.evaluate(() => [...document.querySelectorAll('[role="menu"] [data-testid], [role="menuitem"][data-testid], [role="menuitemcheckbox"][data-testid]')]
  .map((x) => x.getAttribute('data-testid')));

async function openMenu(page, trigger) {
  await page.click(trigger);
  await b.sleep(700);
  const ids = await menuIds(page);
  await page.keyboard.press('Escape');
  await b.sleep(400);
  return ids;
}

async function run() {
  const results = [];
  const push = (name, ok, detail) => results.push({ name, fail: ok ? 0 : 1, details: [detail] });
  let browser;
  try {
    const lj = await (await fetch(API + '/auth/dev-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: devCode('owner') }) })).json();
    const token = lj?.data?.token;
    if (!token) throw new Error('dev-login 실패');
    await b.snoozeAttendancePrompt?.(token, 6);
    const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Workspace-Id': '6' };
    // 긴 문서 픽스처(재사용) — 짧은 문서는 패널이 스크롤하지 않아 거짓 결과가 난다(ui-layout «짧은 문서로 재면»)
    let [[doc]] = await sequelize.query("SELECT id FROM posts WHERE business_id=6 AND title=? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1", { replacements: [FIX_TITLE] });
    if (!doc) {
      const content = Array.from({ length: 60 }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `폰 밴드 확인용 문단 ${i + 1} — 본문이 화면보다 길어야 스크롤을 잰다.` }] }));
      const r = await (await fetch(API + '/posts', { method: 'POST', headers: H, body: JSON.stringify({ business_id: 6, title: FIX_TITLE, content_json: { type: 'doc', content }, kind: 'doc', status: 'published' }) })).json();
      doc = { id: r?.data?.id };
      if (!doc.id) throw new Error('픽스처 문서 생성 실패');
    }
    const [[thread]] = await sequelize.query('SELECT id FROM email_threads WHERE business_id=6 ORDER BY id DESC LIMIT 1');
    const [[task]] = await sequelize.query('SELECT id FROM tasks WHERE business_id=6 ORDER BY id DESC LIMIT 1');

    const launched = await b.launch({ mobile: true }); browser = launched.browser;
    const page = launched.page;
    await page.goto(`${BASE}/dev-login#code=${devCode('owner', `/docs?post=${doc.id}`)}`, { waitUntil: 'domcontentloaded' });
    // 로그인 교환이 끝나 문서 화면에 내려앉을 때까지(중간에 다른 주소로 가면 로그인이 끊긴다)
    for (let i = 0; i < 40 && /dev-login|\/login/.test(page.url()); i++) await b.sleep(500);
    await b.sleep(3000);
    await b.dismissBlockers?.(page).catch(() => {});

    const phoneVps = [{ width: 375, height: 667 }, { width: 390, height: 844 }];
    for (const vp of phoneVps) {
      const L = `${vp.width}`;
      await page.setViewport({ ...vp, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      // ── 문서
      await page.goto(`${BASE}/docs?post=${doc.id}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction((q) => [...document.querySelectorAll(q)].some((x) => x.getBoundingClientRect().height > 0), { timeout: 20000 }, '[data-testid="docs-view-meta"]')
        .catch(async (e) => { await page.screenshot({ path: (process.env.CLAUDE_JOB_DIR || '/tmp') + '/tmp/pb-fail.png' }).catch(() => null); const dbg = await page.evaluate(() => [document.querySelectorAll('[data-testid="docs-view-meta"]').length, document.title]).catch((x) => String(x)); throw new Error(e.message + ' @ ' + page.url() + ' ' + JSON.stringify(dbg)); });
      await b.sleep(1500); await b.dismissBlockers?.(page).catch(() => {});
      let m = await page.evaluate(`(${BAND})('[data-testid="docs-view-meta"]')`);
      push(`문서 ${L} ① 밴드2 한 줄(≤60px)`, m.found && m.h <= 60, JSON.stringify({ h: m.h }));
      push(`문서 ${L} ② 보이는 글자 버튼 ≤1 · 아이콘 ≤1`, m.found && m.text.length <= 1 && m.icon.length <= 1, JSON.stringify({ text: m.text, icon: m.icon }));
      push(`문서 ${L} ③ 본문 시작 ≤ 화면 30%`, m.found && m.bottom <= vp.height * 0.3, `${m.bottom} / ${Math.round(vp.height * 0.3)}`);
      const dm = await openMenu(page, '[data-testid="post-more"]');
      const need = ['post-ai-edit-menu', 'post-share-menu', 'post-sign-menu', 'post-duplicate-menu'];
      push(`문서 ${L} ④ 밴드에 없는 문은 ⋯ 에 · [편집] 은 ⋯ 에 없음`, need.every((x) => dm.includes(x)) && !dm.includes('post-edit-menu') && m.ids.includes('post-edit'),
        JSON.stringify({ menu: dm.filter((x) => /-menu$/.test(x)), band: m.ids }));
      // ⑤ 내용만 보기
      await page.click('[data-testid="docs-view-focus-toggle"]');
      await b.sleep(900);
      const f = await page.evaluate(() => {
        const s = document.querySelector('[data-testid="docs-focus-surface"]');
        const metas = [...document.querySelectorAll('[data-testid="docs-view-meta"]')];
        return { surface: !!s, metaHidden: metas.every((x) => x.getBoundingClientRect().height === 0) };
      });
      await page.goBack();
      await b.sleep(1200);
      const f2 = await page.evaluate(() => ({ surface: !!document.querySelector('[data-testid="docs-focus-surface"]'), url: location.href }));
      push(`문서 ${L} ⑤ 내용만 보기 — 판·밴드2 숨김 · 뒤로 가기에 판만 닫힘`, f.surface && f.metaHidden && !f2.surface && /post=/.test(f2.url),
        JSON.stringify({ on: f, after: f2 }));

      // ── 메일
      await page.goto(`${BASE}/mail?thread=${thread.id}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction((q) => [...document.querySelectorAll(q)].some((x) => x.getBoundingClientRect().height > 0), { timeout: 20000 }, '[data-testid="detail-meta-bar"]');
      await b.sleep(1500); await b.dismissBlockers?.(page).catch(() => {});
      m = await page.evaluate(`(${BAND})('[data-testid="detail-meta-bar"]')`);
      push(`메일 ${L} ① 밴드2 한 줄(≤60px)`, m.found && m.h <= 60, JSON.stringify({ h: m.h }));
      push(`메일 ${L} ② 보이는 글자 버튼 ≤1`, m.found && m.text.length <= 1 && !m.ids.includes('mail-detail-follow'), JSON.stringify({ text: m.text, ids: m.ids }));
      push(`메일 ${L} ③ 본문 시작 ≤ 화면 30%`, m.found && m.bottom <= vp.height * 0.3, `${m.bottom} / ${Math.round(vp.height * 0.3)}`);
      // ⋯ 는 밴드1(밴드2 바로 위 머리줄)의 OverflowMenu — 목록 쪽 머리줄과 헷갈리지 않게 표식을 달아 연다
      const marked = await page.evaluate(() => {
        let el = document.querySelector('[data-testid="detail-meta-bar"]');
        while (el && !(el.previousElementSibling && el.previousElementSibling.querySelector('button[aria-haspopup="menu"]'))) el = el.parentElement;
        const btn = el && [...el.previousElementSibling.querySelectorAll('button[aria-haspopup="menu"]')].pop();
        if (btn) btn.setAttribute('data-pb-more', '1');
        return !!btn;
      });
      const mailMenu = marked ? await openMenu(page, '[data-pb-more="1"]') : [];
      push(`메일 ${L} ④ 팔로우는 ⋯ 로`, mailMenu.includes('mail-detail-follow-menu'), JSON.stringify(mailMenu));

      // ── 업무
      await page.goto(`${BASE}/tasks?task=${task.id}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-testid="task-detail-meta-toggle"]', { visible: true, timeout: 20000 }).catch(() => null);
      await b.sleep(1500);
      const tk = await page.evaluate(() => {
        const tg = document.querySelector('[data-testid="task-detail-meta-toggle"]');
        const desc = document.querySelector('[data-testid="task-desc-focus-toggle"]');
        return { toggle: !!tg && tg.getAttribute('aria-expanded') === 'false', descTop: desc ? Math.round(desc.getBoundingClientRect().top) : null };
      });
      push(`업무 ${L} 속성 접힘 · 설명이 화면 60% 안`, tk.toggle && tk.descTop != null && tk.descTop < vp.height * 0.6, JSON.stringify(tk));
    }

    // ── 대조군: 태블릿 700 — 폰 판정 ②를 대면 빨강이어야 한다
    await page.setViewport({ width: 700, height: 900, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await page.goto(`${BASE}/docs?post=${doc.id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction((q) => [...document.querySelectorAll(q)].some((x) => x.getBoundingClientRect().height > 0), { timeout: 20000 }, '[data-testid="docs-view-meta"]');
    await b.sleep(1500);
    const ctl = await page.evaluate(`(${BAND})('[data-testid="docs-view-meta"]')`);
    push('대조군 700 — 폰 판정 ②가 뒤집힌다(글자 버튼 >1)', ctl.found && ctl.ids.filter((x) => ['post-ai-edit', 'post-edit', 'post-share', 'post-sign'].includes(x)).length >= 3,
      JSON.stringify({ ids: ctl.ids }));

    // ── 데스크탑 1440 — 종전 그대로
    await page.setViewport({ width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
    await page.goto(`${BASE}/docs?post=${doc.id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction((q) => [...document.querySelectorAll(q)].some((x) => x.getBoundingClientRect().height > 0), { timeout: 20000 }, '[data-testid="docs-view-meta"]');
    await b.sleep(1500);
    const dk = await page.evaluate(`(${BAND})('[data-testid="docs-view-meta"]')`);
    const dkMenu = await openMenu(page, '[data-testid="post-more"]');
    const five = ['post-ai-edit', 'post-edit', 'post-duplicate', 'post-share', 'post-sign', 'docs-view-focus-toggle'];
    push('데스크탑 문서 — 밴드 5문 + 내용만 보기 · ⋯ 에 폰 항목 없음', five.every((x) => dk.ids.includes(x)) && !dkMenu.some((x) => /-menu$/.test(x)),
      JSON.stringify({ band: dk.ids, menu: dkMenu }));
    await page.goto(`${BASE}/mail?thread=${thread.id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction((q) => [...document.querySelectorAll(q)].some((x) => x.getBoundingClientRect().height > 0), { timeout: 20000 }, '[data-testid="detail-meta-bar"]');
    await b.sleep(1500);
    const dmail = await page.evaluate(`(${BAND})('[data-testid="detail-meta-bar"]')`);
    push('데스크탑 메일 — [팔로우] 밴드에 그대로', dmail.ids.includes('mail-detail-follow') && dmail.ids.includes('mail-extract-task'), JSON.stringify(dmail.ids));
    await page.goto(`${BASE}/tasks?task=${task.id}`, { waitUntil: 'domcontentloaded' });
    await b.sleep(5000);
    const dtask = await page.evaluate(() => ({ toggle: !!document.querySelector('[data-testid="task-detail-meta-toggle"]'), drawer: !!document.querySelector('[data-testid="task-desc-focus-toggle"]') }));
    push('데스크탑 업무 — 속성 접기 없음', dtask.drawer && !dtask.toggle, JSON.stringify(dtask));
  } catch (e) {
    results.push({ name: 'canary-phone-bands', fail: 0, fatal: 1, details: ['FATAL ' + e.message] });
  } finally {
    if (browser) await browser.close().catch(() => null);
  }
  return results;
}

module.exports = { run, name: 'canary-phone-bands' };

if (require.main === module) {
  run().then((res) => {
    let bad = 0;
    console.log('\n=== 폰 상세 밴드 카나리 ===\n');
    for (const r of res) {
      const isBad = (r.fail || 0) + (r.fatal || 0) > 0;
      if (isBad) bad++;
      console.log(`${isBad ? '❌' : '✅'} ${r.name}`);
      (r.details || []).forEach((d) => console.log('     └ ' + d));
    }
    console.log(`\n총 문제: ${bad}`);
    sequelize.close().catch(() => null);
    process.exit(bad > 0 ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e.message); process.exit(2); });
}
