// 앱 탭을 옮겨도 우측 패널·쓰던 입력이 남는가 (2026-11-23, Irene «탭을 이동한다고 해서 왜 우측 패널 열어둔게 닫혀?
//   내용 입력하던 거 임시저장도 안되고 패널도 닫혀버리고. 항상 다 날라가잖아. 둘 다 조치해.»)
//   ① 다른 탭 갔다 오기(그 탭에서 Esc 도 누름) → 폼·입력 그대로 ② 지금 탭 누르기 = 바깥 클릭(닫힘, 10-07 동작)
//   ③ 닫고 다시 열기·새로고침 → 임시저장 복원 + 안내 줄 ④ 지우기 ⑤ 일정 추가도 같게.
//   ★ ②·⑤의 Esc 닫힘이 음성 대조군 — 닫는 장치가 살아 있는데 탭 이동만 비켜 가는지를 가른다.
require('./lib/mem-slot');
const b = require('./lib/browser');
const R = [];
const ok = (name, cond, msg) => { R.push({ name: `${name} — ${msg}`, fail: cond ? 0 : 1, details: [] }); };
const titleVal = (page, sel) => page.evaluate((s) => {
  const el = [...document.querySelectorAll(s)].find((x) => x.offsetParent !== null);
  return el ? el.value : null;
}, sel);
const activeId = (page) => page.evaluate(() => (document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-testid') || '').replace('tabstrip-tab-', ''));
const openOtherTab = async (page) => {
  await page.evaluate(() => document.querySelector('[data-testid="tabstrip-new"]').click());
  await b.sleep(600);
  await page.evaluate(() => { const h = [...document.querySelectorAll('[data-testid^="gsearch-menu-"]')].find((x) => /dashboard|calendar|docs/.test(x.getAttribute('data-testid'))) || document.querySelector('[data-testid^="gsearch-menu-"]'); h && h.click(); });
  await b.sleep(1200);
};
const clickTab = async (page, id) => {
  const el = await page.$(`[data-testid="tabstrip-tab-${id}"]`);
  const box = await el.boundingBox();
  await page.mouse.click(box.x + 20, box.y + box.height / 2);
  await b.sleep(800);
};
async function run() {
  const { browser, page } = await b.launch();
  try {
    await page.setViewport({ width: 1440, height: 900 });
    await b.login(page);
    await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('planq:draft:task-create') || k.startsWith('planq:draft:event-create')) localStorage.removeItem(k); });
    await b.goto(page, '/tasks'); await b.sleep(2500);
    const tasksTab = await activeId(page);
    await page.click('[data-testid="task-add-btn"]'); await b.sleep(800);
    const T = '[확인용] 탭이동 시험 ' + Date.now();
    const sel = '[data-testid="task-create-title"]';
    await page.focus(sel); await page.keyboard.type(T); await b.sleep(700);
    ok('typed', (await titleVal(page, sel)) === T, 'Q task 업무 추가 폼에 제목 입력');
    // ① 다른 탭으로 갔다가 돌아오기
    await openOtherTab(page);
    const other = await activeId(page);
    ok('switched', other && other !== tasksTab, `다른 탭으로 이동 (${tasksTab} → ${other})`);
    // ② 다른 탭에서 Esc — 숨은 탭 패널이 닫히면 안 됨
    await page.keyboard.press('Escape'); await b.sleep(400);
    await clickTab(page, tasksTab);
    const back = await titleVal(page, sel);
    ok('kept-after-switch', back === T, `돌아왔을 때 폼·입력 그대로: ${JSON.stringify(back)}`);
    // ③ 지금 탭(활성) 누르면 바깥 클릭 = 닫힘(10-07 동작 유지)
    await clickTab(page, tasksTab);
    const afterActive = await titleVal(page, sel);
    ok('active-tab-closes', afterActive === null, `지금 탭 누르면 패널 닫힘: ${JSON.stringify(afterActive)}`);
    // ④ 닫은 뒤 다시 열면 임시저장 복원 + 안내 줄
    await page.click('[data-testid="task-add-btn"]'); await b.sleep(800);
    const re = await titleVal(page, sel);
    const note = await page.$('[data-testid="draft-note"]');
    ok('draft-restore', re === T && !!note, `다시 열기 → 제목 ${JSON.stringify(re)} · 안내 줄 ${!!note}`);
    // ⑤ 새로고침 뒤에도
    await page.reload({ waitUntil: 'networkidle2' }); await b.sleep(2500);
    await page.click('[data-testid="task-add-btn"]'); await b.sleep(800);
    ok('draft-after-reload', (await titleVal(page, sel)) === T, '새로고침 뒤 다시 열어도 남음');
    // ⑥ 지우기
    await page.click('[data-testid="draft-clear"]'); await b.sleep(500);
    ok('draft-clear', (await titleVal(page, sel)) === '', '«지우기» 누르면 비워짐');
    await page.keyboard.press('Escape'); await b.sleep(400);

    // 일정
    await b.goto(page, '/calendar'); await b.sleep(2500);
    const calTab = await activeId(page);
    await page.click('[data-testid="calendar-new-event"]'); await b.sleep(900);
    const es = '[data-testid="new-event-title"]';
    const E = '[확인용] 일정 탭이동 ' + Date.now();
    await page.focus(es); await page.keyboard.type(E); await b.sleep(700);
    await openOtherTab(page);
    await clickTab(page, calTab);
    ok('event-kept', (await titleVal(page, es)) === E, '일정 추가 — 탭 갔다 와도 그대로');
    await page.keyboard.press('Escape'); await b.sleep(500);
    ok('event-esc-closes', (await titleVal(page, es)) === null, '보이는 탭에서 Esc 는 여전히 닫힘');
    await page.click('[data-testid="calendar-new-event"]'); await b.sleep(900);
    ok('event-draft', (await titleVal(page, es)) === E, '일정 — 닫았다 다시 열면 복원');
    await page.click('[data-testid="draft-clear"]'); await b.sleep(300);
    await page.keyboard.press('Escape');
  } catch (e) { ok('crash', false, e.stack); }
  finally { await browser.close(); }
  return R;
}

module.exports = { run, name: 'canary-tab-panel-keep' };

if (require.main === module) {
  run().then((res) => {
    const bad = res.filter((r) => r.fail).length;
    res.forEach((r) => console.log(`${r.fail ? '❌' : '✅'} ${r.name}`));
    console.log(`\n총 문제: ${bad}`);
    process.exit(bad ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e.message); process.exit(2); });
}
