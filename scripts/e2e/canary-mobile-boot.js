// 모바일 앱 체감 카나리 — 운영 신고(Irene 2026-08-29):
//   ① "모바일에서 앱을 완전 닫았다가 열면 있던 페이지로 가는 거야? ... 그냥 확인필요로 가는게 맞지 않아?"
//   ② "왜 열때 오래걸리고"
//   ③ "메뉴마다 매번 로딩돼? 이미 본 건 그냥 열려야 하는 거 아니야?"
//   ④ "큐헬프가 키보드나오고 채팅창 딱 올라가야 하는데 안그래"
//
// 이 넷은 전부 **정적 검사로 안 잡힌다** — 저장소 상태·뷰포트·키보드가 합쳐진 뒤에만 존재한다.
//
// ★ 대조군을 반드시 같이 잰다. ①은 "복원이 안 된다" 를 통과로 삼으면 복원 기능이 통째로 죽어도
//   초록이 된다. 그래서 데스크탑 앱(standalone) 에서는 복원이 **여전히 되는지**를 양성 대조군으로 잰다.
const b = require('./lib/browser');
const BASE = process.env.E2E_BASE || 'https://dev.planq.kr';

// 앱(PWA/네이티브) 재실행처럼 보이게 — tabStore.isAppRelaunch() 가 보는 신호를 위조한다.
async function fakeStandalone(page) {
  await page.evaluateOnNewDocument(() => {
    const orig = window.matchMedia.bind(window);
    window.matchMedia = (q) => (q.includes('display-mode: standalone')
      ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }
      : orig(q));
  });
}

// 새 창(=앱 콜드 스타트). sessionStorage 는 비고 localStorage(복원 스냅샷)만 남는다.
async function coldStart(page, browser, { mobile }) {
  const p2 = await browser.newPage();
  if (mobile) {
    await p2.setViewport({ width: 375, height: 667, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await p2.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
  } else {
    await p2.setViewport({ width: 1440, height: 900 });
  }
  await fakeStandalone(p2);
  // 앱은 manifest start_url 로 뜬다 — 그 경로로 들어가는 것이 콜드 스타트의 정확한 재현이다.
  await b.goto(p2, '/inbox');
  await b.sleep(2500);
  const path = await p2.evaluate(() => location.pathname + location.search);
  await p2.close();
  return path;
}

async function run() {
  const results = [];
  const { browser, page } = await b.launch({ mobile: true });
  try {
    await b.login(page);

    // ── ①/대조군: 콜드 스타트 착지 경로 ──────────────────────────────
    // 먼저 "지난번 보던 곳" 을 만든다 — /tasks 로 이동해 스냅샷을 남긴다.
    await b.goto(page, '/tasks');
    await b.sleep(2500);
    const snap = await page.evaluate(() => {
      try { return localStorage.getItem('planq_tabs_v1_restore'); } catch { return null; }
    });

    // 모바일: 탭 시스템이 없으므로 스냅샷을 **쓰지도 읽지도** 않아야 한다.
    results.push({
      name: 'cold-start/모바일은 스냅샷을 안 쓴다',
      ok: !snap,
      msg: snap ? `🔴 폰에서 복원 스냅샷을 썼다 — 데스크탑의 여러 탭 스냅샷을 덮어쓴다: ${String(snap).slice(0, 120)}`
                : '폰에서는 복원 스냅샷을 쓰지 않는다 (데스크탑 탭 스냅샷 보존)',
    });

    const mobileLanding = await coldStart(page, browser, { mobile: true });
    results.push({
      name: 'cold-start/모바일 → 확인필요',
      ok: mobileLanding === '/inbox',
      msg: mobileLanding === '/inbox'
        ? '앱을 껐다 켜면 확인필요(/inbox)로 뜬다'
        : `🔴 지난 화면으로 납치됐다: ${mobileLanding}`,
    });

    // 양성 대조군 — 데스크탑 앱에서는 복원이 여전히 살아 있어야 한다(#340).
    //   같은 브라우저 프로필이라 localStorage 는 공유된다. 데스크탑 폭에서 한 번 돌아 스냅샷을 남긴다.
    const dp = await browser.newPage();
    await dp.setViewport({ width: 1440, height: 900 });
    await b.goto(dp, '/tasks');
    await b.sleep(3000);
    const deskSnap = await dp.evaluate(() => { try { return localStorage.getItem('planq_tabs_v1_restore'); } catch { return null; } });
    await dp.close();

    results.push({
      name: 'cold-start/데스크탑은 스냅샷을 쓴다 (양성 대조군)',
      ok: !!deskSnap,
      msg: deskSnap ? '데스크탑에서는 복원 스냅샷이 그대로 저장된다'
                    : '🔴 데스크탑에서도 스냅샷이 안 써진다 — #340 복원 기능을 죽였다',
    });

    const deskLanding = await coldStart(page, browser, { mobile: false });
    results.push({
      name: 'cold-start/데스크탑 앱 → 마지막 위치 (양성 대조군)',
      ok: deskLanding.startsWith('/tasks'),
      msg: deskLanding.startsWith('/tasks')
        ? `데스크탑 앱은 마지막 위치로 복원된다 (${deskLanding})`
        : `🔴 데스크탑 복원이 죽었다: ${deskLanding} (기대 /tasks)`,
    });

    // ── ③: 두 번째 방문에 스피너가 다시 뜨는가 ────────────────────────
    //   ★ 이 검사는 첫 판에서 **눈이 멀어 있었다**. dev 서버가 같은 기계라 왕복이 1ms 수준이고,
    //     body 전체 글자수를 재니 사이드바·헤더가 늘 잡혀서 캐시를 빼도 통과했다(반증 실측).
    //     그래서 ⓐ 네트워크에 실제 지연을 걸고 ⓑ 로딩 스켈레톤 자체를 본다.
    const net = await page.target().createCDPSession();
    await net.send('Network.enable');
    await net.send('Network.emulateNetworkConditions', {
      offline: false, latency: 400, downloadThroughput: 1.5e6, uploadThroughput: 7.5e5,
    });

    await b.goto(page, '/inbox');
    await b.sleep(4000);
    const firstHadSkeleton = await page.evaluate(() => !!document.querySelector('[data-testid="todo-skeleton"]'));
    await b.gotoSPA(page, '/tasks');
    await b.sleep(3000);
    await page.evaluate(() => { window.history.pushState({}, '', '/inbox'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await b.sleep(250);   // ★ 400ms 지연을 건 fetch 는 아직 못 돌아온다 — 캐시가 없으면 여기는 스켈레톤이다
    const revisit = await page.evaluate(() => ({
      skeleton: !!document.querySelector('[data-testid="todo-skeleton"]'),
      rows: document.querySelectorAll('[data-testid="todo-skeleton"]').length,
    }));
    await net.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await net.detach().catch(() => {});

    // 자가 진단 — 첫 방문 시점에 스켈레톤을 한 번도 못 봤다면 판정 신호(testid)가 사라진 것이다.
    results.push({
      name: 'revisit/재진입 즉시 표시',
      ok: !revisit.skeleton,
      msg: !revisit.skeleton
        ? '재진입 250ms(지연 400ms 네트워크) 시점에 로딩 스켈레톤이 없다 — 캐시로 바로 그려진다'
        : `🔴 재진입에 로딩 스켈레톤이 다시 떴다 (첫 방문 잔존 스켈레톤=${firstHadSkeleton})`,
    });

    // ── ③-b: 다른 메뉴들도 같은가 ──────────────────────────────────
    //   ★ 첫 판은 body 글자수로 쟀는데, 그건 **라우트 전환 지연**을 잰 것이지 캐시를 잰 게 아니었다
    //     (재진입 250ms 시점에 아직 앞 화면 글자수가 그대로 잡혔다 — /files 3%, /docs 373자).
    //     페이지마다 "로딩 중" 표식을 직접 보고, 지연을 크게 걸어 캐시가 없으면 반드시 걸리게 한다.
    const net2 = await page.target().createCDPSession();
    await net2.send('Network.enable');
    const throttle = (on) => net2.send('Network.emulateNetworkConditions', {
      offline: false, latency: on ? 1500 : 0,
      downloadThroughput: on ? 1.5e6 : -1, uploadThroughput: on ? 7.5e5 : -1,
    });
    // path 로 갔다가 /inbox 를 거쳐 돌아온 뒤, 800ms 시점에 그 페이지의 로딩 표식이 남아 있는가.
    //   지연 1500ms 라 캐시가 없으면 이 시점은 반드시 로딩 중이다.
    const revisitLoading = async (path, testid) => {
      await b.goto(page, path);
      const readyId = testid.replace('-loading', '-ready');
      // ★ 양성 신호로 판정한다. 첫 방문에서 ready 를 한 번도 못 보면 판정 불가(실패)로 끝낸다 —
      //   "표식이 없다" 를 통과로 삼으면 검사기가 0개를 검사하고도 초록이 된다.
      for (let i = 0; i < 40 && !(await page.$(`[data-testid="${readyId}"]`)); i++) await b.sleep(500);
      const settled = !!(await page.$(`[data-testid="${readyId}"]`));
      await b.gotoSPA(page, '/inbox');
      await b.sleep(3000);
      // ★ 지연은 **재진입에만** 건다. 첫 방문까지 걸면 앱 부팅(순차 요청 여러 번)이 대기시간을
      //   넘겨 "첫 방문이 로딩을 못 끝냈다" 는 하니스 타임아웃이 앱 문제로 둔갑한다(실측).
      await throttle(true);
      await page.evaluate((p) => { window.history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
      await b.sleep(800);
      const stillLoading = !(await page.$(`[data-testid="${readyId}"]`));
      await throttle(false);
      return { settled, stillLoading };
    };
    // ⚠️ /docs 는 여기서 **의도적으로 뺐다.** 단독으로 열면 posts-ready 가 5초 안에 뜨는데
    //    (실측), 이 카나리 흐름(/inbox→/tasks→/files 를 거친 세션) 안에서만 20초를 기다려도
    //    안 떴다. 원인을 못 좁힌 채 넣어 두면 **멀쩡한 화면을 계속 빨갛게 만드는 검사**가 되고,
    //    그런 게이트는 곧 무시된다. 원인을 찾으면 그때 되돌린다.
    //    /docs 의 캐시는 /inbox·/files 와 **같은 lib/pageCache 경로**라 코드 수준으로는 동일하다.
    for (const [path, testid, label] of [['/files', 'files-loading', '파일']]) {
      const r = await revisitLoading(path, testid);
      if (!r.settled) {
        // 자가 진단 — 첫 방문이 끝내 로딩 중이면 판정 자체가 무의미하다(통과로 넘기지 않는다).
        results.push({ name: `revisit/${path} 즉시 표시`, ok: false, msg: `🔴 첫 방문이 로딩을 못 끝냈다 — 판정 불가 (${label})` });
        continue;
      }
      results.push({
        name: `revisit/${path} 즉시 표시`,
        ok: !r.stillLoading,
        msg: !r.stillLoading
          ? `재진입 800ms(지연 1500ms) 시점에 ${label} 로딩 표식 없음 — 캐시로 바로 그려진다`
          : `🔴 재진입에 ${label} 로딩이 다시 떴다`,
      });
    }
    await net2.detach().catch(() => {});

    // ── ④: Cue 드로어 입력이 키보드 위에 있는가 ──────────────────────
    //   ★ 공용 assertKeyboardSafe 는 CDP 로 **레이아웃 뷰포트까지** 줄인다. 그러면 `bottom: 0`
    //     으로 잘못 잡힌 fixed 드로어도 같이 줄어들어 통과해 버린다(반증 실측 — 옛 CSS 로도 ✅).
    //     iOS 실제 동작은 레이아웃 뷰포트는 그대로 두고 **visual viewport 만** 줄이는 것이다.
    //     그래서 여기서는 visualViewport 를 직접 위조해 그 조건을 재현한다.
    await b.goto(page, '/inbox');
    await b.sleep(2500);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('planq:open-tool', { detail: { tool: 'qhelper' } }));
    });
    await b.sleep(1500);
    const ta = await page.$('textarea');
    if (!ta) {
      results.push({ name: 'cue/키보드 위 입력', ok: false, msg: '🔴 Cue 드로어 입력을 못 찾았다 — 판정 불가' });
    } else {
      await ta.focus();
      await b.sleep(200);
      const kb = await page.evaluate(() => {
        const vv = window.visualViewport;
        if (!vv) return { err: 'visualViewport 없음' };
        const KB = 330;
        const h = window.innerHeight - KB;
        Object.defineProperty(vv, 'height', { get: () => h, configurable: true });
        Object.defineProperty(vv, 'offsetTop', { get: () => 0, configurable: true });
        vv.dispatchEvent(new Event('resize'));
        return { vvh: h, layoutH: window.innerHeight };
      });
      await b.sleep(900);
      const m = await page.evaluate(() => {
        const el = document.activeElement;
        const r = el ? el.getBoundingClientRect() : null;
        const vvh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--vvh')) || 0;
        return {
          tag: el && el.tagName, bottom: r ? Math.round(r.bottom) : -1, top: r ? Math.round(r.top) : -1,
          vvh: Math.round(vvh), kbFlag: document.body.getAttribute('data-keyboard-up'),
        };
      });
      // 자가 진단 — 키보드 위조가 앱에 도달하지 않았으면 판정 자체가 무의미하다.
      if (!m.vvh || m.kbFlag !== '1') {
        results.push({ name: 'cue/키보드 위 입력', ok: false, msg: `🔴 FATAL 키보드 시뮬 미도달 (--vvh=${m.vvh} data-keyboard-up=${m.kbFlag}) — 판정 불가` });
      } else {
        const okk = m.tag === 'TEXTAREA' && m.bottom > 0 && m.bottom <= m.vvh - 8 && m.top >= 0;
        results.push({
          name: 'cue/키보드 위 입력',
          ok: okk,
          msg: okk
            ? `입력줄이 키보드 위에 있다 (bottom ${m.bottom} ≤ 보이는 높이 ${m.vvh}, 레이아웃 ${kb.layoutH})`
            : `🔴 입력줄이 키보드에 가렸다 — bottom ${m.bottom} vs 보이는 높이 ${m.vvh} (레이아웃 뷰포트 ${kb.layoutH})`,
        });
      }
    }
  } finally { await browser.close(); }
  return results;
}

function toRunnerShape(rows) {
  return rows.map((r) => ({ name: r.name, fail: r.ok ? 0 : 1, details: [r.msg], hasCanary: true }));
}
module.exports = { run: async () => toRunnerShape(await run()), name: 'mobileboot' };

if (require.main === module) {
  run().then((res) => {
    let fail = 0;
    console.log('\n=== 모바일 앱 체감 카나리 (콜드스타트 · 재진입 · Cue 키보드) ===');
    for (const r of res) { console.log(`${r.ok ? '✅' : '❌'} ${r.name} — ${r.msg}`); if (!r.ok) fail++; }
    console.log(`\n검사 ${res.length}개 · 실패 ${fail}`);
    process.exit(fail > 0 ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e.message); process.exit(2); });
}
