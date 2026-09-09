// scripts/e2e/canary-hangul-ime.js — 한글 IME 조합 회귀 검사 (운영 #299 · #389)
//
// 증상: 입력창에 한글을 치면 자모가 분리된다 — "노션이나 슬랙" → "ㄴㅗㅅㅕㄴㅇㅣㄴㅏ ㅅㅡㄹㄹㅐㄱ".
//   8/17 피드백 입력창, 8/26 Q Note 에서 각각 신고돼 한 달 가까이 재발 중이다.
//
// 왜 실브라우저여야 하나 — IME 조합은 keydown/input 이벤트로 흉내낼 수 없다. 조합 중에는
//   DOM value 가 미완성 글자를 들고 있고, 그 사이 React 가 value 를 되쓰면 브라우저가 조합을
//   끊고 자모를 확정해 버린다. 그 순간을 재현하려면 CDP `Input.imeSetComposition` 이 필요하다.
//   정적 검사로는 못 잡는다(실제로 styled-in-render 0건 · onChange 값변형 0건이었다).
//
// ★ 이 검사기는 "몇 개를 검사했는지" 를 함께 출력한다 — 대상 0개인 통과와 진짜 통과가
//   같은 얼굴이면 안 된다(memory feedback_detector_must_report_coverage).
const { launch, login, goto, sleep, BASE } = require('./lib/browser');

// 조합은 **끊지 않고 이어간다.** 실제 IME 는 "한" 을 칠 때 ㅎ → 하 → 한 을 한 조합 안에서
//   갱신하고 마지막에 한 번만 확정한다. 글자마다 insertText 로 확정해 버리면 실패 창(조합이 열려
//   있는 동안 React 가 value 를 되쓰는 순간)이 아예 생기지 않아 **무엇을 해도 통과한다.**
//   ← 첫 판 검사기가 정확히 그래서 거짓 PASS 를 냈다.
const FULL = '한글테스트';
// 각 글자의 조합 중간 상태 (실제 IME 가 보내는 순서 그대로)
const COMPOSE = [
  ['ㅎ', '하', '한'],
  ['ㄱ', '그', '글'],
  ['ㅌ', '테'],
  ['ㅅ', '스', '슽', '스트'],
  ['ㅌ', '트'],
];

async function imeType(page, client, jolt) {
  let committed = '';
  for (const steps of COMPOSE) {
    for (const partial of steps) {
      // 조합 중 — 아직 확정하지 않는다. 이 구간이 실패 창이다.
      await client.send('Input.imeSetComposition', {
        text: partial, selectionStart: partial.length, selectionEnd: partial.length,
      });
      await sleep(45);
      if (jolt) await jolt(page);   // 조합 한복판에서 리렌더를 밀어넣는다
    }
    const last = steps[steps.length - 1];
    await client.send('Input.insertText', { text: last });   // 여기서 한 글자 확정
    committed += last;
    await sleep(45);
  }
  return committed;
}

// 자모가 분리됐는가 — 완성형(가~힣) 대신 호환 자모(ㄱ~ㅣ)가 남았으면 깨진 것.
function isBroken(v) {
  return /[ㄱ-ㆎ]/.test(v || '');
}

// 조합 한복판에 리렌더를 밀어넣는다. 실화면에서 이 역할을 하는 것은 4~5초 폴링·소켓 수신이다.
//   검사기가 그것을 기다리면 느리고 불안정하므로, 앱이 실제로 듣는 이벤트로 같은 일을 일으킨다.
async function jolt(page) {
  await page.evaluate(() => {
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new CustomEvent('inbox:refresh'));
  });
}

// 기계론 확인용 jolt — main.tsx 의 maybeFixPhantomScroll 이 조합 중에 하는 일 그대로.
//   iOS 는 조합 중 visualViewport scroll/resize 가 계속 발생하고, 그때마다 이것이 불린다.
async function joltScroll(page) {
  await page.evaluate(() => { window.scrollTo(0, 0); });
}

async function probe(page, label, url, selector, opener, jolt) {
  if (url) await goto(page, url);
  if (opener) {
    const ok = await opener(page);
    if (!ok) return { label, skipped: '입력창을 열지 못함' };
  }
  // ★ 2026-09-09 — 여기서 검사기가 통째로 죽고 있었다("Node is either not clickable or not
  //   an Element"). `page.$` 는 **화면에 안 그려진 첫 번째 매치**도 그대로 준다(폭 0·display:none·
  //   화면 밖). 그걸 클릭하면 puppeteer 가 던지고, 그 순간 뒤의 probe 도 양성 대조군도 못 돈다.
  //   → 매치 중 **실제로 보이는 것**을 고르고, 화면 안으로 넣은 뒤 좌표로 누른다.
  //   ★ 못 찾으면 던지지 않고 이유를 적어 skipped 로 돌린다. 단 skipped 는 통과가 아니다 —
  //     아래에서 "검사 0개" 를 실패로 판정하는 규칙이 그대로 남아 있다.
  const box = await page.evaluate((sel) => {
    const nodes = Array.from(document.querySelectorAll(sel));
    for (let i = 0; i < nodes.length; i += 1) {
      const n = nodes[i];
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || n.disabled || n.readOnly) continue;
      n.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = n.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      const cx = Math.round(r.left + r.width / 2);
      const cy = Math.round(r.top + r.height / 2);
      const hit = document.elementFromPoint(cx, cy);
      if (!hit || !(hit === n || n.contains(hit) || hit.contains(n))) continue;
      n.setAttribute('data-pq-ime-probe', '1');
      return { idx: i, cx, cy };
    }
    return null;
  }, selector);
  if (!box) return { label, skipped: `보이는 입력창 없음: ${selector}` };
  const probeSel = '[data-pq-ime-probe="1"]';

  const client = await page.target().createCDPSession();
  await page.mouse.click(box.cx, box.cy);   // 합성 click 금지 — mousedown 이 없다
  await sleep(200);
  await imeType(page, client, jolt);
  await sleep(300);
  const value = await page.evaluate((s) => {
    const n = document.querySelector(s);
    return n ? (n.value !== undefined ? n.value : n.textContent) : null;
  }, probeSel);
  await client.detach();
  await page.evaluate((s) => {
    const n = document.querySelector(s);
    if (n) n.removeAttribute('data-pq-ime-probe');
  }, probeSel);

  return { label, value, broken: isBroken(value), ok: value === FULL };
}

async function run() {
  const { browser, page } = await launch();
  const results = [];
  let control = null;
  let scrollProbe = null;
  try {
    await login(page);

    // ① Q Note 상세 — #389 신고 지점(/notes/41). 4~5초 주기 폴링이 도는 화면이다.
    results.push(await probe(page, 'Q Note 메모 입력', '/notes', 'textarea, input[type="text"]', null, jolt));

    // ② 피드백 입력창 — #299 신고 지점. 우측 하단 도구에서 연다.
    results.push(await probe(page, '피드백 내용 입력', '/tasks', 'textarea', async (p) => {
      // Q helper 드로어 열기 → 피드백 탭
      const opened = await p.evaluate(() => {
        window.dispatchEvent(new CustomEvent('planq:open-tool', { detail: { tool: 'feedback' } }));
        return true;
      });
      await sleep(1200);
      return opened && !!(await p.$('textarea'));
    }, jolt));

    // ③ 대조군 — Q Talk 채팅 입력(유일하게 IME 조합을 명시적으로 다루는 화면).
    //    여기가 깨지면 검사기가 아니라 앱 전체 문제, 여기만 멀쩡하면 그 처리가 정답이라는 뜻.
    results.push(await probe(page, 'Q Talk 채팅 입력(음성 대조군)', '/talk', 'textarea', null, jolt));

    // 양성 대조군 — 조합 중 value 를 강제로 되쓰는 입력창을 심는다(고장난 React 입력의 재현).
    await page.evaluate(() => {
      const ta = document.createElement('textarea');
      ta.id = 'pq-ime-control';
      Object.assign(ta.style, { position: 'fixed', left: '0', bottom: '0', zIndex: '99999', width: '200px' });
      document.body.appendChild(ta);
      // React 의 "리렌더가 stale value 를 되쓴다" 를 그대로 흉내낸다.
      let last = '';
      ta.addEventListener('input', () => { const v = ta.value; ta.value = last; ta.value = v; last = v; });
    });
    control = await probe(page, '양성 대조군(일부러 깨뜨린 입력)', null, '#pq-ime-control', null, jolt);

    // 기계론 검사 — 조합 중 window.scrollTo 가 조합을 끊는가? (같은 대조 입력창, jolt 만 교체)
    await page.evaluate(() => { const n = document.getElementById('pq-ime-control'); if (n) n.value = ''; });
    scrollProbe = await probe(page, '조합 중 scrollTo (main.tsx 재현)', null, '#pq-ime-control', null, joltScroll);
  } finally {
    await browser.close();
  }

  // ★ 양성 대조군 — **검사기가 깨진 것을 잡을 수 있는지 먼저 증명한다.**
  //   조합 중 value 를 되쓰는 입력창을 즉석에서 만들어 넣는다. 여기서 '깨짐' 이 안 나오면
  //   위의 PASS 들은 "안 깨졌다" 가 아니라 "검사기가 아무것도 못 본다" 는 뜻이다.
  // ★ 2026-09-09 — run.js 는 **배열**을 기대한다(`printSuite` 가 r.name/r.fail/r.details 를 읽는다).
  //   여태 이 카나리만 `{name, pass, detail}` 을 돌려줘서, 등록해 두었더라도 러너에서 깨졌을 것이다.
  //   (그래서였는지 애초에 run.js 에 등록조차 안 돼 있었다 — 한 번도 안 돈 가드였다.)
  const out = [];
  const push = (name, ok, details) => out.push({ name, fail: ok ? 0 : 1, details: [details] });

  if (!control || !control.broken) {
    console.log('  ⚠ 양성 대조군이 안 깨졌다 — 검사기를 믿을 수 없다.');
    push('양성 대조군이 깨짐을 잡는다', false, '검사기 반증 실패 — 아래 PASS 는 믿을 수 없다');
    return out;
  }
  push('양성 대조군이 깨짐을 잡는다(검사기 유효)', true, `일부러 깨뜨린 입력 → "${control.value}"`);

  const tested = results.filter(r => !r.skipped);
  const broken = tested.filter(r => r.broken);
  console.log(`\n한글 IME 조합 — 검사 ${tested.length}개 / 건너뜀 ${results.length - tested.length}개`);
  console.log(`  ✓ 양성 대조군 깨짐 확인 — 검사기 유효 (실제 "${control.value}")`);
  if (scrollProbe) console.log(`  · 기계론: 조합 중 scrollTo → "${scrollProbe.value}" ${scrollProbe.broken ? '(조합 끊김 재현)' : '(이 브라우저에선 안 끊김)'}`);
  for (const r of results) {
    if (r.skipped) { console.log(`  ⃘ ${r.label} — 건너뜀 (${r.skipped})`); continue; }
    const mark = r.ok ? '✓' : (r.broken ? '✗ 자모분리' : '△ 불일치');
    console.log(`  ${mark} ${r.label} — 기대 "${FULL}" / 실제 "${r.value}"`);
  }
  // 검사 0개는 통과가 아니다 — "아무것도 못 봤다" 와 "멀쩡하다" 를 구분한다.
  push('검사한 입력창이 1개 이상', tested.length > 0, `검사 ${tested.length}개 · 건너뜀 ${results.length - tested.length}개`);
  for (const r of results) {
    if (r.skipped) continue;   // 건너뜀은 위 커버리지 항목이 대변한다
    push(`자모가 분리되지 않는다 — ${r.label}`, !r.broken, `기대 "${FULL}" / 실제 "${r.value}"`);
  }
  return out;
}

module.exports = { name: '한글 IME 조합', run };

if (require.main === module) {
  run().then((rs) => {
    console.log('');
    rs.forEach((x) => console.log((x.fail ? '❌' : '✅'), x.name, '—', (x.details || []).join(' ')));
    process.exit(rs.some((x) => x.fail || x.fatal) ? 1 : 0);
  }).catch(e => { console.error('검사기 자체 오류:', e.message); process.exit(2); });
}
