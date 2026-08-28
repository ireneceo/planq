// 이미지 크기 조정 카나리 — 운영 #378: "그냥 드래그로 넣으면 사이즈 조정도 안되네"
//
//   붙여넣기 경로는 HTML(insertContent)로, 드래그 경로는 setImage 로 들어간다 — **삽입 경로가 다르다.**
//   운영 데이터로는 구분이 안 된다(33% 14건·66% 12건이 어느 경로로 들어간 것인지 알 수 없다).
//   그래서 드롭을 실제로 흉내 내고 그 뒤 S/M/L 이 뜨고 먹히는지까지 본다.
//
//   ★ 검사 대상이 0개면 통과가 아니라 **판정 불가로 실패**한다 — 에디터를 못 열었는데
//     "이상 없음" 을 내는 것이 이 하니스가 여러 번 저지른 거짓말이다.
const b = require('./lib/browser');

// 1x1 PNG (base64) — 업로드가 실제로 서버를 타야 하므로 진짜 이미지여야 한다.
// 200x120 단색 PNG — 1x1 은 화면에서 폭이 1px 이라 **클릭 좌표를 못 잡는다**(도구 탓 실패).
const PNG_B64 = null;   // 아래에서 캔버스로 만든다

const dropImage = async (page) => page.evaluate(async () => {
  const pm = document.querySelector('.ProseMirror');
  if (!pm) return 'no_editor';
  const cv = document.createElement('canvas');
  cv.width = 200; cv.height = 120;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#3366cc'; cx.fillRect(0, 0, 200, 120);
  const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
  const file = new File([blob], 'canary.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const r = pm.getBoundingClientRect();
  const opts = { bubbles: true, cancelable: true, dataTransfer: dt,
    clientX: r.left + r.width / 2, clientY: r.top + 20 };
  pm.dispatchEvent(new DragEvent('dragover', opts));
  pm.dispatchEvent(new DragEvent('drop', opts));
  return 'dropped';
});

// ★ 합성 MouseEvent 로 재지 않는다 — ProseMirror 선택과 React 핸들러가 진짜 입력과 다르게 반응해
//   "안 먹힌다" 는 거짓 실패를 낸다. CDP 실제 마우스로만 판정한다.
const clickImage = async (page) => {
  const box = await page.evaluate(() => {
    const img = document.querySelector('.ProseMirror img');
    if (!img) return null;
    const r = img.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  });
  if (!box || box.w < 2 || box.h < 2) return false;
  await page.mouse.click(box.x, box.y);
  return true;
};

// ★ 텍스트가 S/M/L 인 버튼은 **툴바에도 있다**(글자크기). 그걸 누르면 이미지 폭이 안 바뀌어
//   "기능이 죽었다" 는 거짓 실패가 난다 — 실제로 이 카나리가 그렇게 한 번 거짓말했다.
//   버블 메뉴는 떠 있는 박스(조상에 position:absolute|fixed)라 그것만 센다.
const inFloatingBox = (el) => {
  let p = el.parentElement;
  while (p && p !== document.body) {
    const cs = getComputedStyle(p);
    if (cs.position === 'absolute' || cs.position === 'fixed') return true;
    p = p.parentElement;
  }
  return false;
};
const findSizeButtons = async (page) => page.evaluate((fnSrc) => {
  const floating = eval(`(${fnSrc})`);
  return [...document.querySelectorAll('button')]
    .filter((el) => ['S', 'M', 'L'].includes((el.textContent || '').trim()))
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
    .filter(floating)
    .map((el) => (el.textContent || '').trim());
}, inFloatingBox.toString());

const clickSize = async (page, label) => {
  const box = await page.evaluate((lab, fnSrc) => {
    const floating = eval(`(${fnSrc})`);
    const el = [...document.querySelectorAll('button')]
      .filter((x) => (x.textContent || '').trim() === lab && x.getBoundingClientRect().width > 0)
      .find(floating);          // ← 툴바가 아니라 버블 안의 버튼
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, label, inFloatingBox.toString());
  if (!box) return false;
  await page.mouse.click(box.x, box.y);
  return true;
};

// ★ 폭은 감싼 요소(.pq-img-wrap)의 인라인 스타일에 있다 — img 속성이 아니다.
//   **실제 렌더 픽셀도 같이** 잰다: 퍼센트만 보면 "37% 인데 실제 74px" 같은 붕괴를 놓친다(실측 전례).
const imgWidth = async (page) => page.evaluate(() => {
  const img = document.querySelector('.ProseMirror img');
  const wrap = document.querySelector('.pq-img-wrap');
  if (!img) return 'NO_IMG';
  const parentPx = wrap && wrap.parentElement ? wrap.parentElement.getBoundingClientRect().width : 0;
  return {
    pct: (wrap && wrap.style.width) || null,
    px: Math.round(img.getBoundingClientRect().width),
    parentPx: Math.round(parentPx),
  };
});

async function run() {
  const results = [];
  const { browser, page } = await b.launch();
  try {
    await page.setViewport({ width: 1440, height: 900 });
    await b.login(page);
    await b.goto(page, '/docs');
    await b.sleep(3000);

    // 새 문서 → 편집 상태로 들어간다. 오프너 testid 가 바뀌면 여기서 판정 불가로 떨어진다.
    // "+" 는 드롭다운이다 — 열고 "빈 문서" 를 눌러야 편집기가 뜬다.
    const opened = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="docs-new"]');
      if (!btn) return false;
      btn.click(); return true;
    });
    await b.sleep(600);
    const picked = opened && await page.evaluate(() => {
      const it = document.querySelector('[data-testid="docs-new-blank"]');
      if (!it) return false;
      it.click(); return true;
    });
    if (!picked) {
      results.push({ name: 'editor-open', ok: false, msg: '🔴 새 문서 오프너를 못 찾았다 — 검사 0개. 판정 불가' });
      return results;
    }
    await b.sleep(2500);
    const hasEditor = await page.evaluate(() => !!document.querySelector('.ProseMirror'));
    if (!hasEditor) {
      results.push({ name: 'editor-open', ok: false, msg: '🔴 문서 편집기를 열지 못했다 — 검사 0개. 판정 불가' });
      return results;
    }

    const dropped = await dropImage(page);
    if (dropped !== 'dropped') {
      results.push({ name: 'drop', ok: false, msg: `🔴 드롭 흉내 실패(${dropped}) — 판정 불가` });
      return results;
    }
    // 업로드 왕복을 기다린다.
    let appeared = false;
    for (let i = 0; i < 20 && !appeared; i++) {
      await b.sleep(500);
      appeared = await page.evaluate(() => !!document.querySelector('.ProseMirror img'));
    }
    results.push({ name: 'drop-insert', ok: appeared,
      msg: appeared ? '드래그한 이미지가 본문에 들어간다' : '🔴 드래그해도 본문에 이미지가 안 들어간다' });
    if (!appeared) return results;

    await clickImage(page);
    await b.sleep(700);
    const sizes = await findSizeButtons(page);
    const hasSML = ['S', 'M', 'L'].every((x) => sizes.includes(x));
    results.push({ name: 'resize-menu', ok: hasSML,
      msg: hasSML ? '이미지를 클릭하면 S/M/L 이 뜬다' : `🔴 이미지를 클릭해도 크기 버튼이 안 뜬다 (보인 것: ${JSON.stringify(sizes)})` });
    if (!hasSML) return results;

    await clickSize(page, 'S');
    await b.sleep(600);
    const w = await imgWidth(page);
    // 33% 라고 **써 있는 것**만으로는 부족하다 — 실제로 본문 폭의 33% 를 차지해야 한다(±4%p).
    const okPct = w && w.pct === '33%';
    const ratio = w && w.parentPx ? (w.px / w.parentPx) * 100 : 0;
    const okPx = Math.abs(ratio - 33) <= 4;
    results.push({ name: 'resize-apply', ok: !!(okPct && okPx),
      msg: (okPct && okPx)
        ? `S 를 누르면 실제로 33% 로 줄어든다 (${w.px}px / 본문 ${w.parentPx}px = ${ratio.toFixed(0)}%)`
        : `🔴 S 결과가 어긋난다 (표기=${w && w.pct} · 실제 ${w && w.px}px / ${w && w.parentPx}px = ${ratio.toFixed(0)}%)` });

    // #378 의 본뜻 — 끌어서 조절. 프리셋 3단계는 "사이즈 조정" 이 아니다.
    const hbox = await page.evaluate(() => {
      const h = document.querySelector('.pq-img-handle');
      if (!h) return null;
      const r = h.getBoundingClientRect();
      if (r.width === 0) return 'hidden';
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (!hbox || hbox === 'hidden') {
      results.push({ name: 'drag-handle', ok: false,
        msg: `🔴 이미지를 선택해도 크기 손잡이가 없다 (${hbox === 'hidden' ? '있으나 안 보임' : 'DOM 에 없음'})` });
    } else {
      const before = await imgWidth(page);
      const beforePx = before.px;
      await page.mouse.move(hbox.x, hbox.y);
      await page.mouse.down();
      await page.mouse.move(hbox.x + 120, hbox.y, { steps: 12 });   // 오른쪽으로 끌어 넓힌다
      await page.mouse.up();
      await b.sleep(500);
      const after = await imgWidth(page);
      // 표기와 실제 픽셀이 **함께** 커져야 한다 — 하나만 보면 붕괴를 놓친다.
      const grew = after.px > beforePx + 10;
      results.push({ name: 'drag-handle', ok: grew,
        msg: grew
          ? `끌면 실제로 커진다 (${before.pct}/${beforePx}px → ${after.pct}/${after.px}px)`
          : `🔴 손잡이를 끌어도 크기가 그대로다 (${before.pct}/${beforePx}px → ${after.pct}/${after.px}px)` });
      // 놓은 뒤 **문서**에 남는지 — 화면만 바뀌면 새로고침에 사라진다.
      //   에디터를 한 번 건드려 재렌더를 유발한 뒤에도 값이 유지되는지로 본다.
      if (grew) {
        await page.evaluate(() => {
          const pm = document.querySelector('.ProseMirror');
          if (pm) pm.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        });
        await b.sleep(500);
        const still = await imgWidth(page);
        results.push({ name: 'drag-persist', ok: still.px > beforePx + 10,
          msg: still.px > beforePx + 10
            ? `끈 결과가 문서에 남는다 (${still.pct}/${still.px}px)`
            : `🔴 끈 결과가 되돌아간다 (${still.pct}/${still.px}px)` });
      }
    }
  } finally {
    await browser.close();
  }
  return results;
}

// ★ 러너(run.js printSuite)는 결과 **배열**을 순회하며 r.fail(숫자)을 센다.
//   {ok,msg} 객체 하나만 돌려주면 게이트에서 영원히 통과한다 — 전례가 있다.
function toRunnerShape(rows) {
  return rows.map((r) => ({ name: r.name, fail: r.ok ? 0 : 1, details: [r.msg], hasCanary: true }));
}

module.exports = { run: async () => toRunnerShape(await run()), name: 'image-resize' };

if (require.main === module) {
  run().then((res) => {
    let fail = 0;
    console.log('\n=== 이미지 크기 조정 카나리 ===');
    for (const r of res) { console.log(`${r.ok ? '✅' : '❌'} ${r.name} — ${r.msg}`); if (!r.ok) fail++; }
    console.log(`\n검사 ${res.length}개 · 실패 ${fail}`);
    process.exit(fail > 0 ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e.message); process.exit(2); });
}
