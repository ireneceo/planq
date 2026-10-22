// 인사이트 글 SNS 카드 — HTML 템플릿 4종 + 링크 미리보기(OG) 1종 (docs/SNS_PUBLISH_DESIGN.md §6).
//   문제제기(problem) · 체크리스트(checklist) · 전후비교(beforeafter) · 숫자(number) · og(1200×630).
//   ★ 글자는 **자르지 않는다** — 넘치면 cardRender 가 data-fit 상자의 넘침을 재서 생성 실패로 돌려준다.
//   폰트는 서버에 설치된 Noto Sans CJK KR(외부 글꼴을 받지 않는다 — 렌더 중 네트워크 없음).

const BRAND = {
  ink: '#0F172A',
  sub: '#475569',
  teal: '#0D9488',
  tealSoft: '#CCFBF1',
  coral: '#F43F5E',
  bg: '#F8FAFC',
};

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SIZES = {
  feed: { w: 1080, h: 1350 },
  story: { w: 1080, h: 1920 },
  og: { w: 1200, h: 630 },
};

function shell({ w, h }, inner, extraCss = '') {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${w}px;height:${h}px;overflow:hidden}
body{font-family:'Noto Sans CJK KR','Noto Sans KR',sans-serif;color:${BRAND.ink};background:${BRAND.bg};word-break:keep-all;overflow-wrap:anywhere}
.card{position:relative;width:${w}px;height:${h}px;padding:96px 88px 120px;display:flex;flex-direction:column}
.brand{position:absolute;left:88px;bottom:56px;font-size:30px;font-weight:700;letter-spacing:-.5px;color:${BRAND.ink}}
.brand b{color:${BRAND.teal}}
.page{position:absolute;right:88px;bottom:58px;font-size:26px;color:${BRAND.sub}}
.tag{display:inline-block;align-self:flex-start;max-width:100%;white-space:nowrap;padding:10px 22px;border-radius:999px;background:${BRAND.tealSoft};color:${BRAND.teal};font-size:28px;font-weight:700;margin-bottom:40px}
[data-fit]{overflow:hidden}
${extraCss}
</style></head><body>${inner}</body></html>`;
}

const brandMark = () => '<div class="brand">Plan<b>Q</b></div>';
const pageMark = (n, total) => (n && total ? `<div class="page">${n} / ${total}</div>` : '');

/** 문제제기 — 큰 질문 한 줄 + 받침 문장 */
function problem(c, size, n, total) {
  return shell(size, `<div class="card" style="justify-content:center">
  <div class="tag" data-fit style="">${esc(c.tag || '이런 적 있나요?')}</div>
  <div data-fit style="font-size:76px;font-weight:800;line-height:1.28;letter-spacing:-2px;max-height:${size.h - 520}px">${esc(c.headline)}</div>
  <div style="width:120px;height:10px;background:${BRAND.coral};border-radius:5px;margin:48px 0"></div>
  <div data-fit style="font-size:38px;line-height:1.55;color:${BRAND.sub};max-height:240px">${esc(c.sub)}</div>
  ${brandMark()}${pageMark(n, total)}</div>`);
}

/** 체크리스트 — 제목 + 항목 3~5개 */
function checklist(c, size, n, total) {
  const items = (Array.isArray(c.items) ? c.items : []).slice(0, 5);
  const li = items.map((it, i) => `<li><span class="num">${i + 1}</span><span class="txt">${esc(it)}</span></li>`).join('');
  return shell(size, `<div class="card">
  <div class="tag" data-fit style="">${esc(c.tag || '체크리스트')}</div>
  <div data-fit style="font-size:62px;font-weight:800;line-height:1.3;letter-spacing:-1.5px;max-height:250px;margin-bottom:48px">${esc(c.title)}</div>
  <ul data-fit style="list-style:none;display:flex;flex-direction:column;gap:26px;max-height:${size.h - 650}px">${li}</ul>
  ${brandMark()}${pageMark(n, total)}</div>`, `
li{display:flex;gap:26px;align-items:flex-start;background:#fff;border:2px solid #E2E8F0;border-radius:24px;padding:26px 30px}
.num{flex:none;width:54px;height:54px;border-radius:14px;background:${BRAND.teal};color:#fff;font-size:30px;font-weight:800;display:flex;align-items:center;justify-content:center}
.txt{font-size:36px;line-height:1.45;font-weight:500}`);
}

/** 전후비교 — 전(회색) / 후(틸) 두 상자 */
function beforeafter(c, size, n, total) {
  const ul = (arr) => (Array.isArray(arr) ? arr : []).slice(0, 4).map((x) => `<li>${esc(x)}</li>`).join('');
  return shell(size, `<div class="card">
  <div data-fit style="font-size:58px;font-weight:800;line-height:1.3;letter-spacing:-1.5px;max-height:230px;margin-bottom:44px">${esc(c.title)}</div>
  <div class="box before"><div class="lbl">${esc(c.before_label || '전')}</div><ul data-fit style="max-height:${Math.round((size.h - 720) / 2)}px">${ul(c.before)}</ul></div>
  <div class="arrow">↓</div>
  <div class="box after"><div class="lbl">${esc(c.after_label || '후')}</div><ul data-fit style="max-height:${Math.round((size.h - 720) / 2)}px">${ul(c.after)}</ul></div>
  ${brandMark()}${pageMark(n, total)}</div>`, `
.box{border-radius:28px;padding:30px 36px}
.before{background:#F1F5F9;color:${BRAND.sub}}
.after{background:${BRAND.tealSoft};color:${BRAND.ink}}
.lbl{font-size:28px;font-weight:800;margin-bottom:14px}
.after .lbl{color:${BRAND.teal}}
.box ul{list-style:none;display:flex;flex-direction:column;gap:12px}
.box li{font-size:34px;line-height:1.45}
.box li::before{content:'• '}
.arrow{text-align:center;font-size:52px;color:${BRAND.coral};margin:10px 0;font-weight:800}`);
}

/** 숫자 — 큰 숫자 + 설명 (숫자는 글 안에 있는 것만 — 프롬프트가 지킨다) */
function number(c, size, n, total) {
  return shell(size, `<div class="card" style="justify-content:center">
  <div class="tag" data-fit style="">${esc(c.tag || '핵심')}</div>
  <div data-fit style="font-size:220px;font-weight:900;line-height:1.05;letter-spacing:-6px;color:${BRAND.teal};max-height:260px">${esc(c.number)}</div>
  <div data-fit style="font-size:60px;font-weight:800;line-height:1.3;letter-spacing:-1.5px;margin-top:36px;max-height:240px">${esc(c.caption)}</div>
  <div data-fit style="font-size:36px;line-height:1.55;color:${BRAND.sub};margin-top:32px;max-height:220px">${esc(c.sub)}</div>
  ${brandMark()}${pageMark(n, total)}</div>`);
}

/** 링크 미리보기 1200×630 — 글 제목 + 요약 (카톡·페북·링크드인이 링크를 펼칠 때 보이는 그림) */
function og(a) {
  const size = SIZES.og;
  return shell(size, `<div class="card" style="padding:64px 72px 96px;background:#fff">
  <div style="position:absolute;left:0;top:0;width:18px;height:100%;background:${BRAND.teal}"></div>
  <div class="tag" data-fit style="font-size:24px;margin-bottom:28px">${esc(a.tag || '인사이트')}</div>
  <div data-fit style="font-size:58px;font-weight:800;line-height:1.28;letter-spacing:-1.5px;max-height:230px">${esc(a.title)}</div>
  <div data-fit style="font-size:28px;line-height:1.5;color:${BRAND.sub};margin-top:24px;max-height:90px">${esc(a.summary || '')}</div>
  <div class="brand" style="left:72px;bottom:40px">Plan<b>Q</b> <span style="font-weight:400;color:${BRAND.sub};font-size:24px">planq.kr</span></div>
  </div>`);
}

const TEMPLATES = { problem, checklist, beforeafter, number };
const TEMPLATE_KEYS = Object.keys(TEMPLATES);

function buildCardHtml(card, sizeKey = 'feed', n, total) {
  const fn = TEMPLATES[card && card.template];
  if (!fn) throw Object.assign(new Error('unknown_template'), { code: 'unknown_template' });
  return fn(card, SIZES[sizeKey] || SIZES.feed, n, total);
}

module.exports = { buildCardHtml, og, SIZES, TEMPLATE_KEYS };
