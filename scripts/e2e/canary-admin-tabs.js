// canary-admin-tabs — 플랫폼 관리자 **탭**이 제 이름을 갖고, 제 범위 안에만 머무는가 (2026-09-10)
//
//   Irene: "플랫폼관리자에서 탭이 제목이 제대로 안바뀌고 탭을 열면 다른 워크스페이스 탭이 열려.
//          워크스페이스별로, 플랫폼관리자도 마찬가지로 각각 따로 탭기능이 움직여야 하는 건데."
//
//   기존 scopetabs 카나리는 이 신고를 **구조적으로 못 잡는다** — snap() 이 탭의 `path` 만 담고
//   `title` 을 버리며, 탭을 여는 문(`+` → 통합검색)을 한 번도 누르지 않는다. 그래서 여기서 잰다:
//     ① 관리자 화면마다 탭 이름이 **그 화면 이름**이다 (전부 "설정" 이 아니다)
//     ② 화면을 옮기면 이름이 **따라 바뀐다**
//     ③ `+` 목록에 워크스페이스 메뉴가 **없다** (누르면 남의 워크스페이스 탭이 복원되는 문)
//     ④ ③ 의 양성 대조군 — 워크스페이스 범위에서는 `+` 에 워크스페이스 메뉴가 **있다**
//        (없으면 ③ 은 "목록이 통째로 비어서" 통과한 것이다)
//
//   ★ 기존 계정의 비밀번호는 바꾸지 않는다 — 임시 platform_admin 을 만들고 finally 에서 지운다.
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const bcrypt = require('/opt/planq/dev-backend/node_modules/bcryptjs');
const b = require('./lib/browser');

// [경로, 사이드바 라벨(ko)] — config/navMenus.ts ADMIN_MENUS 와 같은 표를 사람이 쓴 쪽.
// 여기 값이 어긋나면 그것도 신호다(탭 이름의 단일 원천이 깨진 것).
const SCREENS = [
  ['/admin/users', '사용자'],
  ['/admin/businesses', '워크스페이스'],
  ['/admin/payments', '결제 이력'],
];
const WS_MENU_WORDS = ['Q talk', 'Q Talk', '확인 필요', 'Q task', 'Q Task'];

const tabTitles = (page) => page.evaluate(() => {
  const strip = document.querySelector('[data-testid="tabstrip"]') || document.querySelector('nav[aria-label]');
  const btns = Array.from(document.querySelectorAll('[data-testid^="tab-"], [role="tab"]'));
  const fromDom = btns.map((e) => (e.innerText || '').trim().split('\n')[0]).filter(Boolean);
  if (fromDom.length) return fromDom;
  return strip ? [(strip.innerText || '').trim()] : [];
});

// 저장소가 들고 있는 탭 — 화면이 못 읽을 때의 보조 렌즈(경로+제목 둘 다).
const storedTabs = (page) => page.evaluate(() => {
  const out = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i);
    if (!k || !k.startsWith('planq_tabs_v1')) continue;
    try {
      const j = JSON.parse(sessionStorage.getItem(k));
      (j.tabs || []).forEach((t) => out.push({ key: k, path: t.path, kind: t.kind, title: t.title }));
    } catch { /* 무시 */ }
  }
  return out;
});

async function run() {
  const results = [];
  const push = (n, ok, m) => results.push({ name: n, fail: ok ? 0 : 1, details: [m] });
  let uid = null;
  let browser = null;
  const cred = { email: `admintabs-${Date.now()}@test.planq.kr`, password: 'AdminTabs2026!' };
  try {
    // ★ 약관 **버전**까지 채운다. 시각(`terms_accepted_at`)만 채우면 현재 버전과 달라
    //   로그인 직후 재동의 모달이 전면에 뜬다 — 그러면 `+` 를 눌러도 안 열리는데
    //   `aria-modal` 은 (동의 모달이) 하나 떠 있어서 **열린 것처럼 보인다.**
    //   이 카나리를 처음 돌렸을 때 실제로 그렇게 0건이 나왔다.
    const [ps] = await sequelize.query('SELECT terms_version, privacy_version FROM platform_settings LIMIT 1');
    const tv = ps[0]?.terms_version || '1.0';
    const pv = ps[0]?.privacy_version || '1.0';
    const [id] = await sequelize.query(
      `INSERT INTO users (email, password_hash, name, username, platform_role,
         terms_accepted_at, terms_version, privacy_accepted_at, privacy_version, created_at, updated_at)
       VALUES (?, ?, 'AdminTabs Canary', ?, 'platform_admin', NOW(), ?, NOW(), ?, NOW(), NOW())`,
      { replacements: [cred.email, await bcrypt.hash(cred.password, 12), `adtb${Date.now()}`, tv, pv] });
    uid = id;

    const launched = await b.launch();
    browser = launched.browser;
    const page = launched.page;
    await b.login(page, cred);
    await b.goto(page, '/admin/users');

    // ── ① · ② 탭 이름
    let prevTitle = null;
    for (const [path, label] of SCREENS) {
      await b.gotoSPA(page, path);
      await b.sleep(1200);
      const stored = (await storedTabs(page)).filter((t) => (t.path || '').startsWith('/admin'));
      const titles = await tabTitles(page);
      const shown = titles.join(' | ');
      const hasLabel = titles.some((x) => x.includes(label));
      push(`탭이름 ${path} = "${label}"`, hasLabel, `화면 탭: [${shown}] · 저장소 kind: ${stored.map((t) => t.kind).join(',') || '(없음)'}`);
      push(`탭이름 ${path} 이 "설정" 이 아니다`, !titles.every((x) => x === '설정'),
        `화면 탭: [${shown}]`);
      if (prevTitle !== null) {
        push(`탭이름이 화면 따라 바뀐다 (${prevTitle} → ${label})`, shown !== prevTitle, `전 [${prevTitle}] → 후 [${shown}]`);
      }
      prevTitle = shown;
      // kind 가 admin 으로 계산되는가 (identity 가 갈려야 탭이 안 합쳐진다)
      const kinds = [...new Set(stored.map((t) => t.kind))];
      push(`kind(${path}) = admin`, kinds.length > 0 && kinds.every((k) => k === 'admin'), `kind: ${kinds.join(',') || '(없음)'}`);
    }

    // ── ③ 관리자 범위의 `+` 목록에 워크스페이스 메뉴가 없다
    const openPlus = async () => {
      const btn = await page.$('[data-testid="tabstrip-new"]');
      if (!btn) return null;
      const box = await btn.boundingBox();
      if (!box) return null;
      // ★ 합성 click 은 mousedown 이 없어 툴바 계열이 안 열린다 — 실제 마우스로 누른다.
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await b.sleep(1200);
      // ★ **무슨** 모달이 열렸는지까지 돌려준다 — "aria-modal 이 하나 있다" 는 통합검색이
      //   열렸다는 뜻이 아니다(약관 재동의 모달도 aria-modal 이다).
      return page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('[data-testid^="gsearch-menu-"]'));
        const box = document.querySelector('[data-testid="gsearch-input"], [aria-modal="true"]');
        return {
          menus: items.map((e) => (e.innerText || '').trim()),
          isSearch: !!document.querySelector('[data-testid^="gsearch-menu-"], [data-testid="search-ask-cue"]'),
          modalText: (box && box.innerText || '').slice(0, 120),
        };
      });
    };
    const closePlus = async () => { await page.keyboard.press('Escape'); await b.sleep(500); };

    const A = await openPlus();
    if (A === null) {
      push('관리자 `+` 를 열 수 있다', false, 'tabstrip-new 버튼을 찾지 못했다');
    } else {
      push('관리자 `+` 가 통합검색을 연다', A.isSearch, `열린 모달: "${A.modalText.replace(/\n/g, ' ⏎ ')}"`);
      const leaked = A.menus.filter((m) => WS_MENU_WORDS.some((w) => m.includes(w)));
      push('관리자 `+` 목록에 워크스페이스 메뉴가 없다', A.isSearch && leaked.length === 0,
        `메뉴 ${A.menus.length}개 · 누출 ${leaked.length}개 ${leaked.slice(0, 4).join(' / ')}`);
      // ★ 위 판정이 "목록이 통째로 비어서" 통과한 것이 아님을 같은 화면에서 증명한다.
      push('관리자 `+` 목록에 관리자 메뉴는 있다', A.menus.length > 0,
        `메뉴 ${A.menus.length}개: ${A.menus.map((x) => x.split('\n').slice(1, 2).join('')).slice(0, 5).join(' / ')}`);
    }
    await closePlus();

    // ── ④ 양성 대조군 — 워크스페이스 범위에서는 워크스페이스 메뉴가 나온다
    await b.gotoSPA(page, '/dashboard');
    await b.sleep(1500);
    const W = await openPlus();
    if (W === null) {
      push('★ 양성 대조군 — 워크스페이스 `+` 를 열 수 있다', false, 'tabstrip-new 버튼을 찾지 못했다');
    } else {
      const found = W.menus.filter((m) => WS_MENU_WORDS.some((w) => m.includes(w)));
      push('★ 양성 대조군 — 워크스페이스 `+` 에는 워크스페이스 메뉴가 있다', W.isSearch && found.length > 0,
        `메뉴 ${W.menus.length}개 · 일치 ${found.length}개`);
      const adminLeak = W.menus.filter((m) => m.includes('/admin/'));
      push('워크스페이스 `+` 에 관리자 메뉴가 없다', adminLeak.length === 0,
        `누출 ${adminLeak.length}개 ${adminLeak.slice(0, 3).join(' / ')}`);
    }
    await closePlus();
  } catch (e) {
    push('카나리 실행', false, e.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (uid) {
      await sequelize.query('DELETE FROM refresh_tokens WHERE user_id = ?', { replacements: [uid] }).catch(() => {});
      await sequelize.query('DELETE FROM users WHERE id = ?', { replacements: [uid] });
    }
  }
  return results;
}

module.exports = { run };

if (require.main === module) {
  run().then((rs) => {
    let f = 0;
    rs.forEach((r) => { f += r.fail; console.log(`${r.fail ? '❌' : '✅'} ${r.name} — ${r.details.join(' ')}`); });
    console.log(`\n총 실패: ${f}`);
    process.exit(f ? 1 : 0);
  }).catch((e) => { console.error(e); process.exit(1); });
}
