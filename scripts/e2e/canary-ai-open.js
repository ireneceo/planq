// 카나리 — Q Task "AI" 버튼을 실제로 눌러 모달이 뜨는지 본다.
//
// 왜 필요한가: 훅을 early return 아래에 두면 닫힘/열림 사이 훅 개수가 달라져 React 가
//   "Rendered more hooks than during the previous render"(프로덕션 React #310) 로 크래시한다.
//   **런타임에만** 드러나므로 tsc·가드·빌드는 전부 통과한다(운영 신고 2026-08-24 의 정체).
//   그래서 판정은 "버튼 클릭 → aria-modal 이 뜬다 + React 에러 콘솔 0" 로만 한다.
const { launch, login, goto, sleep, BASE } = require('./lib/browser');

// 결과 shape 은 run.js printSuite 규약에 맞춘다: { name, fail, details }
function r(name, ok, detail) {
  // 실패 사유는 **실패했을 때만** 싣는다 — 통과 줄에 사유가 찍히면 읽는 사람이 통과를 실패로 읽는다.
  return { name, fail: ok ? 0 : 1, details: (!ok && detail) ? [detail] : [] };
}

async function run() {
  const results = [];
  const { browser, page } = await launch();
  const reactErrors = [];
  page.on('console', (m) => {
    const t = m.text();
    if (/Rendered more hooks|Minified React error #310|Rendered fewer hooks|Invalid hook call/i.test(t)) reactErrors.push(t);
  });
  page.on('pageerror', (e) => {
    if (/hooks|#310/i.test(String(e.message))) reactErrors.push(String(e.message));
  });
  try {
    await login(page);
    await goto(page, '/tasks');
    const opener = await page.$('[data-testid="qtask-ai-open"]');
    results.push(r('ai:AI 버튼 존재', !!opener, 'data-testid=qtask-ai-open 없음'));
    if (opener) {
      await opener.click();
      await sleep(1200);
      const modal = await page.$('[aria-modal="true"]');
      results.push(r('ai:모달 열림 (React #310 크래시 없음)', !!modal, '모달이 뜨지 않음 — early return 아래 훅 의심'));
      // 모달 안에 입력창이 실제로 렌더됐는지 (빈 껍데기 판정 차단)
      const ta = modal ? await modal.$('textarea, input') : null;
      results.push(r('ai:모달 내용 렌더', !!ta, '모달은 있는데 입력창 0 — 부분 크래시'));
    }
    results.push(r('ai:React 훅 에러 콘솔 0건', reactErrors.length === 0, reactErrors.slice(0, 2).join(' | ')));
  } catch (e) {
    results.push({ name: 'ai:canary 실행', fail: 1, fatal: 1, details: [e.message] });
  } finally {
    await browser.close();
  }
  return results;
}
module.exports = { name: 'ai-open', run };
