// canary-tab-foreign — **남의 워크스페이스 탭이 떠오르지 않는가** (운영 신고 2026-09-09)
//
// Irene: *"운영서버에서 테스트 워크스페이스 가면 워프로랩 문서인 'DB 서버 신규 / 솔루션용'
//   이게 열려있어. 이게 내가 닫지 않아도 안나와야 하는 거잖아"*
//
// 왜 앞선 두 수정으로 안 잡혔나:
//   · #405 — 저장 키를 워크스페이스별로 갈랐다. 그런데 **범위를 모르는 창(부팅 직후)** 에서는
//     `scoped()` 가 무범위 키로 떨어져, 그 통이 워크스페이스 공용 쓰레기통이 됐다.
//   · v1.48.14 — 기록 순서를 고치고 청소(scrub)를 넣었다. 그런데 청소가 **경로만** 봤다.
//     `/docs?post=12` 는 어느 워크스페이스에서든 "이 범위 것" 으로 판정된다(관리자만 갈랐다).
//     → **한 번 섞여 들어온 탭은 걸러낼 방법이 아예 없었다.**
//
// 그래서 이 카나리는 그 두 통로를 **직접 심어서** 본다:
//   ① 무범위 키(공용 쓰레기통)에 남의 탭 → 부팅 후 화면에 없어야 한다
//   ② 이 워크스페이스 키 안에 **남의 도장이 찍힌** 탭 → 읽는 순간 버려져야 한다
//   ③ 음성 대조군 — 내 도장이 찍힌 탭은 살아 있어야 한다 (전부 지워버리는 것은 고친 게 아니다)
const b = require('./lib/browser');

const FOREIGN_PATH = '/docs?post=999777';
const FOREIGN_TITLE = 'DB 서버 신규 / 솔루션용';

async function run() {
  const results = [];
  const push = (name, ok, details) => results.push({ name, fail: ok ? 0 : 1, details: [details] });
  const { browser, page } = await b.launch();
  try {
    await page.setViewport({ width: 1440, height: 900 });
    await b.login(page);
    await b.goto(page, '/tasks');
    await b.sleep(2500);

    // 지금 이 창의 범위를 알아낸다 (도장 비교의 기준)
    const scope = await page.evaluate(() => {
      try {
        for (let i = 0; i < sessionStorage.length; i += 1) {
          const k = sessionStorage.key(i);
          if (k && k.startsWith('planq_tabs_v1::')) return k.split('::')[1];
        }
      } catch { /* */ }
      return null;
    });
    push('전제 — 이 창의 워크스페이스 범위를 알아냈다', !!scope, `scope=${scope}`);
    if (!scope) return results;

    const tabsOf = () => page.evaluate(() => {
      const bar = document.querySelector('[data-testid="tabstrip"]') || document.body;
      return Array.from(bar.querySelectorAll('[data-testid^="tabstrip-tab-"]')).map((n) => (n.textContent || '').trim());
    });

    // ── ① 무범위 키(공용 통)에 남의 탭을 심는다 ────────────────────────────
    await page.evaluate((p, t) => {
      const payload = JSON.stringify({
        tabs: [{ id: 'foreign_0', kind: 'docs', title: t, path: p, alive: true, lastActiveAt: Date.now(), scope: 'b999' }],
        activeId: 'foreign_0',
      });
      try { sessionStorage.setItem('planq_tabs_v1', payload); } catch { /* */ }
      try { localStorage.setItem('planq_tabs_v1_restore', payload); } catch { /* */ }
    }, FOREIGN_PATH, FOREIGN_TITLE);

    await b.goto(page, '/tasks');          // 부팅 재현 (새로 뜬 창처럼 읽는다)
    await b.sleep(2500);
    const after1 = await tabsOf();
    const body1 = await page.evaluate(() => document.body.innerText.slice(0, 2000));
    push('① 무범위 통에 있던 남의 탭이 화면에 안 뜬다',
      !after1.some((x) => x.includes(FOREIGN_TITLE)) && !body1.includes(FOREIGN_TITLE),
      `탭 ${JSON.stringify(after1)}`);

    // ── ② 이 워크스페이스 키 안에 남의 도장 탭을 심는다 ────────────────────
    await page.evaluate((sc, p, t) => {
      const payload = JSON.stringify({
        tabs: [
          { id: 'mine_0', kind: 'task', title: '', path: '/tasks', alive: true, lastActiveAt: Date.now(), scope: sc },
          { id: 'foreign_1', kind: 'docs', title: t, path: p, alive: false, lastActiveAt: Date.now(), scope: 'b999' },
        ],
        activeId: 'mine_0',
      });
      try { sessionStorage.setItem(`planq_tabs_v1::${sc}`, payload); } catch { /* */ }
      try { localStorage.setItem(`planq_tabs_v1_restore::${sc}`, payload); } catch { /* */ }
    }, scope, FOREIGN_PATH, FOREIGN_TITLE);

    await b.goto(page, '/tasks');
    await b.sleep(2500);
    const after2 = await tabsOf();
    const body2 = await page.evaluate(() => document.body.innerText.slice(0, 2000));
    push('② 내 워크스페이스 키 안의 **남의 도장 탭**이 읽는 순간 버려진다',
      !after2.some((x) => x.includes(FOREIGN_TITLE)) && !body2.includes(FOREIGN_TITLE),
      `탭 ${JSON.stringify(after2)}`);

    // ── ③ 음성 대조군 — 내 탭까지 지워버리면 고친 게 아니다 ─────────────────
    push('③ 음성 대조군 — 내 워크스페이스 탭은 남아 있다', after2.length > 0, `탭 ${JSON.stringify(after2)}`);

    const stored = await page.evaluate((sc) => {
      try { return sessionStorage.getItem(`planq_tabs_v1::${sc}`) || ''; } catch { return ''; }
    }, scope);
    push('④ 저장소에도 남의 탭이 안 남는다', !stored.includes('b999'), stored.slice(0, 120));
  } catch (e) {
    results.push({ name: 'tab-foreign:하니스', error: true, fatal: 1, details: [e.message] });
  } finally {
    await page.evaluate(() => {
      try { Object.keys(localStorage).filter((k) => k.startsWith('planq_tabs')).forEach((k) => localStorage.removeItem(k)); } catch { /* */ }
      try { Object.keys(sessionStorage).filter((k) => k.startsWith('planq_tabs')).forEach((k) => sessionStorage.removeItem(k)); } catch { /* */ }
    }).catch(() => null);
    await browser.close().catch(() => null);
  }
  return results;
}

module.exports = { name: 'tab-foreign — 남의 워크스페이스 탭이 떠오르지 않는가', run };
if (require.main === module) {
  run().then((rs) => {
    rs.forEach((x) => console.log((x.fail || x.fatal ? '❌' : '✅'), x.name, '—', (x.details || []).join(' ')));
    process.exit(rs.some((x) => x.fail || x.fatal) ? 1 : 0);
  });
}
