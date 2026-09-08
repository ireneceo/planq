// canary-mail-plaintext — 평문 메일의 URL 이 **눌리는가**, 본문만 복사·선택되는가 (2026-09-08)
//
//   Irene: "이메일 내용에 이런게 있는데도 링크값이 안들어가고 그냥 텍스트로 나와. 클릭할 수가 없게."
//          "우측 상단 전체보기, 전달 기능 있는 곳에 내용 복사 기능도 넣어줄래? … 커멘드 에이 눌러서
//           복사하려고 하면 모든 곳이 다 걸리네. 원래 내용부분만 딱 잡혀야 하는 것도 맞는데."
//
//   운영 실측: message #3517 은 `body_html` 이 **NULL** 이다. HTML 메일에만 링크가 붙어 있었고
//   평문 분기는 글자를 그대로 그렸다 — 같은 메일함 안에서 규칙이 갈려 있었다.
//
//   여기서 재는 것:
//     ① 평문 본문의 http(s) URL 이 진짜 <a href> 로 그려진다 (양성 대조군)
//     ② 링크가 아닌 글자를 링크로 만들지 않는다 (음성 대조군)
//     ③ "내용 복사" 버튼이 눌리는 자리에 있고, 누르면 본문이 클립보드에 담긴다
//     ④ ⌘A 가 **본문 안에서만** 걸린다 — 본문 밖에서는 종전대로다 (음성 대조군)
const b = require('./lib/browser');
const { LINK_RE } = (() => {
  // 프론트 정규식과 **같은 것**을 쓴다. 여기서 다시 쓰면 검사기와 제품이 갈라진다.
  const src = require('fs').readFileSync('/opt/planq/dev-frontend/src/utils/linkify.tsx', 'utf-8');
  const m = src.match(/export const LINK_RE = (\/.*\/g);/);
  // eslint-disable-next-line no-eval -- 소스에서 뽑은 리터럴 하나. 외부 입력이 아니다.
  return { LINK_RE: m ? eval(m[1]) : /(https?:\/\/[^\s<>"]+)/g };
})();

// 평문(body_html NULL) 메일이 있는 스레드. 없으면 화면 단계는 건너뛴다.
// dev 실측: thread 5945 의 최신 메시지는 body_html 이 NULL 이고 본문에 URL 이 있다.
//   ★ 스레드가 사라지면 화면 단계가 조용히 통과해 버린다 — 그때는 '평문 본문이 없다' 로 **실패**한다.
const THREAD = process.env.E2E_PLAINTEXT_THREAD || '5945';

async function run() {
  const results = [];
  const push = (n, ok, m) => results.push({ name: n, fail: ok ? 0 : 1, details: [m] });

  // ── 정규식 단계 (브라우저 없이도 성립) ──────────────────────
  const sample = 'The event is by invitation, and registration is required: Request an Invitation '
    + 'https://inst.workwithrework.com/lt/15762598700389339/Rpdv0e1IcJn8Pr-psCimp';
  LINK_RE.lastIndex = 0;
  const found = sample.match(LINK_RE) || [];
  push('신고된 그 URL 을 링크로 인식한다 (양성 대조군)',
    found.length === 1 && found[0].endsWith('Rpdv0e1IcJn8Pr-psCimp'),
    `${JSON.stringify(found)}`);

  LINK_RE.lastIndex = 0;
  const noLink = 'Request an Invitation 이라고만 적힌 줄, 그리고 example.com 같은 맨 도메인';
  push('맨 도메인·평범한 글자는 링크로 만들지 않는다 (음성 대조군)',
    (noLink.match(LINK_RE) || []).length === 0,
    'http(s) 로 시작하는 것만 링크로 만든다 — javascript: 같은 스킴이 애초에 안 걸리는 이유다');

  if (!THREAD) {
    push('화면 단계', true, 'E2E_PLAINTEXT_THREAD 미지정 — 정규식 단계만 실행했다');
    return results;
  }

  const { browser, page } = await b.launch();
  try {
    await page.setViewport({ width: 1440, height: 900 });
    // 클립보드 읽기 권한 — 복사 결과를 **실제로 확인**하기 위해서다.
    const ctx = browser.defaultBrowserContext();
    await ctx.overridePermissions(b.BASE, ['clipboard-read', 'clipboard-write']).catch(() => null);
    await b.login(page);
    await b.goto(page, `/mail?folder=all&thread=${THREAD}`);
    await b.sleep(4000);

    // ① 본문 안에 진짜 앵커가 있는가
    const anchors = await page.evaluate(() => {
      const body = document.querySelector('[data-mail-body="1"]');
      if (!body) return { found: false };
      const as = Array.from(body.querySelectorAll('a[href^="http"]'));
      const first = as[0];
      const r = first ? first.getBoundingClientRect() : null;
      return {
        found: true, count: as.length,
        href: first ? first.getAttribute('href') : null,
        target: first ? first.getAttribute('target') : null,
        rel: first ? first.getAttribute('rel') : null,
        w: r ? Math.round(r.width) : 0, h: r ? Math.round(r.height) : 0,
      };
    });
    push('평문 본문의 URL 이 진짜 링크로 그려진다',
      anchors.found && anchors.count > 0 && !!anchors.href && anchors.w > 10 && anchors.h > 5,
      anchors.found ? `앵커 ${anchors.count}개 · ${anchors.href} · ${anchors.w}×${anchors.h}` : '평문 본문이 없다(HTML 메일 스레드일 수 있다)');
    push('새 탭 + noopener 로 연다',
      anchors.found && anchors.target === '_blank' && /noopener/.test(anchors.rel || ''),
      `target=${anchors.target} rel=${anchors.rel}`);

    // ③ 복사 버튼
    const btn = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="mail-copy-body"]');
      if (!el) return { found: false };
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
      return { found: true, w: Math.round(r.width), h: Math.round(r.height), hit: !!(top && (top === el || el.contains(top))), text: (el.textContent || '').trim() };
    });
    push('"내용 복사" 가 눌리는 자리에 있다',
      btn.found && btn.w > 20 && btn.hit,
      btn.found ? `"${btn.text}" ${btn.w}×${btn.h} · 적중 ${btn.hit}` : '버튼이 DOM 에 없다');

    if (btn.found && btn.hit) {
      const box = await page.$eval('[data-testid="mail-copy-body"]', (el) => {
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      await page.mouse.click(box.x, box.y);
      await b.sleep(700);
      const clip = await page.evaluate(async () => {
        try { return await navigator.clipboard.readText(); } catch (e) { return `__ERR__${e.message}`; }
      });
      const label = await page.$eval('[data-testid="mail-copy-body"]', (el) => (el.textContent || '').trim());
      // 클립보드를 못 읽는 환경이라도 **버튼 글자가 바뀌는지**로 성공을 판정할 수 있다.
      const copied = (typeof clip === 'string' && !clip.startsWith('__ERR__') && clip.trim().length > 20)
        || /복사됨|Copied/.test(label);
      push('누르면 본문이 복사된다',
        copied,
        `버튼 라벨 "${label}" · 클립보드 ${String(clip).slice(0, 60)}`);
    }

    // ④ ⌘A 범위 — 본문 안에 커서를 두고 눌렀을 때만 본문으로 한정된다
    const scoped = await page.evaluate(() => {
      const body = document.querySelector('[data-mail-body="1"]');
      if (!body) return null;
      const sel = window.getSelection();
      const r = document.createRange();
      r.setStart(body, 0); r.collapse(true);
      sel.removeAllRanges(); sel.addRange(r);
      return true;
    });
    if (scoped) {
      await page.keyboard.down('Meta'); await page.keyboard.press('KeyA'); await page.keyboard.up('Meta');
      await b.sleep(300);
      const inside = await page.evaluate(() => {
        const sel = window.getSelection();
        const body = document.querySelector('[data-mail-body="1"]');
        if (!sel || !sel.rangeCount || !body) return null;
        const r = sel.getRangeAt(0);
        const c = r.commonAncestorContainer;
        const el = c.nodeType === 1 ? c : c.parentElement;
        return { withinBody: !!(el && (el === body || body.contains(el) || el.contains(body) === false && body.contains(el))), len: sel.toString().length };
      });
      push('본문 안에서 ⌘A 는 본문만 잡는다',
        !!inside && inside.withinBody && inside.len > 20,
        `${JSON.stringify(inside)}`);

      // 음성 대조군 — 본문 밖(목록)에 커서를 두면 손대지 않는다
      const outside = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="mail-message-header"]') || document.body;
        const sel = window.getSelection();
        const r = document.createRange();
        r.setStart(el, 0); r.collapse(true);
        sel.removeAllRanges(); sel.addRange(r);
        return true;
      });
      if (outside) {
        await page.keyboard.down('Meta'); await page.keyboard.press('KeyA'); await page.keyboard.up('Meta');
        await b.sleep(300);
        const res = await page.evaluate(() => {
          const sel = window.getSelection();
          const body = document.querySelector('[data-mail-body="1"]');
          if (!sel || !sel.rangeCount) return { len: 0, onlyBody: false };
          const txt = sel.toString();
          return { len: txt.length, onlyBody: !!(body && txt.trim() === (body.textContent || '').trim()) };
        });
        push('본문 밖에서는 ⌘A 를 가로채지 않는다 (음성 대조군)',
          !res.onlyBody,
          `선택 ${res.len}자 · 본문과 정확히 같음=${res.onlyBody} — 같으면 목록에서도 본문만 잡히는 것`);
      }
    }
  } catch (e) {
    push('화면 단계', false, String((e && e.message) || e));
  } finally { await browser.close().catch(() => null); }
  return results;
}

module.exports = { run };
