// 탭 이름 카나리 — 운영 신고(Irene 2026-08-28): "다른 탭 클릭하면 이름이 다시 메뉴이름으로 바뀌어"
//
//   재현 조건: 탭이 MAX_ALIVE(4)를 넘으면 가장 오래 안 본 탭이 alive:false → **언마운트**된다
//   (TabAppShell 이 alive 탭만 렌더). 옛 구현은 useTabTitle 의 언마운트 cleanup 이 제목을 지워
//   멀쩡히 열려 있는 탭의 이름이 메뉴명으로 되돌아갔다. **정지는 이탈이 아니다.**
//
//   ★ 메뉴명 목록을 하드코딩하지 않는다. 그 목록이 틀리면(예: '확인 필요' 누락) 메뉴명을 내용으로
//     오분류해 **거짓 통과**한다 — 실제로 한 번 그렇게 통과했다. 대신 **같은 탭의 라벨을
//     문서 열기 전/후로 비교**한다: 바뀌었으면 그게 내용 이름이고, 그 값이 유지되는지만 본다.
//   ★ 문서를 못 열면 검사 대상이 0개다 → **통과가 아니라 '판정 불가' 로 실패** 처리한다.
const b = require('./lib/browser');

const chipLabel = (id) => {
  const el = document.querySelector(`[data-testid="tabstrip-tab-${id}"]`);
  if (!el) return null;
  const lab = el.querySelector('span,div');
  return ((lab ? lab.textContent : el.textContent) || '').trim();
};
const readChips = () => {
  const strip = document.querySelector('[data-testid="tabstrip"]');
  if (!strip) return null;
  return [...strip.querySelectorAll('[role="tab"]')].map((el) => ({
    id: (el.getAttribute('data-testid') || '').replace('tabstrip-tab-', ''),
    label: ((el.querySelector('span,div') || el).textContent || '').trim(),
  }));
};

async function run() {
  const results = [];
  const { browser, page } = await b.launch();
  try {
    await page.setViewport({ width: 1440, height: 900 });   // >=1025 → 탭 모드 ON
    await b.login(page);
    await b.goto(page, '/docs');
    await b.sleep(3000);

    let chips = await page.evaluate(readChips);
    if (!chips || chips.length === 0) {
      results.push({ name: 'tabstrip', ok: false, msg: '🔴 탭 스트립 없음 — 탭 모드가 아니다. 판정 불가' });
      return results;
    }
    const docsTabId = chips[chips.length - 1].id;
    const before = await page.evaluate(chipLabel, docsTabId);

    // 문서 하나를 연다 → 그 탭 이름이 문서명으로 바뀌어야 한다
    const rowInfo = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-testid="docs-row"]')];
      if (rows.length === 0) return { n: 0 };
      const label = (rows[0].textContent || '').trim().slice(0, 30);
      rows[0].click();
      return { n: rows.length, label };
    });
    if (rowInfo.n === 0) {
      results.push({ name: 'title-applied', ok: false,
        msg: '🔴 문서 행을 못 찾음(0개) — 이 워크스페이스에 문서가 없거나 selector 가 틀렸다. **판정 불가**' });
      return results;
    }
    await b.sleep(2500);
    const named = await page.evaluate(chipLabel, docsTabId);
    if (!named || named === before) {
      results.push({ name: 'title-applied', ok: false,
        msg: `🔴 문서 ${rowInfo.n}개 중 "${rowInfo.label}" 를 열었는데 탭 이름이 그대로 ("${before}") — 제목 배선이 안 먹는다` });
      return results;
    }
    results.push({ name: 'title-applied', ok: true, msg: `문서 열기 → 탭 이름 "${before}" → "${named}"` });

    // MAX_ALIVE(4) 를 넘기도록 탭을 더 연다 — 이걸 안 넘기면 언마운트가 안 일어나 재현되지 않는다
    const openMenuTab = async (i) => {
      await page.evaluate(() => { const x = document.querySelector('[data-testid="tabstrip-new"]'); if (x) x.click(); });
      await b.sleep(450);
      const got = await page.evaluate((idx) => {
        const hits = [...document.querySelectorAll('[data-testid^="gsearch-menu-"]')];
        if (!hits.length) return null;
        const el = hits[idx % hits.length]; const id = el.getAttribute('data-testid'); el.click(); return id;
      }, i);
      await b.sleep(800);
      return got;
    };
    const opens = [];
    for (let i = 0; i < 5; i++) { const g = await openMenuTab(i); if (g) opens.push(g); }
    chips = await page.evaluate(readChips);
    const aliveExceeded = chips.length > 4;
    results.push({ name: 'exceed-max-alive', ok: aliveExceeded,
      msg: aliveExceeded ? `탭 ${chips.length}개 — MAX_ALIVE(4) 초과, 언마운트 조건 성립` : `🔴 탭 ${chips.length}개 — 4 이하라 재현 조건 미성립. 판정 불가` });
    if (!aliveExceeded) return results;

    // 모든 탭을 한 번씩 눌러본 뒤, 문서 탭 이름이 살아있는지
    let switches = 0;
    for (const c of chips) {
      await page.evaluate((id) => { const el = document.querySelector(`[data-testid="tabstrip-tab-${id}"]`); if (el) el.click(); }, c.id);
      await b.sleep(700); switches++;
    }
    const after = await page.evaluate(chipLabel, docsTabId);
    results.push({
      name: 'survives-tab-switch',
      ok: after === named,
      msg: after === named
        ? `탭 ${switches}회 전환 후에도 "${after}" 유지 (검사 대상 1개 · 탭 ${chips.length}개)`
        : `🔴 탭 전환 후 이름이 바뀜: "${named}" → "${after}" (탭 ${chips.length}개, ${switches}회 전환)`,
    });
  } catch (e) {
    results.push({ name: 'error', ok: false, msg: 'ERROR: ' + e.message.slice(0, 170) });
  } finally { await browser.close(); }
  return results;
}


// ★ 하니스 러너(run.js printSuite)는 **r.fail(숫자)** 을 센다. {ok, msg} 만 돌려주면 bad=0 이 되어
//   **게이트에서 영원히 통과**한다 — 단독 실행은 실패하는데 러너는 ✅ 를 찍는다(2026-08-28 실측).
//   결과를 러너 계약으로 변환한다: { name, fail: 0|1, details: [메시지] }.
function toRunnerShape(rows) {
  return rows.map((r) => ({ name: r.name, fail: r.ok ? 0 : 1, details: [r.msg], hasCanary: true }));
}

module.exports = { run: async () => toRunnerShape(await run()), name: 'tab-title' };

if (require.main === module) {
  run().then((res) => {
    let fail = 0;
    console.log('\n=== 탭 이름 카나리 ===');
    for (const r of res) { console.log(`${r.ok ? '✅' : '❌'} ${r.name} — ${r.msg}`); if (!r.ok) fail++; }
    console.log(`\n총 실패: ${fail}`);
    process.exit(fail > 0 ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e.message); process.exit(2); });
}
