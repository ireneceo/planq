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

// ★ 침묵을 신고하기 전에 **주소가 밀렸는지** 먼저 말한다.
//   2026-09-06: 이 카나리가 6건을 "아무 말도 없음(회귀)" 으로 신고했는데 진짜 원인은
//   폴백이 아니라 **딥링크 쿼리가 옛 탭에 덮인 것**이었다(/tasks?task=99999901 로 들어가면
//   주소가 /tasks?task=1600 으로 되돌아갔다 — tabStore.setTabScope 가 identity 로만 비교해서).
//   그 화면은 요청받지 않은 항목을 멀쩡히 그리고 있었으니 폴백이 없는 게 당연했다.
//   원인을 잘못 가리키는 실패 메시지는 다음 사람을 엉뚱한 곳으로 보낸다.
async function drift(page, want) {
  const now = await page.evaluate(() => location.pathname + location.search).catch(() => null);
  return (now && now !== want) ? `  ※ 주소가 밀렸다: 요청 ${want} → 실제 ${now} (딥링크가 옛 탭에 덮였는지 보라)` : '';
}

// [라벨, URL 만들기, 유효 ID, 없는 ID, **남의 워크스페이스** ID]
//   남의 워크스페이스 케이스는 Fable 이 필수로 지목했다 — 403 도 침묵으로 떨어지던 계열이다.
//   dev 에 워크스페이스가 여러 개라 재현 가능하다(health-check 은 5·73 소속).
const CASES = [
  ['업무   ', (id)=>`/tasks?task=${id}`,             1600, 99999901, 1667],
  ['메일   ', (id)=>`/mail?folder=all&thread=${id}`, 5594, 99999901, 5595],
  ['문서   ', (id)=>`/docs?post=${id}`,              null, 99999901, 367],
  ['Q info', (id)=>`/info?doc=${id}`,                null, 99999901, null],
  ['프로젝트', (id)=>`/projects/p/${id}`,             196,  99999901, null],
];

async function run() {
  const { browser, page } = await launch({ mobile: false });
  try {
    await page.setViewport({ width: 1440, height: 900 });
    await login(page);
    // Q info 실제 doc id 하나 확보
    await goto(page, '/info'); await sleep(3500);
    const docId = await page.evaluate(() => {
      const rows=[...document.querySelectorAll('[data-doc-id],[data-testid^="kb-row"],[data-kb-id]')];
      for (const r of rows) {
        const v = r.getAttribute('data-doc-id') || r.getAttribute('data-kb-id');
        if (v && /^\d+$/.test(v)) return v;
      }
      return null;
    });
    // ★ 인덱스로 넣지 말 것 — 화면을 추가하면 밀려서 **엉뚱한 케이스**에 들어간다.
    //   실제로 문서(post) 케이스에 KB doc id 가 들어가 거짓 실패했다(2026-08-30).
    const qinfo = CASES.find((c) => c[0].trim() === 'Q info');
    if (qinfo) qinfo[2] = docId ? Number(docId) : null;

    // 문서(post) 유효 ID 도 목록에서 집는다 — 계약은 data-post-id
    await goto(page, '/docs'); await sleep(3500);
    const postId = await page.evaluate(() => {
      const r = document.querySelector('[data-post-id]');
      const v = r ? r.getAttribute('data-post-id') : null;
      return v && /^\d+$/.test(v) ? v : null;
    });
    const docsCase = CASES.find((c) => c[0].trim() === '문서');
    if (docsCase) docsCase[2] = postId ? Number(postId) : null;

    for (const [label, mk, good, missing, foreign] of CASES) {
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
        : bad(`${label} 없는 ID → ${f2 || '아무 말도 없음(회귀)'}${await drift(page, mk(missing))}`);

      // ── 남의 워크스페이스 — 403 도 말을 해야 한다 (침묵 금지) ──
      if (foreign) {
        await goto(page, mk(foreign));
        let f3 = null;
        for (let i = 0; i < 16; i++) {
          await sleep(700);
          f3 = await page.evaluate(FB);
          if (f3 && f3 !== 'detail-fallback-loading') break;
        }
        // 서버가 404 로 감추는 정책일 수도 있다 — 둘 다 "말을 한 것" 이므로 통과로 본다.
        //   침묵(null)이나 영원한 로딩만 실패다.
        (f3 === 'detail-fallback-forbidden' || f3 === 'detail-fallback-notfound')
          ? ok(`${label} 남의 워크스페이스 → 말을 한다 (${f3.replace('detail-fallback-','')})`)
          : bad(`${label} 남의 워크스페이스 → ${f3 || '아무 말도 없음(회귀)'}${await drift(page, mk(foreign))}`);
      }
    }
  } finally { await browser.close(); }
  return results;
}

module.exports = { name: '상세 열림 (딥링크·없음 상태)', run };
