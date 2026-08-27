// #380 입력창 이모지 — **팝업이 실제로 보이는가**를 실브라우저로 판정한다.
//
// 왜 필요한가: 팝업이 InputBar 안에서 **위로** 열린다. 같은 파일의 '더보기' 메뉴는 overflow 클립
//   때문에 portal 로 뺐던 전례가 있어(사이클 N+16-F), CSS 만 읽고 "안 잘린다"고 단정할 수 없다.
//   그래서 렌더 후 ① 뷰포트 안에 있는지 ② 그 지점의 최상단 엘리먼트가 팝업 자신인지
//   (= 무엇에도 덮이거나 잘리지 않았는지) 를 elementFromPoint 로 반증한다.
//
// ★ 검사한 개수를 같이 출력한다 — "0개 검사한 통과" 와 진짜 통과를 구분하기 위해서다
//   (memory feedback_detector_must_report_coverage).
const { launch, login, goto, sleep } = require('./lib/browser');

const EMAIL = process.env.E2E_EMAIL || 'appreview@planq.kr';
const PASSWORD = process.env.E2E_PASSWORD || 'PlanQ-Review-2026!';

(async () => {
  const fails = [];
  let checked = 0;
  const { browser, page } = await launch();
  try {
    await login(page, { email: EMAIL, password: PASSWORD });
    await goto(page, '/talk');
    await sleep(1500);

    // 대화방 하나 진입 — 없으면 검사 불가로 **실패** 처리한다(빈 화면 거짓 통과 차단).
    // 실측 셀렉터: LeftPanel 의 ChatRow 가 data-qtalk-chat={conversation.id} 를 단다.
    const convs = await page.$$('[data-qtalk-chat]');
    if (!convs.length) throw new Error('대화방 행 0개 ([data-qtalk-chat]) — 검사 불가');
    console.log(`  대화방 ${convs.length}개 발견`);
    await convs[0].click();
    await sleep(1500);

    // 이모지 버튼 — aria-label 로 찾는다 (텍스트/위치 휴리스틱 금지, CLAUDE.md 17)
    const btn = await page.$('button[aria-label="이모지"], button[aria-label="Emoji"]');
    if (!btn) throw new Error('이모지 버튼을 찾지 못했다 (aria-label 이모지/Emoji)');
    await btn.click();
    await sleep(400);

    const verdict = await page.evaluate(() => {
      const pop = document.querySelector('[role="menu"][aria-label="이모지"], [role="menu"][aria-label="Emoji"]');
      if (!pop) return { ok: false, why: '팝업이 렌더되지 않음' };
      const r = pop.getBoundingClientRect();
      const cells = pop.querySelectorAll('[role="menuitem"]').length;
      if (r.width < 40 || r.height < 40) return { ok: false, why: `팝업 크기가 0에 가깝다 ${Math.round(r.width)}x${Math.round(r.height)}` };
      const inView = r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
      // 팝업 중앙 지점의 최상단 엘리먼트가 팝업 안이어야 한다 (덮임·클립 반증)
      const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
      const top = document.elementFromPoint(cx, cy);
      const covered = !(top && pop.contains(top));
      return {
        ok: inView && !covered && cells > 0,
        why: !inView ? `뷰포트 밖 (top ${Math.round(r.top)} bottom ${Math.round(r.bottom)} / vh ${innerHeight})`
          : covered ? `다른 요소가 덮음 (${top ? top.tagName + '.' + (top.className || '').toString().slice(0, 30) : 'null'})`
            : cells === 0 ? '이모지 셀 0개' : '',
        cells, rect: { t: Math.round(r.top), l: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) },
      };
    });
    checked++;
    console.log(`  팝업 rect ${JSON.stringify(verdict.rect)} · 이모지 셀 ${verdict.cells}개`);
    if (!verdict.ok) fails.push(`팝업 가시성: ${verdict.why}`);

    // 클릭 시 입력창에 실제로 들어가는가
    const before = await page.$eval('textarea[aria-label="메시지 입력"], textarea[aria-label="Message input"]', el => el.value);
    await page.click('[role="menuitem"]');
    await sleep(300);
    const after = await page.$eval('textarea[aria-label="메시지 입력"], textarea[aria-label="Message input"]', el => el.value);
    checked++;
    if (after.length <= before.length) fails.push(`이모지 클릭이 입력창에 반영되지 않음 ("${before}" → "${after}")`);
    else console.log(`  삽입 확인: "${before}" → "${after}"`);
  } catch (e) {
    fails.push(e.message);
  } finally {
    await browser.close();
  }

  console.log(`\n[canary-chat-emoji] 검사 ${checked}개 · 실패 ${fails.length}건`);
  fails.forEach(f => console.log('  ✗ ' + f));
  if (checked === 0) { console.log('  ✗ 검사 0개 — 통과로 보지 않는다'); process.exit(1); }
  process.exit(fails.length ? 1 : 0);
})();
