#!/usr/bin/env node
// canary-docs-header — 앱 페이지 껍데기가 **탭 스크롤 슬롯을 넘지 않는가**, 그래서
//   좌측 머리줄과 우측 두 밴드가 스크롤에도 **제자리인가**. 3폭.
//
// 운영 신고 (Irene 2026-09-15): "문서 메뉴에서 상단이 스크롤 따라 자꾸 들어가. 서브헤더는
//   고정이어야 하잖아. Q docs / AI 템플릿 이 부분이랑 우측 문서 제목 부분."
//
// ★ 왜 기존 `--suite sticky` 가 이것을 못 잡았나 (이 파일이 따로 있는 이유)
//   그 검사기는 **computed position 이 sticky 인 요소만** 훑는다. 그런데 이 결함에서는
//   ①좌측 머리줄은 애초에 sticky 가 아니고(패널 안에 있으니 그럴 필요가 없다)
//   ②우측 밴드는 데스크탑에서 `position:static` 이다(sticky 선언이 max-width:900px 뒤에 있다).
//   → 훑을 대상이 **0건**이라 검사기는 아무 말도 안 하고 초록이었다. 없는 검사였다
//     (memory feedback_unwired_guard_is_no_guard · feedback_empty_fixture_false_verdict).
//   그리고 `/docs` 를 **상세를 안 연 채**로만 봐서 밴드가 DOM 에 있지도 않았다.
//
// ★ 그래서 여기서는 sticky 를 보지 않고 **결과**를 본다 — 스크롤한 뒤 머리줄·밴드의 y 가
//   그대로인가. 선언이 무엇이든 사용자가 겪는 것은 이 y 하나다.
//
// ★ 짧은 문서로 재면 거짓 통과한다 (CLAUDE.md 박제) — 본문이 짧으면 패널이 스크롤되지 않아
//   "안 움직였다" 가 나온다. 그래서 **긴 문서 픽스처를 이 카나리가 직접 만들고 지운다.**
// * page.evaluate 에 «문자열 소스»를 첫 인자로 넘기면 뒤의 인자가 전달되지 않는다
//   (표현식으로 평가될 뿐 함수로 호출되지 않는다). 첫 실행에서 측정값이 전부 undefined 로
//   나왔고 판정은 «거짓 FAIL 10건»이었다. 그래서 소스를 자료로 넘기고 안에서 eval 한다.
//   (memory feedback_false_fail_suspect_the_judge)
const b = require('./lib/browser');

const VPS = [
  { key: '폰',       w: 390,  h: 844 },
  { key: '태블릿',   w: 834,  h: 1112 },
  { key: '데스크탑', w: 1440, h: 900 },
];
const API = process.env.DOCSHDR_API || 'http://127.0.0.1:3003/api';
const SCROLL = 500;

const results = [];
const P = (name, pass, detail) => results.push({ name, fail: !pass, details: detail ? [detail] : [] });

/** 스크롤 주인을 찾아 굴리고, 기준 요소의 y 변화를 돌려준다 */
const SCROLL_AND_MEASURE = `(sel, px) => {
  const el = document.querySelector(sel);
  if (!el) return { err: 'not found: ' + sel };
  const before = Math.round(el.getBoundingClientRect().top);
  // 스크롤 주인 — el 자신부터 위로, 실제로 넘치는 첫 컨테이너. 없으면 문서.
  let n = el, owner = null;
  while (n && n !== document.documentElement) {
    const s = getComputedStyle(n);
    if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 8) { owner = n; break; }
    n = n.parentElement;
  }
  const de = document.scrollingElement;
  const tgt = owner || de;
  const prev = tgt.scrollTop;
  tgt.scrollTop = prev + px;
  void tgt.offsetHeight;
  const moved = tgt.scrollTop - prev;
  const after = Math.round(el.getBoundingClientRect().top);
  tgt.scrollTop = prev;
  return {
    before, after, moved, drift: Math.abs(after - before),
    ownerIsDoc: !owner,
    ownerCls: owner ? String(owner.className || '').slice(0, 24) : '(문서)',
  };
}`;

/** 껍데기가 슬롯을 넘는가 — 넘침의 근원을 그대로 보고한다 */
const SLOT_OVERFLOW = `() => {
  const nb = document.querySelector('[data-testid="docs-new"]');
  if (!nb) return { err: 'docs-new 없음' };
  // Q docs Layout = grid + overflow:hidden. 그 부모가 FullHeight(앱 페이지 껍데기).
  let lay = nb;
  while (lay && !(getComputedStyle(lay).display === 'grid' && getComputedStyle(lay).overflow === 'hidden')) lay = lay.parentElement;
  if (!lay) return { err: 'Q docs Layout 을 못 찾음' };
  const shell = lay.parentElement;
  // 껍데기를 담는 스크롤 슬롯
  let n = shell.parentElement, slot = null;
  while (n && n !== document.documentElement) {
    const s = getComputedStyle(n);
    if (/(auto|scroll)/.test(s.overflowY)) { slot = n; break; }
    n = n.parentElement;
  }
  if (!slot) return { err: '탭 스크롤 슬롯을 못 찾음' };
  return {
    shellH: Math.round(shell.getBoundingClientRect().height),
    slotH: slot.clientHeight,
    over: Math.round(shell.getBoundingClientRect().height) - slot.clientHeight,
    vh: window.innerHeight,
  };
}`;

async function api(path, opts = {}) {
  const r = await fetch(API + path, opts);
  try { return JSON.parse(await r.text()); } catch { return {}; }
}

async function run() {
  // ── 긴 문서 픽스처를 만든다 (짧은 문서로는 이 계열이 재현되지 않는다)
  let token = null, bizId = null, postId = null;
  try {
    const lj = await api('/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: b.CREDS.email, password: b.CREDS.password }),
    });
    token = lj?.data?.token || lj?.data?.accessToken || lj?.data?.access_token;
    const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const bz = await api('/businesses', { headers: H });
    bizId = (bz?.data || [])[0]?.id;
    // * content_json 은 **TipTap ProseMirror JSON** 이어야 한다. {type:'doc',html:'...'} 처럼
    //   넣으면 generateHTML 이 빈 문자열을 내고 본문이 **비어서 스크롤이 안 난다** — 그러면
    //   이 카나리의 3번이 "스크롤 여지 없음" 으로 떨어져 결함이 아니라 픽스처를 신고하게 된다.
    const paras = [];
    for (let i = 1; i <= 80; i++) {
      paras.push({ type: 'paragraph', content: [{ type: 'text',
        text: i + '. 스크롤 고정 검증용 긴 본문 문단. 짧은 문서로 재면 패널이 스크롤되지 않아 거짓 통과가 난다.' }] });
    }
    const cr = await api('/posts', {
      method: 'POST', headers: H,
      body: JSON.stringify({
        business_id: bizId, title: '[카나리] 헤더 고정 검증 긴 문서',
        content_json: { type: 'doc', content: paras }, kind: 'doc',
        status: 'published', visibility: 'public', category: 'general',
      }),
    });
    postId = cr?.data?.id || null;
  } catch (e) { /* 아래에서 0건으로 실패 처리 */ }

  if (!postId) {
    P('긴 문서 픽스처를 만들었다 (0건 = 판정 불가)', false,
      '문서를 못 만들어 우측 밴드를 한 폭도 재지 못했다 — 통과로 세지 않는다');
    return { name: 'docsheader', results };
  }

  const { browser, page } = await b.launch({});
  try {
    await b.login(page);
    for (const vp of VPS) {
      await page.setViewport({ width: vp.w, height: vp.h });

      // ── ① 껍데기가 탭 슬롯을 넘지 않는다 (이 결함의 근원)
      await b.goto(page, '/docs');
      await b.sleep(1500); await b.dismissBlockers(page).catch(() => {});
      await page.waitForSelector('[data-testid="posts-ready"]', { timeout: 20000 }).catch(() => {});
      await b.sleep(400);
      const slot = await page.evaluate((src) => eval(src)(), SLOT_OVERFLOW);
      if (slot.err) {
        P(`[${vp.key}] ① 껍데기 높이를 잴 수 있다`, false, slot.err);
      } else {
        P(`[${vp.key}] ① Q docs 껍데기가 탭 슬롯을 넘지 않는다`, slot.over <= 1,
          `껍데기 ${slot.shellH} vs 슬롯 ${slot.slotH} (넘침 ${slot.over}px · vh ${slot.vh})`);
      }

      // ── ② 좌측 머리줄(AI·템플릿·+)이 목록을 굴려도 제자리
      // * 머리줄의 **조상**을 굴리면 안 된다 — 목록은 머리줄의 형제다(패널이 flex column).
      //   조상만 훑으면 스크롤 주인을 못 찾아 "여지 없음" 으로 떨어지고 이 축이 통째로 미측정된다.
      // * 시그니처를 (src, px) 로 두고 인자를 하나만 넘겨 px 가 undefined 였다
      //   → scrollTop = NaN 으로 항상 0 굴림 = 영영 미측정. 인자 수를 맞춘다.
      const left = await page.evaluate((px) => {
        const hdrBtn = document.querySelector('[data-testid="docs-new"]');
        if (!hdrBtn) return { err: 'docs-new 없음' };
        let panel = hdrBtn;
        while (panel && panel.tagName.toLowerCase() !== 'aside') panel = panel.parentElement;
        if (!panel) return { err: '좌측 패널(aside) 을 못 찾음' };
        // * 문서 순서 첫 번째를 집으면 안 된다 — 패널 안에는 넘침 25px 짜리 분류 띠가 먼저 온다.
        //   그것을 굴려봐야 머리줄은 원래 안 움직이므로 **거짓 통과**가 된다. 넘침이 가장 큰 것을 고른다.
        const list = [...panel.querySelectorAll('*')]
          .filter((n) => {
            const st = getComputedStyle(n);
            return /(auto|scroll)/.test(st.overflowY) && n.scrollHeight > n.clientHeight + 8;
          })
          .sort((a, z) => (z.scrollHeight - z.clientHeight) - (a.scrollHeight - a.clientHeight))[0];
        if (!list) return { err: '목록이 넘치지 않는다 (문서 수 부족 — 미측정)', noRoom: true };
        const before = Math.round(hdrBtn.getBoundingClientRect().top);
        const prev = list.scrollTop;
        list.scrollTop = prev + px;
        void list.offsetHeight;
        const moved = list.scrollTop - prev;
        const after = Math.round(hdrBtn.getBoundingClientRect().top);
        list.scrollTop = prev;
        return { before, after, moved, drift: Math.abs(after - before),
                 ownerCls: String(list.className || '').slice(0, 24), ownerIsDoc: false };
      }, SCROLL);
      if (left.err && !left.noRoom) P(`[${vp.key}] ② 좌측 머리줄을 찾았다`, false, left.err);
      else if (left.noRoom || left.moved < 40) P(`[${vp.key}] ② 좌측 머리줄 — 스크롤 여지`, true,
        `${left.err || '굴림 ' + left.moved + 'px'} — 미측정(커버리지에 적는다)`);
      else P(`[${vp.key}] ② 좌측 머리줄이 스크롤에도 제자리`, left.drift <= 2,
        `y ${left.before} → ${left.after} (${left.moved}px 굴림 @ ${left.ownerCls}${left.ownerIsDoc ? ' ★문서스크롤' : ''})`);

      // ── ③ 우측 두 밴드(제목·메타)가 본문을 굴려도 제자리
      await b.goto(page, `/docs?post=${postId}`);
      await b.sleep(1800); await b.dismissBlockers(page).catch(() => {});
      // * 밴드도 마찬가지 — 본문(Body)은 밴드의 **형제**다(상세가 flex column).
      //   조상만 훑으면 데스크탑에서 스크롤 주인을 못 찾는다(실측: 폰·태블릿은 조상이 굴러서
      //   우연히 재졌고 데스크탑만 "여지 없음" 이었다 — 축을 좁히면 F=1 이 거짓말이 된다).
      const bands = await page.evaluate((px) => {
        const el = document.querySelector('[data-testid="docs-detail-bands"]');
        if (!el) return { err: 'docs-detail-bands 없음' };
        // 상세 구획 = 밴드를 품은 가장 가까운 section. 그 안에서 넘치는 컨테이너를 찾는다.
        let sec = el;
        while (sec && sec.tagName.toLowerCase() !== 'section' && sec !== document.body) sec = sec.parentElement;
        const scope = (sec && sec !== document.body) ? sec : document.body;
        const cands = [...scope.querySelectorAll('*')].filter((n) => {
          const st = getComputedStyle(n);
          return /(auto|scroll)/.test(st.overflowY) && n.scrollHeight > n.clientHeight + 8 && !n.contains(el);
        });
        // 조상 중 굴러가는 것도 후보에 넣는다(좁은 폭에서는 바깥이 구른다 — 그때 sticky 가 일한다)
        let a = el.parentElement;
        while (a && a !== document.documentElement) {
          const st = getComputedStyle(a);
          if (/(auto|scroll)/.test(st.overflowY) && a.scrollHeight > a.clientHeight + 8) { cands.push(a); break; }
          a = a.parentElement;
        }
        if (!cands.length) return { err: '상세에 굴러가는 컨테이너가 없다 (본문이 짧다 = 픽스처 실패)' };
        // 여기서도 **넘침이 가장 큰 것** — 첫 번째는 툴바·분류 띠 같은 잔챙이일 수 있다
        cands.sort((a, z) => (z.scrollHeight - z.clientHeight) - (a.scrollHeight - a.clientHeight));
        const tgt = cands[0];
        const before = Math.round(el.getBoundingClientRect().top);
        const prev = tgt.scrollTop;
        tgt.scrollTop = prev + px;
        void tgt.offsetHeight;
        const moved = tgt.scrollTop - prev;
        const after = Math.round(el.getBoundingClientRect().top);
        tgt.scrollTop = prev;
        return { before, after, moved, drift: Math.abs(after - before),
                 ownerCls: String(tgt.className || '').slice(0, 24), ownerIsDoc: false };
      }, SCROLL);
      if (bands.err) P(`[${vp.key}] ③ 우측 밴드를 찾았다`, false, bands.err);
      else if (bands.moved < 40) P(`[${vp.key}] ③ 우측 밴드 — 스크롤 여지`, false,
        `스크롤 여지 없음(${bands.moved}px) — 긴 문서인데 안 굴렀다면 픽스처가 안 열린 것이다`);
      else P(`[${vp.key}] ③ 우측 두 밴드가 스크롤에도 제자리`, bands.drift <= 2,
        `y ${bands.before} → ${bands.after} (${bands.moved}px 굴림 @ ${bands.ownerCls}${bands.ownerIsDoc ? ' ★문서스크롤' : ''})`);
    }

    // ── ④ 양성 대조군 — 결함(100vh 껍데기)을 되살리면 판정이 **뒤집히는가**
    //   이게 없으면 위 초록은 "빨간불을 끈 것" 과 구별되지 않는다
    //   (memory feedback_guard_must_be_falsified · feedback_positive_control_can_be_wrong).
    await page.setViewport({ width: 1440, height: 900 });
    await b.goto(page, `/docs?post=${postId}`);
    await b.sleep(1600); await b.dismissBlockers(page).catch(() => {});
    const revived = await page.evaluate(() => {
      const bands = document.querySelector('[data-testid="docs-detail-bands"]');
      if (!bands) return false;
      let lay = bands;
      while (lay && !(getComputedStyle(lay).display === 'grid' && getComputedStyle(lay).overflow === 'hidden')) lay = lay.parentElement;
      if (!lay || !lay.parentElement) return false;
      lay.parentElement.style.height = '100vh';   // 옛 값을 그대로 되살린다
      return true;
    });
    if (!revived) {
      P('④ 양성 대조군 — 결함을 되살릴 수 있다', false, '껍데기를 못 찾아 대조군을 못 세웠다');
    } else {
      await b.sleep(300);
      const ctl = await page.evaluate((src, sel, px) => eval(src)(sel, px), SCROLL_AND_MEASURE, '[data-testid="docs-detail-bands"]', SCROLL);
      P('④ 양성 대조군 — 100vh 를 되살리면 밴드가 **올라간다**', !ctl.err && ctl.moved >= 40 && ctl.drift > 2,
        ctl.err ? ctl.err : `y ${ctl.before} → ${ctl.after} (드리프트 ${ctl.drift}px · ${ctl.moved}px 굴림)`);

      // ④-B 좌측 머리줄 축도 따로 뒤집어 본다 — ④ 는 밴드만 증명한다. 축마다 대조군이 있어야
      //   "그 축의 초록" 이 살아 있는 검사인지 알 수 있다(memory feedback_detector_must_report_coverage).
      await b.goto(page, '/docs');
      await b.sleep(1500); await b.dismissBlockers(page).catch(() => {});
      const revivedL = await page.evaluate(() => {
        const nb = document.querySelector('[data-testid="docs-new"]');
        if (!nb) return false;
        let lay = nb;
        while (lay && !(getComputedStyle(lay).display === 'grid' && getComputedStyle(lay).overflow === 'hidden')) lay = lay.parentElement;
        if (!lay || !lay.parentElement) return false;
        lay.parentElement.style.height = '100vh';
        return true;
      });
      if (!revivedL) {
        P('④-B 양성 대조군(좌측) — 결함을 되살릴 수 있다', false, '껍데기를 못 찾았다');
      } else {
        await b.sleep(300);
        const ctlL = await page.evaluate((px) => {
          const nb = document.querySelector('[data-testid="docs-new"]');
          if (!nb) return { err: 'docs-new 없음' };
          // 결함 상태에서는 **바깥**이 구른다 — 그래서 조상 쪽을 굴려 머리줄이 딸려 가는지 본다
          let n = nb, owner = null;
          while (n && n !== document.documentElement) {
            const st = getComputedStyle(n);
            if (/(auto|scroll)/.test(st.overflowY) && n.scrollHeight > n.clientHeight + 8) { owner = n; break; }
            n = n.parentElement;
          }
          if (!owner) return { err: '바깥이 안 구른다 (대조군이 안 세워졌다)' };
          const before = Math.round(nb.getBoundingClientRect().top);
          const prev = owner.scrollTop;
          owner.scrollTop = prev + px;
          void owner.offsetHeight;
          const moved = owner.scrollTop - prev;
          const after = Math.round(nb.getBoundingClientRect().top);
          owner.scrollTop = prev;
          return { before, after, moved, drift: Math.abs(after - before) };
        }, SCROLL);
        P('④-B 양성 대조군 — 100vh 를 되살리면 **좌측 머리줄도 올라간다**',
          !ctlL.err && ctlL.moved >= 40 && ctlL.drift > 2,
          ctlL.err ? ctlL.err : `y ${ctlL.before} → ${ctlL.after} (드리프트 ${ctlL.drift}px · ${ctlL.moved}px 굴림)`);
      }
    }

    P('커버리지 — 무엇을 쟀는가', true,
      `${VPS.length}폭 × (껍데기 넘침 · 좌측 머리줄 · 우측 두 밴드) + 양성 대조군 2(밴드·머리줄) · 픽스처 post=${postId}`);
  } finally {
    await browser.close();
    // ── 픽스처를 지운다. 남기면 다음 검사가 이 문서를 보고 판정이 달라진다
    //   (memory feedback_canary_pollutes_next_suite).
    //   * 앱의 DELETE 는 **소프트 삭제(휴지통)** 다 — hard 옵션이 없다. 목록에서는 사라지므로
    //     다음 검사에는 영향이 없고, 행은 purge_after 로 자동 정리된다. 'hard=1' 같은
    //     없는 인자를 붙여 "완전히 지웠다" 고 적지 않는다(확인 안 한 동작을 쓰지 않는다).
    if (postId && token) {
      await api(`/posts/${postId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    }
  }
  return { name: 'docsheader', results };
}

module.exports = { name: 'docsheader', run: async () => (await run()).results };

if (require.main === module) {
  run().then((r) => {
    let fails = 0;
    for (const x of r.results) { if (x.fail) fails++; console.log(`${x.fail ? '✗' : '✓'} ${x.name}${x.details.length ? ' — ' + x.details.join(' / ') : ''}`); }
    console.log(fails ? `\n✗ 실패 ${fails}/${r.results.length}` : `\n✓ 전부 통과 (${r.results.length})`);
    process.exit(fails ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e); process.exit(1); });
}
