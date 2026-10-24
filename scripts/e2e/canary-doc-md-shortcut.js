// scripts/e2e/canary-doc-md-shortcut.js — 모바일 문서 «# »·«- »·«1. » 변환 + iOS 모양 붙여넣기 (2026-10-24)
//
// Irene: *"모바일에서 문서에 # ## 이런거 붙은 글자 크기 마킹 붙인 내용도 적용이 안돼."*
//
//   재는 것 (폰 390 · 태블릿 820 · 데스크탑 1440):
//     ① 키보드로 «# » → 제목1, 글자 크기 22px (데스크탑 경로 — TipTap 입력 규칙)
//     ② «## » 를 입력 규칙을 거치지 않고 넣는다(한글 자판 조합 끝 반영과 같은 길 — handleTextInput 없이 문서만 바뀜) → 제목2
//        대조군: 같은 글을 «기록 안 함» 트랜잭션으로 넣으면 문단 그대로(사람이 친 것만 바꾼다)
//     ③ 바꾼 직후 실행 취소 → «##» 문단으로 돌아오고 다시 바뀌지 않는다
//     ④ «- »·«1. » 도 같은 길로 → 글머리표·번호 목록
//     ⑤ iOS 모양 붙여넣기(text/html = <p><span> 뿐 + text/plain 마크다운) → 제목1·제목2
//        대조군: 구조 있는 html(<b>) + 같은 평문 → 기본 파서(굵게 유지, 제목 안 생김)
//   새 문서는 자동 임시저장되므로 끝나면 표식 글(zqmdsc)로 찾아 지운다.
const { launch, login, goto, sleep, dismissBlockers } = require('./lib/browser');
const { sequelize } = require('/opt/planq/dev-backend/config/database');

const MARK = 'zqmdsc';
const results = [];
const push = (name, pass, detail) => results.push({ name, fail: !pass, details: detail ? [detail] : [] });

// 커서가 든 블록 정보
const cur = (page) => page.evaluate(() => {
  const ed = document.querySelector('.ProseMirror').editor;
  const $f = ed.state.selection.$from;
  return { type: $f.parent.type.name, level: $f.parent.attrs.level || 0, text: $f.parent.textContent, wrap: $f.depth > 1 ? $f.node(-2) && $f.node(-2).type.name : '', html: ed.getHTML() };
});
// 새 빈 문단을 문서 끝에 만들고 커서를 둔다
const freshLine = (page) => page.evaluate(() => {
  const ed = document.querySelector('.ProseMirror').editor;
  ed.chain().focus('end').run();
  const { state } = ed.view;
  const end = state.doc.content.size;
  const tr = state.tr.insert(end, state.schema.nodes.paragraph.create());
  tr.setSelection(state.selection.constructor.near(tr.doc.resolve(end + 1)));
  ed.view.dispatch(tr);
}).then(() => sleep(200));
// 입력 규칙을 거치지 않고 커서 자리에 글을 넣는다 (모바일 조합 끝 반영과 같은 길)
const rawInsert = (page, text, noHistory = false) => page.evaluate((t, nh) => {
  const ed = document.querySelector('.ProseMirror').editor;
  const tr = ed.view.state.tr.insertText(t);
  if (nh) tr.setMeta('addToHistory', false);
  ed.view.dispatch(tr);
}, text, noHistory);

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
    await page.keyboard.type(MARK);
    await page.keyboard.press('Enter');
    await sleep(3500);   // 새 문서 첫 자동저장(문서가 생기며 편집기가 다시 그려진다)이 지난 뒤에 잰다
    await page.evaluate(() => document.querySelector('.ProseMirror').editor.chain().focus('end').run());
    // ①
    await page.keyboard.type('# ');
    await page.keyboard.type('큰제목');
    await sleep(200);
    const c1 = await cur(page);
    const fs1 = await page.evaluate(() => { const h = document.querySelector('.ProseMirror h1'); return h ? getComputedStyle(h).fontSize : ''; });
    push(`[${tag}] ① 키보드 «# » → 제목1 · 22px`, c1.type === 'heading' && c1.level === 1 && c1.text === '큰제목' && fs1 === '22px', `${c1.type}/${c1.level} «${c1.text}» · ${fs1}`);

    // ② 대조군 먼저 — 기록 안 함 트랜잭션은 바꾸지 않는다
    await freshLine(page);
    await rawInsert(page, '## ', true);
    await sleep(150);
    const c2n = await cur(page);
    push(`[${tag}] ② 대조군: 기록 안 함으로 넣은 «## » 는 문단 그대로`, c2n.type === 'paragraph' && c2n.text === '## ', `${c2n.type} «${c2n.text}»`);
    await freshLine(page);
    await rawInsert(page, '##');
    await sleep(700);   // 실행 취소 묶음을 가른다 — «##» 와 «스페이스+바꿈» 이 따로 되돌려지게
    await rawInsert(page, ' ');
    await sleep(150);
    const c2 = await cur(page);
    push(`[${tag}] ② 입력 규칙 없이 «## » → 제목2 (모바일 조합 경로)`, c2.type === 'heading' && c2.level === 2 && c2.text === '', `${c2.type}/${c2.level} «${c2.text}»`);
    // ③
    await page.evaluate(() => document.querySelector('.ProseMirror').editor.commands.undo());
    await sleep(150);
    const c3 = await cur(page);
    push(`[${tag}] ③ 실행 취소 → «##» 문단으로 돌아오고 다시 안 바뀐다`, c3.type === 'paragraph' && c3.text === '##', `${c3.type} «${c3.text}»`);

    // ④
    await freshLine(page);
    await rawInsert(page, '- ');
    await sleep(150);
    const c4 = await cur(page);
    await freshLine(page);
    await rawInsert(page, '1. ');
    await sleep(150);
    const c5 = await cur(page);
    push(`[${tag}] ④ «- » → 글머리표 · «1. » → 번호 목록`, c4.wrap === 'bulletList' && c5.wrap === 'orderedList', `${c4.wrap} · ${c5.wrap}`);

    // ⑤ 붙여넣기
    const paste = (html, text) => page.evaluate((h, t) => {
      const ed = document.querySelector('.ProseMirror').editor;
      ed.chain().focus('end').run();
      const dt = new DataTransfer();
      if (h) dt.setData('text/html', h);
      dt.setData('text/plain', t);
      ed.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, html, text);
    const counts = () => page.evaluate(() => ({ h1: document.querySelectorAll('.ProseMirror h1').length, h2: document.querySelectorAll('.ProseMirror h2').length, html: document.querySelector('.ProseMirror').innerHTML }));
    await freshLine(page);
    const before = await counts();
    await paste('<meta charset="utf-8"><p style="margin:0"><span style="font-size:17px">#&nbsp;붙인제목</span></p><p><span>## 붙인소제목</span></p><p><span>본문</span></p>', '# 붙인제목\n## 붙인소제목\n본문');
    await sleep(300);
    const after = await counts();
    push(`[${tag}] ⑤ iOS 모양 붙여넣기 → 제목1·제목2 생김`, after.h1 === before.h1 + 1 && after.h2 === before.h2 + 1 && /붙인제목<\/h1>/.test(after.html),
      `h1 ${before.h1}→${after.h1} · h2 ${before.h2}→${after.h2}`);
    await freshLine(page);
    await paste('<p><b>굵은붙임</b> # 아님</p>', '# 굵은붙임');
    await sleep(300);
    const after2 = await counts();
    push(`[${tag}] ⑤ 대조군: 구조 있는 html(<b>) 은 기본 파서 — 제목 안 생기고 굵게 유지`, after2.h1 === after.h1 && /<strong>굵은붙임<\/strong>/.test(after2.html),
      `h1 ${after.h1}→${after2.h1} · strong ${/<strong>굵은붙임/.test(after2.html)}`);
    await sleep(2500);   // 자동 임시저장이 표식 글을 저장할 때까지 — 정리에서 찾을 수 있게
  } finally {
    await browser.close();
  }
}

async function run() {
  const since = new Date(Date.now() - 60 * 1000);
  try {
    for (const w of (process.env.W ? [Number(process.env.W)] : [390, 820, 1440])) await oneWidth(w);
  } finally {
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

module.exports = { name: '문서 «# »·«- » 변환(모바일 조합 경로) + iOS 모양 붙여넣기 (3폭)', run };
