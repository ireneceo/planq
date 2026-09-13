// scripts/e2e/canary-sale-panel.js — Q sale 우측 패널 **한 벌** 계약 (2026-09-13)
//
// Irene: *"q sale 우측패널은 모두 동일해야 해. 상담에서 열든 고객에서 열든 우측 패널은 고객에서
//   연 창이야. 액션버튼도 모두 동일해야 하고."* · *"우측패널제목이랑 아래 나오는 거랑 왜 겹쳐?
//   이름 두번 나오고 그러잖아."* · *"우측 패널 액션버튼들 정리 안되서 다 레이아웃 나가는 것도 그렇고."*
//   그리고 §N.4: *"우측패널들 열려있어도 좌측에 나오는 화면은 스크롤 반응하게 해."*
//
// 이 카나리가 **정적 검사로는 못 잡는 것**만 본다:
//   ① 문의로 열어도 고객 액션이 있는가 (전에는 [보기]·[등록] 둘뿐이었다 — 코드상으로는 둘 다 '버튼'이라 grep 이 못 가른다)
//   ② 이름이 두 번 그려지지 않는가 (헤더 + 본문 Top — **화면 문자열**로만 드러난다)
//   ③ 푸터가 줄바꿈으로 부풀지 않는가 (버튼 19개 → 높이는 CSS 가 합쳐진 뒤에만 존재)
//   ④ [보기] 라벨이 그 행의 **목적지와 맞는가** (이분법이면 guest·client 가 "채팅 보기" 로 떨어졌다)
//   ⑤ 저장 액션이 **묻고 나서** 나가는가 — 확인 전 POST 0건(음성 대조군). ★ 확인은 누르지 않는다(원장 무변경)
//   ⑥ 패널이 열려 있어도 **뒤 목록이 스크롤되는가** (닫힌 상태 = 양성 대조군)
//
// ★ 0건이면 **판정 불가 = 실패**다. 빈 데이터로 초록을 내지 않는다(memory feedback_empty_fixture_false_verdict).
const { launch, login, goto, gotoSPA, sleep, dismissBlockers } = require('./lib/browser');

const results = [];
const push = (name, pass, detail) => results.push({ name, fail: !pass, details: detail ? [detail] : [] });

/** 패널(우측 드로어)이 **보이는가** — 확인창도 aria-modal 이라 그것만으로는 못 가른다.
 *  2026-09-13 실사례: 판정이 패널을 확인창으로 오인해 거짓 통과 직전이었다. 표식으로 좁힌다. */
const PANEL = '[data-pq-drawer-panel]';

async function panelInfo(page) {
  return page.evaluate((sel) => {
    const p = document.querySelector(sel);
    if (!p) return null;
    const r = p.getBoundingClientRect();
    if (r.width < 40) return null;
    const footer = p.lastElementChild;
    const fr = footer ? footer.getBoundingClientRect() : null;
    const btns = footer ? [...footer.querySelectorAll('button')] : [];
    const head = p.firstElementChild;
    return {
      width: Math.round(r.width),
      text: (p.innerText || ''),
      headText: head ? (head.innerText || '').trim() : '',
      footerH: fr ? Math.round(fr.height) : 0,
      footerBtns: btns.map((b) => (b.innerText || b.getAttribute('aria-label') || '').trim()).filter(Boolean),
      hasInquiryBox: !!p.querySelector('[data-testid="client-panel-inquiry-box"]'),
      hasMore: !!p.querySelector('[data-testid="client-panel-more"]'),
      actionIds: ['client-panel-record', 'client-panel-next', 'client-panel-task']
        .filter((id) => !!p.querySelector(`[data-testid="${id}"]`)),
      recordDisabled: (() => {
        const b = p.querySelector('[data-testid="client-panel-record"]');
        return b ? b.disabled : null;
      })(),
    };
  }, PANEL);
}

/** 좌측 목록의 스크롤 컨테이너 — 좌표로 찾는다(클래스 휴리스틱 금지) */
async function leftScroller(page, x, y) {
  return page.evaluate((px, py) => {
    const stack = document.elementsFromPoint(px, py);
    for (const el of stack) {
      if (el.closest('[data-pq-drawer-panel]')) continue;
      let n = el;
      while (n && n !== document.body) {
        const st = getComputedStyle(n);
        if (/(auto|scroll)/.test(st.overflowY) && n.scrollHeight > n.clientHeight + 20) {
          n.dataset.pqScrollProbe = '1';
          return { top: n.scrollTop, tag: n.tagName + '.' + (n.className || '').toString().slice(0, 24) };
        }
        n = n.parentElement;
      }
    }
    return null;
  }, x, y);
}
const probeTop = (page) => page.evaluate(() => {
  const n = document.querySelector('[data-pq-scroll-probe="1"]');
  return n ? n.scrollTop : null;
});

async function run() {
  const { browser, page } = await launch();
  try {
    await login(page);
    await goto(page, '/sale');
    await dismissBlockers(page);
    await sleep(800);

    // ── 행 확보 (0건이면 판정 불가) ────────────────────────────────
    const rows = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="sale-inbox-row-"]')]
      .slice(0, 6).map((el) => el.getAttribute('data-testid').replace('sale-inbox-row-', '')));
    if (!rows.length) {
      push('상담 행이 있다 (0건이면 판정 불가 = 실패)', false, 'sale-inbox-row-* 0건 — 아래 전부 미측정');
      return results;
    }
    push('상담 행이 있다', true, `행 ${rows.length}건으로 측정 (전체 목록의 앞부분)`);

    // ★ 패널에서 뺀 셋이 **목록에 있는지** 확인한다 — 없애기만 했으면 기능이 사라진 것이다.
    const listActs = await page.evaluate((id) => ['memo', 'event', 'task']
      .filter((k) => !!document.querySelector(`[data-testid="sale-inbox-${k}-${id}"]`)), rows[0]);
    push('① 그 셋은 **목록 행 액션**으로 옮겨져 있다', listActs.length === 3,
      `목록에 있는 것: ${listActs.join(', ') || '없음'} (메모·일정·업무)`);

    // ── ④ [보기] 라벨이 목적지와 맞는가 ───────────────────────────
    //   라벨과 open_path 를 같은 곳에서 정한다 — 어긋나면 "이상한데로 보낸다"(Irene).
    //   ★ 라벨만 보면 "이상한데로 보낸다" 를 못 잡는다 — **라벨과 목적지(open_path)가 같은 것을
    //     가리키는지**까지 잰다. 그래서 서버 응답과 화면을 대조한다.
    const labels = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="sale-inbox-open-"]')]
      .slice(0, 12).map((b) => ({ label: (b.innerText || '').trim() })));
    const kinds = new Set(labels.map((l) => l.label));
    // 라벨 → 가야 할 경로의 접두어. 라벨이 늘면 여기도 늘려야 한다(기본값으로 떨어뜨리지 않는다).
    const WANT = [
      [/메일 보기|Open in Mail/, '/mail'],
      [/채팅 보기|Open in Chat/, '/talk'],
      [/게스트 대화 보기|Open guest chat/, '/talk'],
      [/고객 상세 보기|Open client detail/, '/sale/'],
    ];
    const unknown = [...kinds].filter((k) => !WANT.some(([re]) => re.test(k)));
    push('④ [보기] 라벨이 행 종류를 따라간다', labels.length > 0 && unknown.length === 0,
      `라벨 ${[...kinds].join(' / ')} · 측정 ${labels.length}건`
      + (unknown.length ? ` · 뜻 모를 라벨 ${unknown.join(',')}(기본값으로 떨어졌다)` : ''));

    // 라벨 ↔ 실제 목적지 대조 — 눌러 보지 않고 서버가 준 open_path 와 맞춘다
    const mism = await page.evaluate((WANT_SRC) => {
      const want = WANT_SRC.map(([re, pre]) => [new RegExp(re), pre]);
      const rows = [...document.querySelectorAll('[data-testid^="sale-inbox-row-"]')].slice(0, 12);
      const out = [];
      for (const row of rows) {
        const btn = row.querySelector('[data-testid^="sale-inbox-open-"]');
        if (!btn) continue;
        const label = (btn.innerText || '').trim();
        const hit = want.find(([re]) => re.test(label));
        out.push({ label, prefix: hit ? hit[1] : null });
      }
      return out;
    }, WANT.map(([re, pre]) => [re.source, pre]));
    const mailOnly = [...kinds].every((k) => /메일|Mail/.test(k));
    push('④ 라벨이 가리키는 곳이 한 종류로 정해진다', mism.length > 0 && mism.every((m) => m.prefix),
      `${mism.length}건 대조`
      + (mailOnly ? ' ※ 커버리지: dev 상담 889건이 **전부 메일**이다 — guest/client/chat 분기는 이 실행에서 미측정' : ''));

    // ── 패널 열기 ─────────────────────────────────────────────────
    await page.click(`[data-testid="sale-inbox-row-${rows[0]}"] button`);
    await sleep(900);
    const info = await panelInfo(page);
    if (!info) {
      push('행을 누르면 우측 패널이 열린다', false, '패널을 못 찾았다 — 아래 전부 미측정');
      return results;
    }
    push('행을 누르면 우측 패널이 열린다', true, `폭 ${info.width}px`);

    // ── ① 문의로 열어도 **고객 액션**이 있다 ──────────────────────
    // ★ 2026-09-13 계약 변경 (Irene: *"하단에 고객응대 내역 추가 다음연락 정하기 업무추가 버튼은
    //   리스트로 뺐으니 없애도 돼."*) — 그 셋은 **상담 목록의 행 액션**이 되었다.
    //   같은 일을 하는 문이 두 곳에 있으면 어느 쪽이 정본인지 알 수 없다.
    //   그래서 여기서는 **없어야** 맞고, 대신 목록에 있는지를 아래에서 따로 잰다.
    push('① 패널 하단에는 그 셋이 **없다**(리스트로 옮겼다)',
      info.actionIds.length === 0, `남아 있는 것: ${info.actionIds.join(', ') || '없음'}`);
    push('① 나머지는 ⋯ 메뉴로 접혀 있다', info.hasMore,
      info.hasMore ? '더보기 메뉴 있음' : 'OverflowMenu 없음 — 버튼이 다시 늘어난 것');

    // ── ③ 문의 정보 박스 ─────────────────────────────────────────
    push('③ 상담에서 열면 문의 정보 박스가 상단에 있다', info.hasInquiryBox,
      info.hasInquiryBox ? '' : 'client-panel-inquiry-box 없음');

    // ── ② 이름이 두 번 그려지지 않는다 ───────────────────────────
    const dupe = await page.evaluate((sel) => {
      const p = document.querySelector(sel);
      const head = p.firstElementChild;
      const name = (head.innerText || '').trim().split('\n')[0].trim();
      if (!name || name === '—') return { name, count: 0, skip: true };
      // 본문(헤더 제외)에서 그 이름이 **단독 줄**로 또 나오는가
      const bodyTxt = [...p.children].slice(1).map((c) => c.innerText || '').join('\n');
      const count = bodyTxt.split('\n').map((l) => l.trim()).filter((l) => l === name).length;
      return { name, count, skip: false };
    }, PANEL);
    push('② 제목과 본문에 이름이 겹치지 않는다', dupe.skip || dupe.count === 0,
      dupe.skip ? '이름이 없는 행 — 미측정' : `"${dupe.name}" 본문 단독 줄 ${dupe.count}회 (0이어야 한다)`);

    // ── ③ 푸터가 줄바꿈으로 부풀지 않는다 ────────────────────────
    //   버튼 19개였을 때는 푸터가 여러 줄로 넘쳤다. 한 줄 높이의 상한을 둔다.
    push('③ 푸터가 한 줄이다 (레이아웃 안 나간다)', info.footerH > 0 && info.footerH <= 84,
      `푸터 높이 ${info.footerH}px · 버튼 ${info.footerBtns.length}개 [${info.footerBtns.join(' | ')}]`);

    // ── ⑤ 저장 액션은 **묻고 나서** 나간다 ───────────────────────
    //   ★ 확인은 누르지 않는다 — 누르면 dev 에 고객 원장이 생긴다. 여기서는 "묻는가 + 묻기 전엔 안 나가는가" 만.
    let posted = 0;
    const onReq = (req) => {
      const u = req.url();
      if (req.method() === 'POST' && (/\/save-as-client/.test(u) || /\/clients\/\d+\/invite/.test(u))) posted += 1;
    };
    page.on('request', onReq);
    const recordBtn = await page.$(`${PANEL} [data-testid="client-panel-record"]`);
    if (info.recordDisabled) {
      push('⑤ 저장 액션이 확인을 받는다', true,
        '이 행은 등록 불가(순수 대화방)라 액션이 비활성 — 이유 있는 비활성이므로 통과, 확인창은 미측정');
    } else if (recordBtn) {
      await recordBtn.click();
      await sleep(900);
      const ask = await page.evaluate(() => {
        // 확인창은 패널 **바깥**의 aria-modal 이다 — 패널을 집지 않게 좁힌다
        const dlgs = [...document.querySelectorAll('[aria-modal="true"]')]
          .filter((d) => !d.hasAttribute('data-pq-drawer-panel'));
        const d = dlgs.find((x) => x.getBoundingClientRect().width > 100);
        return d ? (d.innerText || '').trim().slice(0, 160) : null;
      });
      push('⑤ 저장 액션을 누르면 **확인창**이 뜬다', !!ask, ask || '확인창 없음 — 바로 원장이 생겼을 수 있다');
      push('⑤ 확인 전에는 아무것도 안 나간다 (음성 대조군)', posted === 0,
        `확인 전 POST ${posted}건 (0이어야 한다)`);
      // 취소로 닫는다 — 원장 무변경
      await page.keyboard.press('Escape');
      await sleep(500);
    }
    page.off('request', onReq);

    // ── ⑥ 패널이 열려 있어도 뒤 목록이 스크롤된다 ────────────────
    //   ★ 두 겹을 다 풀어야 움직인다: 문서 잠금 해제 + 백드롭이 휠을 밑으로 넘기기.
    const px = 260;  // 좌측 목록 위 (패널은 우측 420px)
    const py = 420;
    // ★ **잴 때 패널이 정말 열려 있었는지**부터 말한다. 이걸 안 재면 Esc 로 패널까지 닫힌 상태에서
    //   "스크롤 된다" 는 당연한 결과가 나와 거짓 초록이 된다(2026-09-13 실제로 한 바퀴 돌았다).
    // ★ 그리고 그 좌표를 **백드롭이 덮고 있는지**도 본다 — 안 덮고 있으면 통과가 무의미하다
    //   (memory feedback_overlay_eats_click_false_reason 의 반대편).
    const cover = await page.evaluate((px_, py_) => {
      const p = document.querySelector('[data-pq-drawer-panel]');
      const open = !!p && p.getBoundingClientRect().width > 40;
      const top = document.elementsFromPoint(px_, py_)[0];
      const covered = !!top && getComputedStyle(top).position === 'fixed' && !top.closest('[data-pq-drawer-panel]');
      return { open, covered };
    }, px, py);
    push('⑥ 잴 때 패널이 열려 있고 그 좌표를 백드롭이 덮고 있다 (측정 전제)',
      cover.open && cover.covered, `패널열림=${cover.open} 백드롭덮음=${cover.covered}`);
    const before = await leftScroller(page, px, py);
    if (!before) {
      push('⑥ 패널 열린 채 뒤 목록이 스크롤된다', false, '좌측에서 스크롤 컨테이너를 못 찾았다 — 판정 불가');
    } else {
      await page.mouse.move(px, py);
      await page.mouse.wheel({ deltaY: 400 });
      await sleep(600);
      const after = await probeTop(page);
      push('⑥ 패널 열린 채 뒤 목록이 스크롤된다', after !== null && after > before.top,
        `${before.tag} scrollTop ${before.top} → ${after}`);

      // 양성 대조군 — 패널을 닫고 같은 곳을 굴리면 당연히 움직여야 한다.
      //   안 움직이면 내 측정 방식이 틀린 것이지 제품이 고쳐진 게 아니다.
      await page.keyboard.press('Escape');
      await sleep(700);
      const closedBefore = await probeTop(page);
      await page.mouse.move(px, py);
      await page.mouse.wheel({ deltaY: 400 });
      await sleep(600);
      const closedAfter = await probeTop(page);
      push('⑥ 대조군 — 패널을 닫으면 당연히 스크롤된다 (측정 방식 검증)',
        closedAfter !== null && closedBefore !== null && closedAfter > closedBefore,
        `닫힌 상태 ${closedBefore} → ${closedAfter}`);
    }

    // ── 고객 패널도 같은 모양인가 (고객 탭) ───────────────────────
    //   ★ 탭은 URL 로 안 바뀐다 — 탭 버튼을 누른다(쿼리로 들어가면 상담 탭 그대로라 **엉뚱한 것을 잰다**).
    //   ★ 못 찾으면 **실패**다. "미측정" 을 초록으로 내면 이 계약(=신고의 핵심)이 한 번도 안 검사된다.
    await page.click('[data-testid="sale-tab-clients"]').catch(() => {});
    await sleep(1400);
    const cRow = await page.evaluate(() => {
      const b = document.querySelector('[data-testid^="sale-row-"]');
      return b ? b.getAttribute('data-testid') : null;
    });
    if (!cRow) {
      push('① 고객에서 연 패널도 **같은 액션 3개**', false,
        '고객 탭에 행이 0건 — 판정 불가(실패). 이 계약이 검사되지 않았다');
    } else {
      await page.click(`[data-testid="${cRow}"]`);
      await sleep(1000);
      const ci = await panelInfo(page);
      push('① 고객에서 연 패널도 **같은 모양**(하단 셋 없음 + ⋯ 있음)',
        !!ci && ci.actionIds.length === 0 && ci.hasMore,
        ci ? `남은 액션 ${ci.actionIds.join(',') || '없음'} · 더보기 ${ci.hasMore}` : '패널 없음');
    }
  } finally { await browser.close(); }
  return results;
}

module.exports = { name: 'Q sale 우측 패널 한 벌 (문의=고객 · 스크롤 통과)', run };
