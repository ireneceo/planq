// canary-mail-frame — 메일 본문 iframe 이 **내용만큼 커지는가** (2026-09-07)
//
//   Irene: "이 내용 아래에 130-135px 정도 빈 여백이 들어가 있어 … 첨부파일 있는 것만 이런 것 같아."
//   원인은 첨부가 아니었다. srcdoc iframe 은 **부모의 CSP 를 물려받고**, 2026-09-02 에 들어온
//   `script-src 'self'` 가 높이 보고용 **인라인 스크립트를 차단**했다. postMessage 가 한 번도
//   안 나가니 부모는 글자 수 추정치에 iframe 을 고정했고, 본문 텍스트가 없는 알림 메일은
//   추정치가 최소값 200px 로 떨어져 실제 636px 짜리 내용이 200px 상자에 담겼다.
//   (첨부가 있는 메일에서 두드러진 이유: 그 아래에 첨부 줄이 붙어 경계가 눈에 띄었다.)
//
//   → 스크립트를 /mail-frame.js 로 빼서 'self' 로 통과시켰다. CSP 는 그대로 둔다.
//   이 카나리는 **CSP 위반 로그 0** 과 **iframe 높이 = 내용 높이** 를 함께 본다.
//   한쪽만 보면, 스크립트가 죽어도 추정치가 우연히 맞는 메일에서는 초록이 나온다.
const b = require('./lib/browser');

const THREADS = (process.env.E2E_FRAME_THREADS || '5995,4725').split(',').map((s) => s.trim()).filter(Boolean);

async function run() {
  const results = [];
  const push = (n, ok, m) => results.push({ name: n, fail: ok ? 0 : 1, details: [m] });
  const { browser, page } = await b.launch();
  const cspErrs = [];
  page.on('console', (m) => {
    const t = m.text();
    if (/violates the following Content Security Policy/i.test(t) && /script/i.test(t)) cspErrs.push(t.slice(0, 120));
  });
  try {
    await page.setViewport({ width: 1440, height: 900 });
    await b.login(page);
    for (const tid of THREADS) {
      cspErrs.length = 0;
      await b.goto(page, `/mail?folder=all&thread=${tid}`);
      await b.sleep(4500);
      const frames = page.frames().filter((f) => f !== page.mainFrame());
      if (!frames.length) { push(`thread ${tid}/본문 프레임`, false, '본문 iframe 이 없다 — 판정 불가'); continue; }
      // 스크립트가 실제로 돌았는가 (존재가 아니라 **동작**으로 본다)
      let ran = null, inner = null;
      try {
        const r = await frames[0].evaluate(() => ({ fn: typeof window.__planqSend, h: document.body.scrollHeight }));
        ran = r.fn === 'function'; inner = r.h;
      } catch { /* 접근 불가 */ }
      push(`thread ${tid}/높이 스크립트가 돈다`, ran === true,
        ran === null ? '프레임 접근 불가' : `window.__planqSend=${ran ? 'function' : '없음'}`);
      push(`thread ${tid}/스크립트 CSP 위반 0`, cspErrs.length === 0,
        cspErrs.length ? `🔴 ${cspErrs[0]}` : '위반 없음');
      const outer = await page.evaluate(() => {
        const f = document.querySelector('iframe');
        return f ? Math.round(f.getBoundingClientRect().height) : null;
      });
      // 바깥 높이가 안쪽 내용 높이와 맞는가 (2px 오차 허용).
      //   ★ 부모는 6000px 에서 자른다(MailPage 의 Math.min(...,6000)) — **의도된 상한**이라
      //     아주 긴 메일은 여기서 어긋나는 것이 정상이다. 상한에 닿았으면 통과로 센다.
      const CAP = 6000;
      const capped = outer === CAP && inner != null && inner >= CAP;
      const fits = inner != null && outer != null && (Math.abs(outer - inner) <= 2 || capped);
      push(`thread ${tid}/iframe 이 내용만큼 크다`, fits,
        capped ? `상한 ${CAP}px 도달 (안쪽 ${inner}px) — 정상`
               : `바깥 ${outer}px · 안쪽 ${inner}px${fits ? '' : ` · 어긋남 ${Math.abs((outer || 0) - (inner || 0))}px`}`);
    }
  } finally { await browser.close().catch(() => null); }
  return results;
}

module.exports = { name: 'mailframe', run };

if (require.main === module) {
  run().then((rs) => {
    let bad = 0;
    rs.forEach((r) => { if (r.fail) bad++; console.log(`${r.fail ? '❌' : '✅'} ${r.name} — ${r.details[0]}`); });
    console.log(bad ? `\n실패 ${bad}/${rs.length}` : `\n통과 ${rs.length}/${rs.length}`);
    process.exit(bad ? 1 : 0);
  }).catch((e) => { console.error('🔴 하니스 오류:', e.message); process.exit(2); });
}
