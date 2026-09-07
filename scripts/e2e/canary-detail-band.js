// canary-detail-band — 상세 밴드2가 폰에서 **몇 줄이고, 칩이 성한가** (2026-09-07)
//
//   2026-09-06 에 폰 밴드2를 `flex-direction: column`(항상 2줄)으로 바꿨다. 이유는 실측된 사고였다 —
//   좌우가 space-between 으로 폭을 다투면 칩이 "공/유/중" 처럼 **음절 단위로 세로 분해**되고
//   버튼이 잘렸다. 그런데 그 규칙은 내용이 짧아도 항상 2줄을 만든다
//   (Irene 2026-09-07: "별표를 빼면 이런 기능들 1줄이 되니 큰 문제 없을 듯 해").
//
//   → wrap 으로 바꿨다. 이 카나리는 **두 가지를 동시에** 지킨다:
//      ① 들어가면 1줄일 것          (밴드 높이로 판정)
//      ② 어떤 폭에서도 칩이 성할 것  (칩 높이·잘림·가시성으로 판정)
//   ②가 깨지면 ①은 의미가 없다 — 그래서 둘을 한 검사에 묶는다.
const b = require('./lib/browser');

const VPS = [
  { name: '폰320', w: 320, h: 700 },
  { name: '폰390', w: 390, h: 780 },
  { name: '폰430', w: 430, h: 900 },
];
const THREAD = process.env.E2E_BAND_THREAD || '4725';

/** 밴드2(DetailMetaBar) 를 찾아 줄 수·칩 상태를 잰다. */
function probeBand() {
  // ★ 표식으로 집는다. 처음엔 "밑줄 있는 가로 블록" 휴리스틱으로 찾았는데 **메시지 본문 블록**을
  //   집어 밴드 높이 2224px·5줄 같은 헛수치를 냈다(2026-09-07 실측). 위치·모양으로 찾으면
  //   화면이 바뀔 때마다 검사기가 거짓말한다 — CLAUDE.md §17 대로 testid 를 쓴다.
  const band = document.querySelector('[data-testid="detail-meta-bar"]');
  if (!band) return { found: false };
  const br = band.getBoundingClientRect();

  // 줄 수 = 자식 버튼/칩들의 서로 다른 top 밴드 개수
  const kids = Array.from(band.querySelectorAll('button')).filter((e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  const tops = [];
  kids.map((e) => Math.round(e.getBoundingClientRect().top))
    .sort((a, c) => a - c)
    .forEach((t) => { if (!tops.length || t - tops[tops.length - 1] > 8) tops.push(t); });

  // 칩이 성한가 — 세로로 쪼개지면 높이가 글자 여러 줄만큼 커진다.
  //   36px 컨트롤 기준, 60px 을 넘으면 두 줄 이상으로 감긴 것.
  const broken = kids
    .map((e) => ({ t: (e.innerText || '').trim().slice(0, 12), h: Math.round(e.getBoundingClientRect().height), w: Math.round(e.getBoundingClientRect().width) }))
    .filter((k) => k.h > 60);
  // 잘림 — 밴드 밖으로 나간 버튼
  const clipped = kids
    .map((e) => ({ t: (e.innerText || '').trim().slice(0, 12), r: e.getBoundingClientRect() }))
    .filter((k) => k.r.right > br.right + 1 || k.r.left < br.left - 1)
    .map((k) => k.t);
  // 실제로 눌리는가 — 마지막 버튼 중앙에서 그것이 잡히는지
  const last = kids[kids.length - 1];
  let reachable = null;
  if (last) {
    const r = last.getBoundingClientRect();
    const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
    reachable = !!hit && (last === hit || last.contains(hit));
  }
  return {
    found: true, bandH: Math.round(br.height), rows: tops.length, buttons: kids.length,
    broken, clipped, reachable,
    labels: kids.map((e) => (e.innerText || '').trim().slice(0, 10)).join(' · '),
  };
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });
  const { browser, page } = await b.launch({ mobile: true });
  try {
    await b.login(page);
    for (const vp of VPS) {
      await page.setViewport({ width: vp.w, height: vp.h, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      await b.goto(page, `/mail?folder=all&thread=${THREAD}`);
      await b.sleep(3000);
      const p = await page.evaluate(probeBand);
      if (!p.found) { push(`${vp.name}/밴드2`, false, '밴드2를 못 찾았다 — 아래 판정 무의미'); continue; }
      // ② 안전 — 이것이 먼저다
      push(`${vp.name}/칩이 성하다`, p.broken.length === 0 && p.clipped.length === 0,
        p.broken.length || p.clipped.length
          ? `🔴 세로분해 ${JSON.stringify(p.broken)} · 잘림 ${JSON.stringify(p.clipped)}`
          : `버튼 ${p.buttons}개 모두 한 줄 높이 · 밴드 밖 0개`);
      push(`${vp.name}/마지막 버튼이 눌린다`, p.reachable === true, `좌표에서 잡힘=${p.reachable}`);
      // ① 줄 수 — 320px 처럼 정말 좁으면 2줄도 정상. 390 이상에서 1줄을 기대한다.
      const wantRows = vp.w >= 390 ? 1 : 2;
      push(`${vp.name}/줄 수`, p.rows <= wantRows,
        `${p.rows}줄 (기대 ≤${wantRows}) · 밴드 ${p.bandH}px · [${p.labels}]`);
    }
  } finally { await browser.close().catch(() => null); }
  return results;
}

module.exports = { name: 'mailband', run };

if (require.main === module) {
  run().then((rs) => {
    let bad = 0;
    rs.forEach((r) => { if (r.fail) bad++; console.log(`${r.fail ? '❌' : '✅'} ${r.name} — ${r.details[0]}`); });
    console.log(bad ? `\n실패 ${bad}/${rs.length}` : `\n통과 ${rs.length}/${rs.length}`);
    process.exit(bad ? 1 : 0);
  }).catch((e) => { console.error('🔴 하니스 오류:', e.message); process.exit(2); });
}
