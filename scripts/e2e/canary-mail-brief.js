// canary-mail-brief — "이 메일 믿어도 되나" 를 **지어내지 않고** 판정하는가 (2026-09-08)
//
//   Irene: "누르면 … 실제 메일이 어떤 상황인지 믿어도 되는지 그리고 연결된 프로젝트나 고객이
//          있다면 추가로 어느 순간인지 알려줄 수 있어?"
//
//   ★ 이 기능의 위험은 **그럴듯한 거짓 안심**이다. "안전합니다" 한 줄이 사용자가 첨부를 여는
//     근거가 된다. 그래서 판정은 전부 결정적 신호로만 만들고, 여기서 신호마다
//     **양성 대조군(잡아야 하는 것)과 음성 대조군(잡으면 안 되는 것)**을 같이 잰다.
//     LLM 은 요약만 쓰므로 이 카나리는 OPENAI 키 없이도 성립한다.
// ★ 모델을 끌어오므로 DB env 가 먼저 있어야 한다 — 없으면 require 단계에서 죽고
//   러너는 그것을 "카나리 실패" 가 아니라 FATAL 로 본다.
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const brief = require('/opt/planq/dev-backend/services/mailBrief');
const b = require('./lib/browser');

// 브라우저 단계에서 열어 볼 스레드. 본문 카나리와 같은 값을 기본으로 쓴다.
const THREADS = (process.env.E2E_BRIEF_THREADS || '5995').split(',').map((x) => x.trim()).filter(Boolean);

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });

  // ── 링크 텍스트 ↔ 실제 주소 ──────────────────────────────
  const phish = brief.findLinkMismatches(
    '<a href="https://evil-login.example.net/x">https://planq.kr/login</a>',
  );
  push('링크 위장을 잡는다 (양성 대조군)',
    phish.length === 1 && phish[0].real === 'evil-login.example.net' && phish[0].shown === 'planq.kr',
    `${JSON.stringify(phish)}`);

  const sameHost = brief.findLinkMismatches('<a href="https://mail.planq.kr/a">planq.kr</a>');
  push('서브도메인은 위장이 아니다 (음성 대조군)',
    sameHost.length === 0,
    `${JSON.stringify(sameHost)} — mail.planq.kr 과 planq.kr 을 다른 곳으로 보면 정상 메일이 전부 빨간불이 된다`);

  const plainText = brief.findLinkMismatches('<a href="https://planq.kr/login">여기를 눌러 로그인</a>');
  push('평범한 문구 링크는 비교하지 않는다 (음성 대조군)',
    plainText.length === 0,
    `${JSON.stringify(plainText)} — 텍스트가 주소처럼 보일 때만 비교해야 한다`);

  // ── 인증 결과 헤더 ────────────────────────────────────────
  const authOk = brief.readAuthResult({ 'authentication-results': 'mx.google.com; spf=pass smtp.mailfrom=a.com; dkim=pass; dmarc=pass' });
  push('인증 통과를 읽는다',
    !!authOk && authOk.spf === 'pass' && authOk.dkim === 'pass' && authOk.dmarc === 'pass',
    `${JSON.stringify(authOk)}`);

  const authFail = brief.readAuthResult({ 'authentication-results': 'mx; spf=fail; dkim=none; dmarc=fail' });
  push('인증 실패를 읽는다 (양성 대조군)',
    !!authFail && authFail.spf === 'fail' && authFail.dmarc === 'fail',
    `${JSON.stringify(authFail)}`);

  const authNone = brief.readAuthResult({});
  push('헤더가 없으면 **모른다** 로 남는다 (통과로 세지 않는다)',
    authNone === null,
    `${JSON.stringify(authNone)} — 여기서 통과로 떨어지면 옛 메일이 전부 "인증됨" 이 된다`);

  // ── 위험 첨부 ────────────────────────────────────────────
  const ext = (n) => brief.RISKY_EXT.has(n.split('.').pop().toLowerCase());
  push('이중 확장자 실행파일을 잡는다 (양성 대조군)',
    ext('invoice.pdf.exe') && ext('보안공지.scr') && ext('setup.js'),
    'invoice.pdf.exe · 보안공지.scr · setup.js');
  push('평범한 첨부는 위험으로 세지 않는다 (음성 대조군)',
    !ext('계약서.pdf') && !ext('명세.xlsx') && !ext('사진.png'),
    '계약서.pdf · 명세.xlsx · 사진.png');

  // ── 도메인 파싱 ──────────────────────────────────────────
  push('보낸사람 도메인을 정확히 뽑는다',
    brief.domainOf('Kim <a.b@Sub.Example.COM>') === 'sub.example.com' && brief.domainOf('') === '',
    `${brief.domainOf('Kim <a.b@Sub.Example.COM>')}`);

  void sequelize;   // 풀은 러너가 닫는다(다른 검사를 죽이지 않게)

  // ── 화면 단계 — **버튼이 보이고 눌리는가, 그리고 결과가 그려지는가** ────────────
  //   서버가 맞는 값을 준다고 화면에 나오는 것은 아니다. 이 저장소에서 여러 번 겪었다
  //   (memory: feedback_backend_done_ui_missing · feedback_measure_the_screen_not_innertext).
  const { browser, page } = await b.launch();
  try {
    await page.setViewport({ width: 1440, height: 900 });
    await b.login(page);
    for (const tid of THREADS) {
      await b.goto(page, `/mail?folder=all&thread=${tid}`);
      await b.sleep(4000);
      // 크기만 재지 않는다 — 그 좌표에 **실제로 그 버튼이 있는지**까지 본다.
      //   ★ 재기 전에 스크롤로 화면 안에 넣는다. `elementFromPoint` 는 **뷰포트 좌표**를 받으므로
      //     긴 메일에서 버튼이 아래(실측 y=952 · 뷰포트 900)에 있으면 가린 것이 없어도 null 이 나온다.
      //     그 null 을 "가려져 있다" 로 읽으면 검사기가 거짓 빨간불을 낸다(실제로 한 번 냈다 —
      //     확인해 보니 topTag 도 null 이고 스크롤 후에는 적중했다).
      const btn = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="mail-brief-open"]');
        if (!el) return { found: false };
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        const cx = Math.round(r.left + r.width / 2);
        const cy = Math.round(r.top + r.height / 2);
        const top = document.elementFromPoint(cx, cy);
        return {
          found: true, w: Math.round(r.width), h: Math.round(r.height),
          text: (el.textContent || '').trim(),
          hit: !!(top && (top === el || el.contains(top))),
        };
      });
      push(`thread ${tid}/요약·확인 버튼이 눌리는 자리에 있다`,
        btn.found && btn.w > 20 && btn.h > 14 && btn.hit,
        btn.found ? `"${btn.text}" ${btn.w}×${btn.h} · 클릭 지점 적중 ${btn.hit}` : '버튼이 DOM 에 없다');

      if (btn.found && btn.hit) {
        // 합성 click 이 아니라 실제 마우스로 누른다 — 좌표까지 맞아야 진짜 눌린 것이다
        //   (memory: feedback_synthetic_click_has_no_mousedown).
        const box = await page.$eval('[data-testid="mail-brief-open"]', (el) => {
          el.scrollIntoView({ block: 'center' });
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        await page.mouse.click(box.x, box.y);
        // LLM 요약이 붙어 있어 몇 초 걸린다. 결정적 부분(신뢰 배지·신호)은 그 전에도 나와야 한다.
        await b.sleep(9000);
        const panel = await page.evaluate(() => {
          const el = document.querySelector('[data-testid="mail-brief-panel"]');
          if (!el) return { found: false };
          const r = el.getBoundingClientRect();
          return {
            found: true, h: Math.round(r.height),
            signals: el.querySelectorAll('li').length,
            text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160),
          };
        });
        push(`thread ${tid}/누르면 패널이 실제로 그려진다`,
          panel.found && panel.h > 40 && panel.signals > 0,
          panel.found ? `높이 ${panel.h}px · 항목 ${panel.signals}개 — "${panel.text}"` : '패널이 안 그려졌다');
      }
    }
  } catch (e) {
    push('화면 단계', false, String((e && e.message) || e));
  } finally { await browser.close().catch(() => null); }

  return results;
}

module.exports = { run };
