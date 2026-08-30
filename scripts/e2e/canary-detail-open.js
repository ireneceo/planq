// 상세 폴백 검증 — Fable 프로토콜: 유효 ID / 없는 ID / 다른 워크스페이스 ID 3케이스.
//   ★판정은 data-testid 로만 (휴리스틱 금지 — 내 검사기가 세 번 속았다)
// scripts/e2e/canary-detail-open.js — 상세가 실제로 열리는가 (2026-08-30)
//
// Irene: "메일이나 음성노트 문서 등 여러 상황에서 상세가 제대로 딱 딱 안열리는 경우가 너무 많아"
//
// 두 가지를 fail-closed 로 잡는다:
//   ① 유효 ID 딥링크 → 상세가 뜬다 (폴백이 안 뜬다)
//   ② 없는 ID 딥링크 → **말을 한다**(detail-fallback-notfound). 침묵은 실패다.
//
// ★ 판정은 data-testid 로만. 휴리스틱(위치·크기·본문 길이)으로 재면 검사기가 거짓말한다 —
//   이 파일을 만드는 동안 실제로 네 번 그랬다:
//     ①전 화면에서 헤더의 같은 버튼을 눌렀고 ②없는 ID 로도 통과했고
//     ③파라미터 이름을 틀렸고(?record= vs ?doc=) ④탭으로 살아 있는 이전 화면의 폴백을 주웠다.
//   그래서 아래 FB 는 **보이는** 폴백만 센다.
const { launch, login, goto, sleep } = require('./lib/browser');

const results = [];
const ok = (msg) => results.push({ name: msg, fail: false });
const bad = (msg) => results.push({ name: msg, fail: true });

// ★ **보이는** 폴백만 센다. PlanQ 는 탭 pane 을 살려 두므로(MAX_ALIVE=4) 이전 화면의
//   폴백이 DOM 에 남아 있다 — 그냥 querySelector 하면 지금 화면과 무관한 것을 줍는다.
//   실제로 그렇게 4번째 거짓 실패가 났다: 제목이 멀쩡히 렌더된 화면을 "notfound" 로 읽었다.
const FB = `(() => {
  const els = [...document.querySelectorAll('[data-testid^="detail-fallback-"]')];
  const vis = els.find((e) => {
    if (!e.offsetParent && getComputedStyle(e).position !== 'fixed') return false;
    const r = e.getBoundingClientRect();
    return r.width > 40 && r.height > 20 && r.bottom > 0 && r.top < innerHeight;
  });
  return vis ? vis.getAttribute('data-testid') : null;
})()`;

// [라벨, URL 만들기, 유효 ID, 없는 ID, 남의 워크스페이스 ID]
const CASES = [
  ['업무   ', (id)=>`/tasks?task=${id}`,   1600, 99999901, null],
  ['메일   ', (id)=>`/mail?folder=all&thread=${id}`, 5594, 99999901, null],
  ['Q info', (id)=>`/info?doc=${id}`,      null, 99999901, null],
];

async function run() {
  const { browser, page } = await launch({ mobile: false });
  try {
    await page.setViewport({ width: 1440, height: 900 });
    await login(page);
    // Q info 실제 doc id 하나 확보
    await goto(page, '/info'); await sleep(3500);
    const docId = await page.evaluate(() => {
      const rows=[...document.querySelectorAll('[data-doc-id],[data-testid^="kb-row"]')];
      if (rows.length) return rows[0].getAttribute('data-doc-id') || null;
      return null;
    });
    CASES[2][2] = docId ? Number(docId) : null;

    for (const [label, mk, good, missing] of CASES) {
      if (good != null) {
        await goto(page, mk(good));
        // ★ 고정 대기는 **로딩 중을 실패로 오독**한다 (1차에 메일이 그렇게 거짓 실패했다).
        //   폴백이 사라질 때까지 기다리되 상한을 둔다.
        let f = null;
        for (let i = 0; i < 16; i++) {
          await sleep(700);
          f = await page.evaluate(FB);
          if (f === null) break;
        }
        (f === null || f === 'detail-fallback-loading')
          ? ok(`${label} 유효 ID → 폴백 없음(정상 표시)`)
          : bad(`${label} 유효 ID 인데 폴백 ${f}`);
      } else {
        console.log(`  ${label} 유효 ID 확보 실패 — 건너뜀`);
      }
      await goto(page, mk(missing));
      let f2 = null;
      for (let i = 0; i < 16; i++) {
        await sleep(700);
        f2 = await page.evaluate(FB);
        if (f2 && f2 !== 'detail-fallback-loading') break;
      }
      f2 === 'detail-fallback-notfound' ? ok(`${label} 없는 ID → "찾을 수 없는 항목입니다"`)
        : bad(`${label} 없는 ID → ${f2 || '아무 말도 없음(회귀)'}`);
    }
  } finally { await browser.close(); }
  return results;
}

module.exports = { name: '상세 열림 (딥링크·없음 상태)', run };
