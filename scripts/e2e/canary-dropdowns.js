// 알림 · 새 소식 드롭다운 카나리 — 운영 신고(Irene 2026-08-28):
//   "전체알림이랑 스피커모양 공지랑 전체보기가 달라. 디자인 맞춰야지."
//   "열면 새탭으로 나와야 하는 거 아니야? 드롭다운에서 갑자기 탭 내용 바뀌면 하던 일 문제될 것 같아."
//
//   두 드롭다운은 서로를 베껴 만들어져 조용히 갈라진다. 스타일을 dropdownShell 로 모았지만,
//   **모았다는 사실만으로는 같아 보이는지 알 수 없다** — 실제로 열어서 치수를 비교한다.
//   ★ 항목이 0건이면 비교 대상이 없다 → 통과가 아니라 '판정 불가'로 실패시킨다.
const b = require('./lib/browser');

const boxOf = (sel) => sel;

async function openAndMeasure(page, testid) {
  await page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (el) el.click();
  }, testid);
  await b.sleep(1200);
  return page.evaluate(() => {
    const pop = [...document.querySelectorAll('[role="menu"]')]
      .find((e) => e.getBoundingClientRect().width > 0);
    if (!pop) return null;
    const r = pop.getBoundingClientRect();
    const items = [...pop.querySelectorAll('a,button')].filter((e) => {
      const b2 = e.getBoundingClientRect();
      return b2.width > 100 && b2.height > 24;   // 항목만 (헤더 액션·푸터 링크 제외 목적)
    });
    const first = items[0];
    return {
      popW: Math.round(r.width), popTop: Math.round(r.top), popLeft: Math.round(r.left),
      radius: getComputedStyle(pop).borderRadius,
      itemCount: items.length,
      itemH: first ? Math.round(first.getBoundingClientRect().height) : 0,
      itemPad: first ? getComputedStyle(first).padding : '',
      itemRadius: first ? getComputedStyle(first).borderRadius : '',
      // 항목 안에 아이콘 상자가 있는가 (한쪽만 있으면 다르게 보인다)
      hasIcon: !!(first && first.querySelector('span,svg')),
    };
  });
}

async function run() {
  const results = [];
  const { browser, page } = await b.launch();
  try {
    await page.setViewport({ width: 1440, height: 900 });
    await b.login(page);
    await b.goto(page, '/dashboard');
    await b.sleep(3500);

    const notif = await openAndMeasure(page, 'header-notifications');
    await page.keyboard.press('Escape'); await b.sleep(400);
    const news = await openAndMeasure(page, 'header-whatsnew');
    await page.keyboard.press('Escape'); await b.sleep(400);

    if (!notif || !news) {
      results.push({ name: 'open', ok: false, msg: `🔴 드롭다운을 못 열었다 (알림=${!!notif} 새소식=${!!news}). 판정 불가` });
      return results;
    }
    results.push({ name: 'popover-size', ok: notif.popW === news.popW && notif.radius === news.radius,
      msg: notif.popW === news.popW && notif.radius === news.radius
        ? `팝오버 규격 동일 (폭 ${notif.popW} · 라운드 ${notif.radius})`
        : `🔴 팝오버 규격이 다르다 (알림 ${notif.popW}/${notif.radius} · 새소식 ${news.popW}/${news.radius})` });
    results.push({ name: 'popover-anchor', ok: notif.popTop === news.popTop && notif.popLeft === news.popLeft,
      msg: notif.popTop === news.popTop && notif.popLeft === news.popLeft
        ? `여는 자리 동일 (${notif.popLeft},${notif.popTop})`
        : `🔴 여는 자리가 다르다 (알림 ${notif.popLeft},${notif.popTop} · 새소식 ${news.popLeft},${news.popTop})` });

    if (notif.itemCount === 0 || news.itemCount === 0) {
      results.push({ name: 'item-style', ok: false,
        msg: `🔴 비교할 항목이 없다 (알림 ${notif.itemCount}건 · 새소식 ${news.itemCount}건). 판정 불가` });
    } else {
      const same = notif.itemPad === news.itemPad && notif.itemRadius === news.itemRadius;
      results.push({ name: 'item-style', ok: same,
        msg: same ? `항목 규격 동일 (padding ${notif.itemPad} · 라운드 ${notif.itemRadius})`
                  : `🔴 항목 규격이 다르다 (알림 ${notif.itemPad}/${notif.itemRadius} · 새소식 ${news.itemPad}/${news.itemRadius})` });
      results.push({ name: 'item-icon', ok: notif.hasIcon === news.hasIcon,
        msg: notif.hasIcon === news.hasIcon ? '항목 아이콘 유무 동일'
          : `🔴 한쪽만 아이콘이 있다 (알림=${notif.hasIcon} 새소식=${news.hasIcon})` });
    }

    // ★ 새 탭으로 열리는가 — 보던 탭이 그대로 남아야 한다.
    const before = await page.evaluate(() => ({
      tabs: document.querySelectorAll('[data-testid="tabstrip"] [role="tab"]').length,
      path: location.pathname,
    }));
    await page.evaluate(() => document.querySelector('[data-testid="header-notifications"]').click());
    await b.sleep(1000);
    const clicked = await page.evaluate(() => {
      const pop = [...document.querySelectorAll('[role="menu"]')].find((e) => e.getBoundingClientRect().width > 0);
      if (!pop) return false;
      const it = [...pop.querySelectorAll('a,button')].find((e) => e.getBoundingClientRect().width > 100 && e.getBoundingClientRect().height > 24);
      if (!it) return false;
      it.click(); return true;
    });
    await b.sleep(1500);
    if (!clicked) {
      results.push({ name: 'open-in-new-tab', ok: false, msg: '🔴 누를 알림 항목이 없다. 판정 불가' });
    } else {
      const after = await page.evaluate(() => ({
        tabs: document.querySelectorAll('[data-testid="tabstrip"] [role="tab"]').length,
        path: location.pathname,
      }));
      const opened = after.tabs > before.tabs;
      results.push({ name: 'open-in-new-tab', ok: opened,
        msg: opened ? `새 탭에서 열린다 (탭 ${before.tabs} → ${after.tabs})`
                    : `🔴 보던 탭이 덮인다 (탭 ${before.tabs} → ${after.tabs} · 경로 ${before.path} → ${after.path})` });
    }
  } finally { await browser.close(); }
  return results;
}

function toRunnerShape(rows) {
  return rows.map((r) => ({ name: r.name, fail: r.ok ? 0 : 1, details: [r.msg], hasCanary: true }));
}
module.exports = { run: async () => toRunnerShape(await run()), name: 'dropdowns' };

if (require.main === module) {
  run().then((res) => {
    let fail = 0;
    console.log('\n=== 알림·새소식 드롭다운 카나리 ===');
    for (const r of res) { console.log(`${r.ok ? '✅' : '❌'} ${r.name} — ${r.msg}`); if (!r.ok) fail++; }
    console.log(`\n검사 ${res.length}개 · 실패 ${fail}`);
    process.exit(fail > 0 ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e.message); process.exit(2); });
}
