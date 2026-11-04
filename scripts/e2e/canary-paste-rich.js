// scripts/e2e/canary-paste-rich.js — 웹에서 «글+그림+영상» 을 한꺼번에 복사해 붙이기 (2026-11-04)
//
// Irene: *"웹에서 복사하면 영상 이미지 모두 다같이 복사한 거 붙이기도 되게 못해?"*
//   공용 함수 utils/pasteRich 를 두 편집기(문서 PostEditor · 업무 설명 RichEditor)가 같이 쓴다. 둘 다 잰다.
//
//   ① 글+그림 html + 그림 파일(사파리·워드 모양) → 앞글·뒷글이 남고 그림은 우리 주소(/api/…)로 올라간다
//      (옛 동작: 그림 파일 1장만 남고 글이 사라졌다)
//      대조군: 그림 «한 장만» 복사(html = <img> 하나 + 파일) → 파일 경로 그대로(그림 1장, 글 없음)
//   ② 지연 로딩 그림(src = 1×1 gif 자리표시자, data-src = 진짜 주소) → src 가 진짜 주소, 업로드 0
//   ③ <iframe 유튜브 embed> · <video src=mp4> → 사라지지 않고 원래 주소 링크(유튜브는 watch 주소)
//      · <iframe> 태그는 편집기 안에 0개(새 보안 표면 없음 — Fable 2026-11-04 «A-ONLY»)
//   문서는 3폭(390·820·1440), 업무 설명은 1440 한 폭(같은 함수 — 두 편집기 같은 동작 확인용).
const { launch, login, goto, sleep, dismissBlockers } = require('./lib/browser');
const { sequelize } = require('/opt/planq/dev-backend/config/database');

const MARK = 'zqpasterich';
const results = [];
const push = (name, pass, detail) => results.push({ name, fail: !pass, details: detail ? [detail] : [] });
const GIF1 = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const LAZY_URL = 'https://dev.planq.kr/favicon.ico';

// 붙여넣기 합성 — withPng 면 실제 크기 있는 PNG 를 html 안 data: 와 파일 둘 다로 싣는다(사파리·워드 모양)
const paste = (page, sel, html, text, mode) => page.evaluate(async (s, h, t, m) => {
  const root = document.querySelector(s);
  const ed = root.editor || (root.closest('[class]') && root.editor);
  const view = ed ? ed.view : null;
  if (ed) ed.chain().focus('end').run();
  const dt = new DataTransfer();
  let dataUrl = '';
  if (m) {
    const cv = document.createElement('canvas');
    cv.width = 160; cv.height = 90;
    const cx = cv.getContext('2d');
    cx.fillStyle = '#14B8A6'; cx.fillRect(0, 0, 160, 90); cx.fillStyle = '#fff'; cx.fillRect(20, 20, 60, 30);
    dataUrl = cv.toDataURL('image/png');
    const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));   // fetch(data:) 는 CSP 가 막는다
    dt.items.add(new File([blob], 'image.png', { type: 'image/png' }));
  }
  dt.setData('text/html', h.replace('__PNG__', dataUrl));
  dt.setData('text/plain', t);
  (view ? view.dom : root).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, sel, html, text, mode);

const snap = (page, sel) => page.evaluate((s) => {
  const r = document.querySelector(s);
  return {
    text: r.textContent,
    imgs: [...r.querySelectorAll('img')].map((i) => i.getAttribute('src') || ''),
    links: [...r.querySelectorAll('a')].map((a) => a.getAttribute('href') || ''),
    iframes: r.querySelectorAll('iframe, video').length,
  };
}, sel);

async function waitImgs(page, sel, n) {
  for (let i = 0; i < 30; i++) {
    const s = await snap(page, sel);
    if (s.imgs.filter((x) => !x.startsWith('data:')).length >= n) return s;
    await sleep(400);
  }
  return snap(page, sel);
}

async function clearEditor(page, sel) {
  await page.evaluate((s) => {
    const r = document.querySelector(s);
    const ed = r.editor;
    if (ed) ed.commands.setContent('<p>zqpasterich</p>');
  }, sel);
  await sleep(200);
}

async function scenarios(page, sel, tag, uploads) {
  // ① 글+그림+파일
  await clearEditor(page, sel);
  const u0 = uploads.n;
  await paste(page, sel, '<meta charset="utf-8"><p>앞글zq</p><img src="__PNG__"><p>뒷글zq</p>', '앞글zq\n뒷글zq', true);
  const s1 = await waitImgs(page, sel, 1);
  const ours = s1.imgs.filter((x) => !x.startsWith('data:') && /\/api\/|\/uploads\/|^\/|planq/.test(x));
  push(`[${tag}] ① 글+그림+파일 → 글 남고 그림 우리 주소로`, /앞글zq/.test(s1.text) && /뒷글zq/.test(s1.text) && ours.length === 1 && uploads.n - u0 === 1,
    `앞 ${/앞글zq/.test(s1.text)} · 뒤 ${/뒷글zq/.test(s1.text)} · 그림 ${s1.imgs.length}(우리 ${ours.length}) · 업로드 ${uploads.n - u0}`);

  // ① 대조군 — 그림 한 장만 복사(html 은 <img> 하나)
  await clearEditor(page, sel);
  const u1 = uploads.n;
  await paste(page, sel, '<meta charset="utf-8"><img src="https://example.com/only.png">', '', true);
  const s1c = await waitImgs(page, sel, 1);
  push(`[${tag}] ① 대조군: 그림 한 장만 → 파일 경로(업로드 1, 원격 주소 아님)`, uploads.n - u1 === 1 && s1c.imgs.length === 1 && !s1c.imgs[0].includes('example.com'),
    `그림 ${JSON.stringify(s1c.imgs.map((x) => x.slice(0, 40)))} · 업로드 ${uploads.n - u1}`);

  // ② 지연 로딩 그림
  await clearEditor(page, sel);
  const u2 = uploads.n;
  await paste(page, sel, `<p>지연zq</p><img src="${GIF1}" data-src="${LAZY_URL}"><p>끝zq</p>`, '지연zq\n끝zq', false);
  await sleep(1200);
  const s2 = await snap(page, sel);
  push(`[${tag}] ② 지연 로딩 그림 → 진짜 주소 · 업로드 0`, s2.imgs.length === 1 && s2.imgs[0] === LAZY_URL && uploads.n === u2 && /끝zq/.test(s2.text),
    `그림 ${JSON.stringify(s2.imgs)} · 업로드 ${uploads.n - u2}`);

  // ③ 영상
  await clearEditor(page, sel);
  await paste(page, sel, '<p>영상zq</p><iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ?si=x" width="560"></iframe><video src="https://example.com/clip.mp4" controls></video><p>뒤zq</p>', '영상zq\n뒤zq', false);
  await sleep(800);
  const s3 = await snap(page, sel);
  const yt = s3.links.includes('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  const mp4 = s3.links.includes('https://example.com/clip.mp4');
  push(`[${tag}] ③ 영상 → 링크로 남음 · iframe/video 태그 0`, yt && mp4 && s3.iframes === 0 && /뒤zq/.test(s3.text),
    `유튜브 ${yt} · mp4 ${mp4} · 태그 ${s3.iframes} · 링크 ${JSON.stringify(s3.links)}`);
}

function countUploads(page) {
  const uploads = { n: 0 };
  page.on('response', (r) => {
    const u = r.url();
    if (r.request().method() === 'POST' && (/\/api\/posts\/editor-image/.test(u) || /\/api\/files\/\d+(\/|$|\?)/.test(u))) uploads.n += 1;
  });
  return uploads;
}

async function docsWidth(width) {
  const tag = `문서 ${width}`;
  const { browser, page } = await launch();
  try {
    const uploads = countUploads(page);
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
    await sleep(3500);   // 첫 자동저장으로 편집기가 다시 그려진 뒤에 잰다
    await scenarios(page, '.ProseMirror', tag, uploads);
    await sleep(2500);
  } finally {
    await browser.close();
  }
}

async function taskDesc() {
  const tag = '업무 설명 1440';
  const { browser, page } = await launch();
  try {
    const uploads = countUploads(page);
    await page.setViewport({ width: 1440, height: 900 });
    await login(page);
    await goto(page, '/tasks?create=1');
    await sleep(3000);
    if (!(await page.$('.pq-editor-body'))) { push(`[${tag}] 편집기 열기`, false, '못 열었다 — 판정 불가(실패)'); return; }
    await scenarios(page, '.pq-editor-body', tag, uploads);
  } finally {
    await browser.close();
  }
}

async function run() {
  const since = new Date(Date.now() - 60 * 1000);
  try {
    for (const w of (process.env.W ? [Number(process.env.W)] : [390, 820, 1440])) await docsWidth(w);
    if (!process.env.W) await taskDesc();
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

module.exports = { name: '글+그림+영상 한꺼번에 붙이기 (문서 3폭 + 업무 설명)', run };
