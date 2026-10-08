// scripts/e2e/canary-doc-find.js — 문서 편집기 찾기·바꾸기 + 기본 서식 버튼 (2026-10-08)
//
// Irene: *"문서 수정이 찾기, 문구 교체 등 문서들 기본 기능도 추가해줘."*
//
//   재는 것 (폰 390 · 태블릿 820 · 데스크탑 1440):
//     ⓪ 음성 대조군 — 막대를 열기 전엔 칠한 자리 0
//     ① Ctrl+F 로 막대가 열리고 검색칸에 포커스 · 결과 수 «1/3» · 칠한 자리 3 · 지금 결과가 화면 안
//     ② Enter → 2/3 · 대소문자 구분 켜면 결과가 준다
//     ③ 바꾸기 1건 → 남은 2 · 굵게였던 글은 바꾼 뒤에도 굵게(서식 보존)
//     ④ 모두 바꾸기 → 0 · 본문에 옛 글 0 · Ctrl+Z 한 번에 «모두 바꾸기» 분이 통째로 돌아온다
//     ⑤ Esc 로 닫히면 칠한 자리 0 · 막대·툴바가 화면 가로를 넘지 않는다
//     ⑥ 밑줄·구분선 버튼이 실제로 <u>·<hr> 를 만든다
//   새 문서는 자동 임시저장되므로 끝나면 표식 글(zqfind)로 찾아 지운다.
const { launch, login, goto, sleep, dismissBlockers } = require('./lib/browser');
const { sequelize } = require('/opt/planq/dev-backend/config/database');

const MARK = 'zqfind';
const results = [];
const push = (name, pass, detail) => results.push({ name, fail: !pass, details: detail ? [detail] : [] });

const snap = (page) => page.evaluate(() => {
  const pm = document.querySelector('.ProseMirror');
  const bar = document.querySelector('[data-testid="editor-find-bar"]');
  const cur = document.querySelector('.pq-find-current');
  const r = cur ? cur.getBoundingClientRect() : null;
  return {
    matches: document.querySelectorAll('.pq-find-match').length,
    count: (document.querySelector('[data-testid="editor-find-count"]') || {}).textContent || '',
    barOpen: !!bar,
    focusInFind: document.activeElement && document.activeElement.getAttribute('data-testid') === 'editor-find-input',
    curVisible: !!r && r.top >= 0 && r.bottom <= window.innerHeight && r.width > 0,
    text: pm ? pm.textContent : '',
    html: pm ? pm.innerHTML : '',
    docW: document.documentElement.scrollWidth, winW: window.innerWidth,
    barRight: bar ? Math.round(bar.getBoundingClientRect().right) : 0,
  };
});

async function oneWidth(width) {
  const tag = `${width}`;
  const { browser, page } = await launch();
  try {
    await page.setViewport({ width, height: width < 700 ? 844 : 900 });
    await login(page);
    await goto(page, '/docs');
    await sleep(2500);
    await dismissBlockers(page).catch(() => {});
    await page.evaluate(() => { const b = document.querySelector('[data-testid="docs-new"]'); if (b) b.click(); });
    await sleep(700);
    await page.evaluate(() => { const b = document.querySelector('[data-testid="docs-new-blank"]'); if (b) b.click(); });
    await sleep(2200);
    if (!(await page.$('.ProseMirror'))) { push(`[${tag}] 새 문서 편집기 열기`, false, '편집기를 못 열었다 — 판정 불가(실패)'); return; }

    await page.click('.ProseMirror');
    // 굵은 «사과» 하나 + 보통 «사과» 둘 + 대소문자 대조용
    await page.keyboard.type(`${MARK} `);
    await page.keyboard.down('Control'); await page.keyboard.press('b'); await page.keyboard.up('Control');
    await page.keyboard.type('사과');
    await page.keyboard.down('Control'); await page.keyboard.press('b'); await page.keyboard.up('Control');
    await page.keyboard.type(' 바나나 사과 Apple apple');
    await page.keyboard.press('Enter');
    await page.keyboard.type('두 번째 줄 사과');
    await sleep(400);

    const s0 = await snap(page);
    push(`[${tag}] ⓪ 열기 전엔 칠한 자리 0 (음성 대조군)`, s0.matches === 0 && !s0.barOpen, `칠함 ${s0.matches} · 막대 ${s0.barOpen}`);

    await page.keyboard.down('Control'); await page.keyboard.press('f'); await page.keyboard.up('Control');
    await sleep(400);
    const sOpen = await snap(page);
    push(`[${tag}] ① Ctrl+F 로 막대가 열리고 검색칸에 포커스`, sOpen.barOpen && sOpen.focusInFind, `막대 ${sOpen.barOpen} · 포커스 ${sOpen.focusInFind}`);
    await page.keyboard.type('사과');
    await sleep(400);
    const s1 = await snap(page);
    push(`[${tag}] ① «사과» 3곳 칠함 · 1/3 · 지금 결과가 화면 안`, s1.matches === 3 && s1.count.trim() === '1/3' && s1.curVisible,
      `칠함 ${s1.matches} · «${s1.count}» · 보임 ${s1.curVisible}`);

    await page.keyboard.press('Enter');
    await sleep(300);
    const s2 = await snap(page);
    push(`[${tag}] ② Enter → 2/3`, s2.count.trim() === '2/3', `«${s2.count}»`);

    // 대소문자 — «apple» 은 구분 끄면 2, 켜면 1
    await page.click('[data-testid="editor-find-input"]', { clickCount: 3 });
    await page.keyboard.type('apple');
    await sleep(300);
    const sCi = await snap(page);
    await page.evaluate(() => { const b = [...document.querySelectorAll('[data-testid="editor-find-bar"] button')].find((x) => x.getAttribute('aria-pressed') !== null); if (b) b.click(); });
    await sleep(300);
    const sCs = await snap(page);
    push(`[${tag}] ② 대소문자 구분: 끔 2 → 켬 1`, sCi.matches === 2 && sCs.matches === 1, `끔 ${sCi.matches} · 켬 ${sCs.matches}`);
    await page.evaluate(() => { const b = [...document.querySelectorAll('[data-testid="editor-find-bar"] button')].find((x) => x.getAttribute('aria-pressed') === 'true'); if (b) b.click(); });

    // 바꾸기 열기 (Ctrl+H) → «사과» → «배»
    await page.click('[data-testid="editor-find-input"]', { clickCount: 3 });
    await page.keyboard.type('사과');
    await sleep(200);
    // 첫 결과(굵은 «사과»)로 — 커서가 문서 끝에 있었으므로 위로 돈다
    for (let i = 0; i < 3; i++) {
      const c = await page.$eval('[data-testid="editor-find-count"]', (el) => el.textContent || '');
      if (c.trim().startsWith('1/')) break;
      await page.keyboard.press('Enter');
      await sleep(200);
    }
    await page.keyboard.down('Control'); await page.keyboard.press('h'); await page.keyboard.up('Control');
    await sleep(300);
    const hasReplace = !!(await page.$('[data-testid="editor-replace-input"]'));
    push(`[${tag}] ③ Ctrl+H 로 바꾸기 칸이 열린다`, hasReplace, `바꾸기 칸 ${hasReplace}`);
    if (!hasReplace) return;
    await page.click('[data-testid="editor-replace-input"]');
    await page.keyboard.type('배');
    await page.click('[data-testid="editor-replace-one"]');
    await sleep(800);   // 실행 취소 묶음 간격(500ms)을 넘겨 «바꾸기» 와 «모두 바꾸기» 를 가른다
    const s3 = await snap(page);
    const boldKept = /<strong>배<\/strong>/.test(s3.html);
    push(`[${tag}] ③ 바꾸기 1건 → 남은 2 · 굵은 글은 굵은 채로`, s3.matches === 2 && boldKept, `남은 ${s3.matches} · 굵게 유지 ${boldKept} · ${s3.html.slice(0, 160)}`);

    await page.click('[data-testid="editor-replace-all"]');
    await sleep(300);
    const s4 = await snap(page);
    const leftOld = (s4.text.match(/사과/g) || []).length;
    const newCnt = (s4.text.match(/배/g) || []).length;
    const doneMsg = !!(await page.$('[data-testid="editor-replace-done"]'));
    push(`[${tag}] ④ 모두 바꾸기 → 옛 글 0 · 새 글 3 · 결과 안내`, leftOld === 0 && newCnt === 3 && s4.matches === 0 && doneMsg,
      `사과 ${leftOld} · 배 ${newCnt} · 칠함 ${s4.matches} · 안내 ${doneMsg}`);

    // 실행 취소 한 번 = «모두 바꾸기» 분(2곳)이 통째로 돌아온다
    await page.click('.ProseMirror');
    await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
    await sleep(300);
    const s5 = await snap(page);
    const back = (s5.text.match(/사과/g) || []).length;
    push(`[${tag}] ④ Ctrl+Z 한 번에 모두 바꾸기 분 2곳이 돌아온다`, back === 2, `사과 ${back}`);

    // 막대가 화면 가로를 넘지 않는다
    push(`[${tag}] ⑤ 막대·페이지가 가로로 넘치지 않는다`, s5.docW <= s5.winW + 2 && s5.barRight <= s5.winW + 1,
      `문서 ${s5.docW} / 창 ${s5.winW} · 막대 오른끝 ${s5.barRight}`);

    // Esc → 닫히고 칠한 자리 0
    await page.click('[data-testid="editor-find-input"]');
    await page.keyboard.press('Escape');
    await sleep(300);
    const s6 = await snap(page);
    push(`[${tag}] ⑤ Esc 로 닫히면 칠한 자리 0`, !s6.barOpen && s6.matches === 0, `막대 ${s6.barOpen} · 칠함 ${s6.matches}`);

    // ⑥ 밑줄·구분선
    await page.click('.ProseMirror');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await sleep(250);
    await page.click('[data-testid="editor-underline"]');
    await page.keyboard.type('밑줄글');
    await page.click('[data-testid="editor-hr"]');
    await sleep(300);
    const s7 = await snap(page);
    push(`[${tag}] ⑥ 밑줄·구분선 버튼이 <u>·<hr> 를 만든다`, /<u>밑줄글<\/u>/.test(s7.html) && /<hr/.test(s7.html),
      `u ${/<u>/.test(s7.html)} · hr ${/<hr/.test(s7.html)} · ${s7.html.slice(-220)}`);
  } finally {
    await browser.close();
  }
}

async function run() {
  const since = new Date(Date.now() - 60 * 1000);
  try {
    for (const w of [390, 820, 1440]) await oneWidth(w);
  } finally {
    // 자동 임시저장으로 생긴 문서 정리 — 표식 글이 든 것만, 이 실행 이후 것만
    const [rows] = await sequelize.query('SELECT id FROM posts WHERE created_at >= ? AND (content_json LIKE ? OR content_text LIKE ?)', { replacements: [since, `%${MARK}%`, `%${MARK}%`] }).catch(() => [[]]);
    const ids = rows.map((r) => r.id);
    if (ids.length) {
      await sequelize.query('DELETE FROM post_revisions WHERE post_id IN (?)', { replacements: [ids] }).catch(() => {});
      await sequelize.query('DELETE FROM posts WHERE id IN (?)', { replacements: [ids] }).catch(() => {});
    }
    push('정리 — 검사 문서 삭제', true, `${ids.length}건`);
  }
  return results;
}

module.exports = { name: '문서 편집기 찾기·바꾸기 + 밑줄·구분선 (3폭)', run };
