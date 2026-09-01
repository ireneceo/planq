// scripts/e2e/canary-richeditor-resize.js — RichEditor 본문 이미지에 **크기 조절 손잡이가 붙는가**
//
// 운영 #378 (Irene): "그냥 드래그로 넣으면 사이즈 조정도 안되네... 통일해서 맞춰서
//   일반적인 기능으로 해야 해."
//   같은 앱인데 **Q docs 에서만** 크기 조절이 됐다. Q info·Q Task·Q Mail 이 쓰는 RichEditor 는
//   width 속성만 더한 자체 확장이라 nodeView(손잡이)가 아예 없었다.
//   이제 두 에디터가 같은 ResizableImage + 같은 CSS(resizableImageStyles)를 쓴다.
//
// ★ 왜 Q Task 로 재는가 — Q info(KnowledgePage)에는 data-testid 가 **하나도 없어** 하니스가
//   편집기를 열 수가 없다(CLAUDE.md §17 위반). Q Mail 본문은 아직 uploadUrl 이 없어
//   이미지를 아예 못 넣는다(그 자체가 미해결 항목 — docs/for-fable 참조).
//   같은 RichEditor 를 쓰면서 uploadUrl 이 있는 Q Task 로 판정한다.
// ★ canary-image-resize(Q docs)와 **파일을 나눈 이유**: 한 브라우저에서 드래그 조작을 한 뒤
//   다른 화면으로 이동하면 프레임이 끊겼다("detached Frame" → "Connection closed"). 따로 띄운다.
const b = require('./lib/browser');

const dropImage = async (page) => page.evaluate(async () => {
  const pm = document.querySelector('.pq-editor-body');
  if (!pm) return 'no_editor';
  // 1x1 은 화면 폭이 1px 이라 좌표를 못 잡는다 — 실제 크기 있는 이미지를 만든다.
  const cv = document.createElement('canvas');
  cv.width = 200; cv.height = 120;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#14B8A6'; cx.fillRect(0, 0, 200, 120);
  const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
  const file = new File([blob], 'canary.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const r = pm.getBoundingClientRect();
  pm.dispatchEvent(new DragEvent('drop', {
    bubbles: true, cancelable: true, dataTransfer: dt,
    clientX: Math.round(r.left + 40), clientY: Math.round(r.top + 40),
  }));
  return 'dropped';
});

async function run() {
  const results = [];
  const { browser, page } = await b.launch();
  try {
    await page.setViewport({ width: 1440, height: 900 });
    await b.login(page);
    await b.goto(page, '/tasks?create=1');
    await b.sleep(3000);
    const hasEditor = await page.evaluate(() => !!document.querySelector('.pq-editor-body'));
    if (!hasEditor) {
      // ★ 못 열었으면 **판정 불가로 실패**한다 — 0개 검사에 "이상 없음" 을 내지 않는다.
      results.push({ name: 'editor-open', ok: false, msg: '🔴 Q Task 본문 편집기를 못 열었다 — 검사 0개, 판정 불가' });
      return results;
    }
    const dropped = await dropImage(page);
    let shown = false;
    for (let i = 0; i < 24 && !shown; i++) {
      await b.sleep(500);
      shown = await page.evaluate(() => !!document.querySelector('.pq-editor-body img'));
    }
    results.push({ name: 'drop-insert', ok: shown,
      msg: shown ? '드래그한 이미지가 본문에 들어간다' : `🔴 이미지가 안 들어감(drop=${dropped}) — 업로드 경로 확인` });
    if (!shown) return results;

    const m = await page.evaluate(() => {
      const body = document.querySelector('.pq-editor-body');
      const w = body && body.querySelector('.pq-img-wrap');
      const h = body && body.querySelector('.pq-img-handle');
      if (!w) return { wrap: false };
      const wr = w.getBoundingClientRect(), br = body.getBoundingClientRect();
      const hs = h ? getComputedStyle(h) : null;
      return { wrap: true, handle: !!h, handleDisplay: hs ? hs.display : null,
               wrapW: Math.round(wr.width), bodyW: Math.round(br.width) };
    });
    results.push({ name: 'nodeview-wrap', ok: !!m.wrap,
      msg: m.wrap ? `nodeView 가 이미지를 감쌌다 (${m.wrapW}px / 본문 ${m.bodyW}px)`
                  : '🔴 nodeView 가 안 붙었다 — RichEditor 가 아직 옛 확장을 쓴다' });
    if (!m.wrap) return results;
    // ★ 감싼 요소가 본문 전체 폭을 먹으면 손잡이가 이미지가 아니라 본문 오른쪽 끝에 붙는다(실측 함정 ①).
    results.push({ name: 'wrap-fits-image', ok: m.wrapW > 0 && m.wrapW < m.bodyW,
      msg: `감싼 폭 ${m.wrapW}px < 본문 ${m.bodyW}px ${m.wrapW < m.bodyW ? '' : '← 전체 폭을 먹었다'}` });
    results.push({ name: 'handle-exists', ok: !!m.handle,
      msg: m.handle ? `손잡이 있음 (display=${m.handleDisplay})` : '🔴 손잡이가 없다 — 공용 CSS 가 안 실렸다' });
  } finally {
    await browser.close().catch(() => {});
  }
  return results;
}

function toRunnerShape(rows) {
  return rows.map((r) => ({ name: r.name, fail: r.ok ? 0 : 1, details: [r.msg], hasCanary: true }));
}
module.exports = { run: async () => toRunnerShape(await run()), name: 'richeditor-resize' };

if (require.main === module) {
  run().then((res) => {
    let fail = 0;
    console.log('\n=== RichEditor 이미지 크기 조절 ===');
    for (const r of res) { console.log(`${r.ok ? '✅' : '❌'} ${r.name} — ${r.msg}`); if (!r.ok) fail++; }
    console.log(`\n검사 ${res.length}개 · 실패 ${fail}`);
    process.exit(fail > 0 ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e.message); process.exit(2); });
}
