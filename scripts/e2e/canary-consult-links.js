// canary-consult-links — 2026-09-18. «상담을 다른 화면에서 여는 문» 이 실제로 열리는가.
//
// 이 계열은 이미 두 번 났다 — 버튼은 있는데 메뉴 markup 이 다른 가지에 있어 **눌러도 항목이 0개**
// (aria-expanded 는 true). 그래서 «있는가» 가 아니라 **누른 뒤 항목이 보이는가**로 판정한다.
//   ① Q sale [상담 진행] → Q note 새 노트 메뉴 4항목이 화면에 실제로 그려지는가
//   ② 메일 상세 [상담으로 보내기] 가 툴바에 보이는가(여태 ⋯ 안에만 있었다)
//   ③ 음성 대조군 — 누르기 전에는 항목이 0개여야 한다(늘 떠 있는 것을 통과로 세지 않게)
const b = require('./lib/browser');

const VPS = [
  { name: '데스크탑', w: 1440, h: 900, mobile: false },
  { name: '폰', w: 390, h: 780, mobile: true },
];

function probeMenu() {
  const btn = document.querySelector('[data-testid="sale-proceed-consult"]');
  if (!btn) return { found: false };
  const menu = document.querySelector('[data-testid="qnote-new-menu"]');
  const items = menu ? Array.from(menu.querySelectorAll('button')) : [];
  const visible = items.filter((e) => {
    const r = e.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    // 조상 클리핑·겹침까지 본다 — rect 가 있어도 한 픽셀도 안 그려질 수 있다
    const el = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
    return !!el && (el === e || e.contains(el));
  });
  const br = btn.getBoundingClientRect();
  return {
    found: true,
    expanded: btn.getAttribute('aria-expanded'),
    btnH: Math.round(br.height),
    items: items.length,
    visible: visible.length,
    labels: visible.map((e) => (e.innerText || '').split('\n')[0].trim()).join(' | '),
  };
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });
  const { browser, page } = await b.launch({ mobile: true });
  try {
    await b.login(page);
    for (const vp of VPS) {
      await page.setViewport({ width: vp.w, height: vp.h, isMobile: vp.mobile, hasTouch: vp.mobile, deviceScaleFactor: vp.mobile ? 2 : 1 });
      await b.goto(page, '/sale');
      await b.sleep(2500);

      const before = await page.evaluate(probeMenu);
      if (!before.found) { push(`${vp.name}/[상담 진행] 존재`, false, '버튼이 없다 — 아래 판정 무의미'); continue; }
      push(`${vp.name}/누르기 전에는 메뉴가 없다 (음성 대조군)`, before.visible === 0,
        `보이는 항목 ${before.visible} · aria-expanded=${before.expanded}`);
      // 머리줄 컨트롤 높이 계약 — 32px (필터줄이 36)
      push(`${vp.name}/머리줄 높이 32`, before.btnH === 32, `${before.btnH}px`);

      await page.click('[data-testid="sale-proceed-consult"]');
      await b.sleep(400);
      const after = await page.evaluate(probeMenu);
      push(`${vp.name}/누르면 4항목이 실제로 보인다`, after.visible === 4,
        `보임 ${after.visible}/${after.items} · aria-expanded=${after.expanded} · [${after.labels}]`);
    }

    // ② 메일 상세 툴바의 [상담으로 보내기]
    await page.setViewport({ width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
    await b.goto(page, '/mail?folder=all');
    await b.sleep(3000);
    // ★ 행 표식은 `mail-thread-row` 다. 처음에 `[data-testid^="mail-row-"]` 로 집었더니
    //   **뱃지**(`mail-row-reply-needed`)가 잡혀 상세가 열리지 않았고, 그 결과를 "버튼이 없다" 로
    //   보고했다 — 검사기가 거짓말한 것이다(memory feedback_false_fail_suspect_the_judge).
    const opened = await page.evaluate(() => {
      const row = document.querySelector('[data-testid="mail-thread-row"]');
      if (row) { row.click(); return true; }
      return false;
    });
    await b.sleep(3000);
    // 상세가 정말 열렸는지부터 판정한다 — 안 열렸으면 아래 판정은 무의미하다
    const detailUp = await page.evaluate(() => !!document.querySelector('[data-testid="mail-extract-task"]'));
    const mail = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="mail-detail-promote-sale-inline"]');
      if (!el) return { found: false };
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
      return { found: true, w: Math.round(r.width), h: Math.round(r.height), reachable: !!hit && (hit === el || el.contains(hit)), label: (el.innerText || '').trim() };
    });
    if (!opened || !detailUp) {
      push('메일 상세/[상담으로 보내기] 가 툴바에 보인다', false,
        `상세를 열지 못했다(행클릭=${opened} · 상세표식=${detailUp}) — 판정 불가`);
    } else {
      push('메일 상세/[상담으로 보내기] 가 툴바에 보인다', mail.found === true && mail.reachable === true,
        JSON.stringify(mail));
    }

    // ③ [상담 저장] 모달의 고객 선택 — **라벨이 비어 있으면 고를 수 없다 = 기능이 죽는다.**
    //   2026-09-18 실측: 옵션 17개인데 라벨이 전부 공백이었다(`clients` 응답에 `name` 이 없다).
    //   "옵션이 몇 개인가" 만 세면 통과한다 — 글자가 실제로 있는지를 잰다.
    await b.goto(page, '/notes');
    await b.sleep(3000);
    // ★ 단계를 **나눠서** 기다린다. 한 evaluate 안에서 «행 클릭 → 상세 렌더 → 버튼 클릭» 을
    //   연달아 하면 상세가 아직 안 붙어 버튼을 못 찾고, 그것을 "버튼이 없다" 로 보고하게 된다.
    //   세션 행의 손잡이는 `data-qnote-session` 이다.
    await page.evaluate(() => { const r = document.querySelector('[data-qnote-session]'); if (r) r.click(); });
    await b.sleep(2500);
    const opener = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="qnote-save-sale"]');
      if (!el) return false;
      el.click(); return true;
    });
    await b.sleep(1500);
    const modalUp = await page.evaluate(() => !!document.querySelector('#pq-save-sale-client'));
    if (!opener || !modalUp) {
      push('상담 저장/고객 라벨이 비어 있지 않다', false,
        `모달을 열지 못했다(버튼=${opener} 모달=${modalUp}) — 판정 불가`);
    } else {
      // ★ react-select 의 메뉴는 click 으로 안 열린다 — **focus + ArrowDown** 이 규약이다.
      //   click 으로 재면 옵션 0건이 나오고, 그것을 "라벨이 비었다" 로 보고하게 된다.
      await page.focus('#pq-save-sale-client').catch(() => null);
      await page.keyboard.press('ArrowDown');
      await b.sleep(900);
      const labels = await page.evaluate(() => {
        const opts = Array.from(document.querySelectorAll('[role="option"]'));
        const named = opts.map((e) => (e.textContent || '').trim()).filter((x) => x.length > 0);
        return { count: opts.length, named: named.length, sample: named.slice(0, 3) };
      });
      // 옵션 **개수**만 세면 통과한다 — 라벨에 글자가 실제로 있는지까지 본다(2026-09-18 결함).
      push('상담 저장/고객 라벨이 비어 있지 않다', labels.count > 0 && labels.named === labels.count,
        `옵션 ${labels.count} · 글자 있는 것 ${labels.named} · ${JSON.stringify(labels.sample)}`);
    }
  } finally { await browser.close().catch(() => null); }
  return results;
}

module.exports = { name: 'consultlinks', run };

if (require.main === module) {
  run().then((rs) => {
    let bad = 0;
    rs.forEach((r) => { if (r.fail) bad++; console.log(`${r.fail ? '❌' : '✅'} ${r.name} — ${r.details[0]}`); });
    console.log(bad ? `\n실패 ${bad}/${rs.length}` : `\n통과 ${rs.length}/${rs.length}`);
    process.exit(bad ? 1 : 0);
  }).catch((e) => { console.error('🔴 하니스 오류:', e.message); process.exit(2); });
}
