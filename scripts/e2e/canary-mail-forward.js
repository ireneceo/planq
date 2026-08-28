// 메일 전달 컴포저 카나리 — 운영 신고(Irene 2026-08-28): "전달버튼 누르면 빈화면 돼. 그리고 다 그래."
//
//   크래시가 아니었다. 전달을 누르면 읽던 메일 자리를 **빈 작성칸**이 덮고, 무엇을 보내는지
//   화면에 아무것도 안 남았다. 원문을 에디터에 넣지 않는 건 의도(표·cid: 보존)지만
//   **보여주는 것을 빠뜨렸다.**
//
//   ★ 그리고 미리보기를 붙인 첫 판은 **높이 2px(테두리만)로 찌그러져** 있었다 —
//     DOM 에는 있고 화면에는 없는 상태. 컴포저가 flex 컬럼이라 자식이 눌린 것.
//     그래서 이 카나리는 "존재" 가 아니라 **실제 높이**를 잰다. 있음만 보면 또 속는다.
const b = require('./lib/browser');

async function run() {
  const results = [];
  const { browser, page } = await b.launch();
  try {
    await page.setViewport({ width: 1440, height: 900 });
    await b.login(page);
    await b.goto(page, '/mail?folder=all');
    await b.sleep(3000);

    // 스레드 하나 연다 — 목록 첫 행
    const threadId = await page.evaluate(async () => {
      const r = await fetch('/api/businesses/' + (window.__PLANQ_BIZ__ || 5) + '/email-threads', { credentials: 'include' });
      return null;   // 아래 URL 파라미터로 대신 연다
    }).catch(() => null);
    const opened = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('*')].filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 200 && r.width < 520 && r.height > 60 && r.height < 160 && r.x < 700
          && (e.textContent || '').length > 25 && e.children.length > 1 && e.children.length < 10;
      });
      if (!rows.length) return false;
      rows[0].click(); return true;
    });
    await b.sleep(2500);

    const fwd = await page.evaluate(() => [...document.querySelectorAll('button')]
      .filter((e) => (e.textContent || '').trim() === '전달' || (e.getAttribute('aria-label') || '') === '전달')
      .map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width }; })
      .filter((r) => r.w > 0));
    if (!opened || !fwd.length) {
      results.push({ name: 'open-forward', ok: false,
        msg: `🔴 전달 버튼에 도달 못 함 (스레드열기=${opened} 버튼=${fwd.length}) — 검사 0개. 판정 불가` });
      return results;
    }
    await page.mouse.click(fwd[0].x, fwd[0].y);
    await b.sleep(2500);

    const composer = await page.evaluate(() => ({
      editor: document.querySelectorAll('.ProseMirror').length,
      send: [...document.querySelectorAll('button')].some((e) => /보내기|Send/.test(e.textContent || '')),
      subject: [...document.querySelectorAll('input')].some((i) => /^Fwd:/i.test(i.value || '')),
    }));
    results.push({ name: 'composer-open', ok: composer.editor > 0 && composer.send && composer.subject,
      msg: composer.editor > 0 && composer.send && composer.subject
        ? '전달 컴포저가 열린다 (제목 Fwd: 자동)'
        : `🔴 컴포저가 제대로 안 열린다 ${JSON.stringify(composer)}` });

    // ★ 핵심 — 원문 미리보기가 **실제 높이를 갖고** 보이는가
    let prev = null;
    for (let i = 0; i < 16; i++) {
      await b.sleep(500);
      prev = await page.evaluate(() => {
        const head = [...document.querySelectorAll('button')].find((e) => /전달할 원문|Original being forwarded/.test(e.textContent || ''));
        if (!head) return { found: false };
        const box = head.parentElement;
        const r = box.getBoundingClientRect();
        const ifr = box.querySelector('iframe');
        const ir = ifr ? ifr.getBoundingClientRect() : null;
        return {
          found: true,
          boxH: Math.round(r.height), boxW: Math.round(r.width),
          iframeH: ir ? Math.round(ir.height) : 0,
          srcdocLen: ifr ? (ifr.getAttribute('srcdoc') || '').length : 0,
        };
      });
      if (prev.found && prev.boxH > 100) break;
    }
    if (!prev || !prev.found) {
      results.push({ name: 'original-preview', ok: false, msg: '🔴 "전달할 원문" 미리보기가 아예 없다 — 무엇을 보내는지 안 보인다' });
    } else {
      // 2px 로 찌그러진 상태를 잡는다 — 존재만 보면 속는다(실제 전례)
      const alive = prev.boxH > 100 && prev.iframeH > 40 && prev.srcdocLen > 200;
      results.push({ name: 'original-preview', ok: alive,
        msg: alive
          ? `원문 미리보기가 실제로 보인다 (상자 ${prev.boxH}px · 본문 ${prev.iframeH}px · 원문 ${prev.srcdocLen}자)`
          : `🔴 미리보기가 찌그러졌다 (상자 ${prev.boxH}px · 본문 ${prev.iframeH}px · 원문 ${prev.srcdocLen}자) — DOM 엔 있고 화면엔 없다` });
    }
  } finally { await browser.close(); }
  return results;
}

function toRunnerShape(rows) {
  return rows.map((r) => ({ name: r.name, fail: r.ok ? 0 : 1, details: [r.msg], hasCanary: true }));
}
module.exports = { run: async () => toRunnerShape(await run()), name: 'mail-forward' };

if (require.main === module) {
  run().then((res) => {
    let fail = 0;
    console.log('\n=== 메일 전달 컴포저 카나리 ===');
    for (const r of res) { console.log(`${r.ok ? '✅' : '❌'} ${r.name} — ${r.msg}`); if (!r.ok) fail++; }
    console.log(`\n검사 ${res.length}개 · 실패 ${fail}`);
    process.exit(fail > 0 ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e.message); process.exit(2); });
}
