// canary-chrome-offset — 모바일 전면 모달이 **상단 크롬에 잘리지 않는가** (2026-09-09)
//
//   Irene: "설정들어가면 상단이 모바일에서 잘려. 모든 페이지 통일된 레이아웃 컴포넌트 아니야?
//           상단 헤더 모바일에서 잘리는 문제를 내가 찾아내서 하나 하나 수정하고 있는 이유가 뭐야?"
//   실측된 이유: **모달 15곳이 각자 `margin-top: 60px` 을 적어 뒀다.** 진짜 크롬 높이는
//     --pq-mobile-chrome = --pq-mobile-header(56) + --pq-safe-top
//   이고, 브라우저는 safe-top 이 0 이라 60 vs 56 = **4px 차이뿐**이다. 기기(앱)에서만
//   상태바 24px 만큼 잘린다 → 모든 브라우저 검사를 통과하며 운영까지 갔다.
//
//   ★ 그래서 이 카나리는 **네이티브 상태바를 모사하는 패스가 본체다.**
//     모사 없이 재면 4px 오차가 반올림에 묻혀 초록이 거짓말한다
//     (CLAUDE.md: "브라우저는 --pq-safe-top 이 0 이라 이 계열 버그가 재현되지 않는다").
//
//   정적 가드(`guard-invariants --category=chromeoffset`)는 **소스에 숫자가 있는지**만 본다.
//   이 카나리는 **화면에서 실제로 몇 px 에 서는지**를 본다 — 둘 다 필요하다.
const b = require('./lib/browser');

// [경로, 모달을 여는 selector, 이름]
const TARGETS = (process.env.CHROME_OFFSET_TARGETS ? JSON.parse(process.env.CHROME_OFFSET_TARGETS) : [
  [`/talk?conv=${process.env.E2E_CONV || '369'}`, '[data-testid="chat-open-settings"]', '채팅 설정'],
]);

/** 열린 모달의 top 과 브라우저가 해석한 --pq-chrome-bottom 을 같은 단위로 잰다. */
function probeModal() {
  const dlg = document.querySelector('[role="dialog"][aria-modal="true"]');
  if (!dlg) return { found: false };
  const d = dlg.getBoundingClientRect();
  // ★ 토큰은 `calc(56px + max(0px, 24px))` 같은 **문자열**이다 — parseFloat 는 NaN 이고
  //   그 NaN 이 판정을 통째로 무효로 만든다(2026-09-09 거짓 FAIL 실사례).
  //   브라우저가 실제로 해석한 픽셀은 **그 값을 써 보고** computed 를 읽어야 얻는다.
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;height:var(--pq-chrome-bottom,0px);';
  document.body.appendChild(probe);
  const chromePx = Math.round(parseFloat(getComputedStyle(probe).height) || 0);
  probe.remove();
  // 모달 제목이 **실제로 보이는가** — rect 가 있어도 크롬에 덮이면 한 픽셀도 안 그려진다
  const h = dlg.querySelector('h1,h2,h3,[class*="Title"]') || dlg.firstElementChild;
  const hr = h ? h.getBoundingClientRect() : null;
  let titleVisible = null, coverer = null;
  if (hr && hr.height > 4 && hr.width > 4) {
    const hit = document.elementFromPoint(hr.left + Math.min(30, hr.width / 2), hr.top + Math.min(6, hr.height / 2));
    titleVisible = !!(hit && (hit === h || h.contains(hit) || hit.contains(h)));
    if (!titleVisible && hit) coverer = String(hit.innerText || hit.tagName || '?').slice(0, 30).replace(/\n/g, '/');
  }
  return { found: true, top: Math.round(d.top), chromePx, titleVisible, coverer,
           rawToken: getComputedStyle(document.documentElement).getPropertyValue('--pq-chrome-bottom').trim() };
}

async function run() {
  const results = [];
  const push = (name, ok, detail) => results.push({ name, fail: !ok, details: [detail] });
  const { browser, page } = await b.launch({ mobile: true });
  try {
    await b.login(page);
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

    for (const [path, opener, label] of TARGETS) {
      for (const native of [false, true]) {
        const pass = native ? '네이티브모사' : '브라우저';
        await b.goto(page, path);
        await b.sleep(1800);
        if (native) await page.evaluate(() => document.documentElement.classList.add('pq-android'));
        await b.sleep(300);
        const opened = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el) return false;
          el.click();
          return true;
        }, opener);
        if (!opened) { push(`${label}/${pass}/모달 열림`, false, `여는 버튼(${opener})을 못 찾았다 — 아래 판정 무의미`); continue; }
        await b.sleep(1200);
        const m = await page.evaluate(probeModal);
        if (!m.found) { push(`${label}/${pass}/모달 열림`, false, '모달이 안 떴다'); continue; }

        // 네이티브 모사 패스는 **상태바 자리가 실제로 생겼는지** 먼저 증명한다.
        //   안 생겼으면 이 패스는 브라우저 패스와 같아 아무것도 검증하지 않는다.
        if (native) {
          push(`${label}/${pass}/상태바 자리가 생겼다`, m.chromePx > 56,
            `--pq-chrome-bottom=${m.chromePx}px (${m.rawToken}) — 56 초과여야 모사가 먹은 것`);
        }
        push(`${label}/${pass}/크롬 끝에 정확히 선다`, Math.abs(m.top - m.chromePx) <= 1,
          `모달 top=${m.top}px · 크롬 끝=${m.chromePx}px · 어긋남=${Math.abs(m.top - m.chromePx)}px`);
        push(`${label}/${pass}/제목이 보인다`, m.titleVisible !== false,
          `보임=${m.titleVisible}${m.coverer ? ` ← 그 자리에 "${m.coverer}"` : ''}`);

        await page.keyboard.press('Escape').catch(() => null);
        await b.sleep(500);
        if (native) await page.evaluate(() => document.documentElement.classList.remove('pq-android')).catch(() => null);
      }
    }
  } finally { await browser.close().catch(() => null); }
  return results;
}

module.exports = { name: 'chromeoffset', run };

if (require.main === module) {
  run().then((rs) => {
    let bad = 0;
    rs.forEach((r) => { if (r.fail) bad++; console.log(`${r.fail ? '❌' : '✅'} ${r.name} — ${r.details[0]}`); });
    console.log(bad ? `\n실패 ${bad}/${rs.length}` : `\n통과 ${rs.length}/${rs.length}`);
    process.exit(bad ? 1 : 0);
  }).catch((e) => { console.error('🔴 하니스 오류:', e.message); process.exit(2); });
}
