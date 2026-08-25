// 세로로 쌓인 텍스트 감사 (2026-08-25)
//
// Irene: "모바일에서 q note 상세 들어가면 상단이 다 깨져서 제목이 세로로 보이고 개판이야."
//        "다른 곳도 내가 찾아내야지만 너가 알아?"
//
// → 같은 계열을 **사람이 신고하기 전에** 잡는다. 정적 스캔은 못 쓴다(제목류 413개 중 대부분은
//   세로 레이아웃이라 줄바꿈이 정상이다). 증상 자체를 실제 브라우저에서 잰다:
//     "글자가 들어갈 폭이 없어 한 글자씩 세로로 쌓인 요소"
//
//   판정: 텍스트 노드를 가진 요소 중
//     · 렌더 폭이 글자 2개 폭보다 좁고 (한국어 min-content = 1글자)
//     · 줄 수가 3줄 이상이며
//     · 실제로 보이는 것(면적·가시성)
//   → flex 에서 min-width:auto 로 붕괴한 것. 이게 "제목이 세로로 보인다" 의 기계적 정의다.
const { launch, login, gotoSPA, sleep, BASE } = require('./lib/browser');

// 상세까지 들어가야 잡힌다 — 목록만 보면 이 버그는 안 보인다(옛 감사가 놓친 이유).
// ★ 앱 **전체 라우트**를 돈다 (appRoutes.tsx 기준 54개).
//   17개만 돌던 판본은 "다른 곳도 사용자가 찾아내야 아느냐" 는 지적을 받을 만했다 —
//   신고된 화면만 검사하면 신고되기 전엔 영원히 모른다.
//   :param 라우트는 실 ID 로 치환한다(없는 워크스페이스면 그 줄만 스킵된다).
const IDS = {
  session: process.env.AUDIT_SESSION_ID || '231',
  project: process.env.AUDIT_PROJECT_ID || '66',
  post: process.env.AUDIT_POST_ID || '82',
};

const ROUTES = [
  ['대시보드', '/dashboard'],
  ['확인필요', '/inbox'],
  ['알림', '/notifications'],
  ['새소식', '/whats-new'],
  ['워크스페이스 설정', '/business/settings'],
  ['설정·청구', '/business/settings/billing'],
  ['설정·메일', '/business/settings/email'],
  ['설정·알림', '/business/settings/notifications'],
  ['멤버', '/business/members'],
  ['고객', '/business/clients'],
  ['조직', '/business/org'],
  ['Q Talk', '/talk'],
  ['Q Task', '/tasks'],
  ['Q Task·주간', '/tasks/week'],
  ['워크스페이스 정보', '/info'],
  ['프로젝트', '/projects'],
  ['프로젝트 상세', `/projects/p/${IDS.project}`],
  ['캘린더', '/calendar'],
  ['근태', '/attendance'],
  ['Q Note 목록', '/notes'],
  ['Q Note 상세', `/notes/${IDS.session}`],
  ['Q File', '/files'],
  ['개인 보관함', '/personal-vault'],
  ['내 피드백', '/me/feedback'],
  ['Q docs', '/docs'],
  ['Q docs 상세', `/docs?post=${IDS.post}`],
  ['받은 서명', '/signatures/received'],
  ['프로필', '/profile'],
  ['프로필·연동', '/profile/integrations'],
  ['업무 설정', '/me/work-settings'],
  ['개인 설정', '/settings'],
  ['Q Mail', '/mail'],
  ['Q Bill', '/bills'],
  ['통계', '/stats/overview'],
  ['지식', '/knowledge'],
  // 플랫폼 관리자 화면 — 계정 권한이 없으면 리다이렉트되어 그 줄은 그냥 통과한다
  ['관리자·대시보드', '/admin/dashboard'],
  ['관리자·워크스페이스', '/admin/businesses'],
  ['관리자·피드백', '/admin/feedback'],
  ['관리자·위키', '/admin/wiki'],
  ['관리자·업데이트', '/admin/updates'],
  ['관리자·구독', '/admin/subscriptions'],
  ['관리자·결제', '/admin/payments'],
  ['관리자·문의', '/admin/inquiries'],
  ['관리자·감사로그', '/admin/audit-logs'],
  ['관리자·사용자', '/admin/users'],
];

async function scan(page) {
  return page.evaluate(() => {
    const out = [];
    const vw = document.documentElement.clientWidth;
    for (const el of document.querySelectorAll('body *')) {
      // 자기 자신의 텍스트만 (자식 컨테이너 제외)
      const nodes = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim().length >= 2);
      if (nodes.length !== 1) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      if (cs.writingMode && cs.writingMode !== 'horizontal-tb') continue;   // 의도적 세로쓰기는 제외
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      // ★ 조상 중 폭 0 인 것이 있으면 화면에 실재하지 않는다(닫힌 모달 껍데기 등).
      //   Q docs 스윕에서 모달 제목 h2 가 "폭15px 20줄" 로 잡혔는데, 부모가 0px 라
      //   사용자 눈에는 아무것도 없는 자리였다 — 사람이 볼 수 없는 것은 결함이 아니다.
      let anc = el.parentElement, hidden = false;
      while (anc && anc !== document.body) {
        if (anc.getBoundingClientRect().width <= 0) { hidden = true; break; }
        anc = anc.parentElement;
      }
      if (hidden) continue;

      // ★ 줄 수는 **텍스트의 줄 상자 개수**로 센다.
      //   첫 판본은 요소높이÷줄높이로 셌는데, padding 이 있는 탭 버튼(높이 41px, 1줄)을
      //   3줄로 오판해 오탐 11건을 냈다. Range 의 client rect 개수가 정확한 줄 수다.
      const range = document.createRange();
      range.selectNodeContents(nodes[0]);
      const lines = range.getClientRects().length;
      range.detach && range.detach();
      if (lines < 3) continue;

      const fs = parseFloat(cs.fontSize) || 16;
      const narrow = r.width < Math.min(140, vw * 0.35);
      const titleish = /^H[1-4]$/.test(el.tagName) || (parseInt(cs.fontWeight, 10) || 400) >= 600;
      if (narrow && titleish) {
        out.push({
          tag: el.tagName.toLowerCase(),
          text: nodes[0].textContent.trim().slice(0, 24),
          cls: (el.className || '').toString().slice(0, 30),
          par: el.parentElement ? `${el.parentElement.tagName}.${(el.parentElement.className||'').toString().split(' ')[0]}(${Math.round(el.parentElement.getBoundingClientRect().width)}px,${getComputedStyle(el.parentElement).display})` : '-',
          gpar: el.parentElement && el.parentElement.parentElement ? `${el.parentElement.parentElement.tagName}(${Math.round(el.parentElement.parentElement.getBoundingClientRect().width)}px)` : '-',
          w: Math.round(r.width), h: Math.round(r.height), lines, fs: Math.round(fs),
        });
      }
    }
    return out;
  });
}

async function run() {
  const results = [];
  const { browser, page } = await launch({ mobile: true });
  try {
    await login(page);
    for (const [label, path] of ROUTES) {
      try {
        // ★ 상세는 pushState 로 안 그려진다 — 전체 로드로 들어가야 헤더가 실제로 렌더된다.
        //   (첫 판본은 gotoSPA 만 써서 /notes/231 에서도 "제목 1개" 만 잡혔다 = 검사 안 된 통과)
        if (/\/[0-9]+$|\?/.test(path)) {
          await page.goto(BASE + path, { waitUntil: 'networkidle2' });
          await sleep(2200);
        } else {
          await gotoSPA(page, path);
          await sleep(1400);
        }
        // ★ 목록만 보면 이 버그는 안 보인다 — 헤더가 터지는 건 **상세**다.
        //   첫 리스트 항목을 눌러 상세까지 들어간 뒤 잰다(못 누르면 목록 상태로 측정).
        try {
          await page.evaluate(() => {
            const cand = document.querySelector('[data-testid$="-row"], [role="listitem"] a, li a, [data-row-id]');
            if (cand) (cand.closest('a,button,[role=button]') || cand).click();
          });
          await sleep(1600);
        } catch { /* 상세 진입 실패 — 목록 상태로 측정 */ }
        // ★ 스트레스 — 현재 데이터의 제목이 짧거나 영어면 결함이 있어도 증상이 안 난다.
        //   (Q Note 도 긴 한국어 제목을 넣고서야 재현됐다. 데이터에 기대는 검사는 거짓 통과한다.)
        //   모든 제목에 긴 한국어를 강제로 넣어 **구조적으로** 방어가 있는지 본다.
        const stressed = await page.evaluate(() => {
          const LONG = '모눈스터디 랜딩 리뉴얼 요구사항 정리 회의 기록';
          let n = 0;
          // ★ h1~h4 만 스트레스하면 PlanQ 에서는 거의 아무것도 검사하지 않는다 —
          //   이 앱의 제목은 대부분 **굵은 div/span** 이다(정적 스캔에서 413개 중 다수가 div).
          //   판정부(titleish)와 **같은 기준**으로 대상을 고른다. 기준이 두 벌이면 갈라진다.
          // ★ **헤더 안쪽만** 스트레스한다.
          //   앱 전체를 스트레스했더니 좌측 메뉴 라벨(208px)·32px 아이콘 버튼까지 걸려 오탐이 났다.
          //   그 자리엔 긴 제목이 들어갈 일이 없다. 실제로 터지는 형태는 하나다 —
          //   "왼쪽 제목 + 오른쪽 액션" 이 한 줄에 선 헤더(가로 flex · space-between · 높이 44px+).
          const headers = [...document.querySelectorAll('div,header,section')].filter((h) => {
            const c = getComputedStyle(h);
            if (c.display !== 'flex' || c.flexDirection !== 'row') return false;
            if (c.justifyContent !== 'space-between') return false;
            const b = h.getBoundingClientRect();
            return b.height >= 40 && b.height <= 120 && b.width > 200;
          });
          for (const hdr of headers) {
            for (const el of hdr.querySelectorAll('*')) {
              const own = [...el.childNodes].filter((x) => x.nodeType === 3 && x.textContent.trim().length >= 2);
              if (own.length !== 1) continue;
              const cs = getComputedStyle(el);
              if (cs.display === 'none' || cs.visibility === 'hidden') continue;
              const titleish = /^H[1-4]$/.test(el.tagName) || (parseInt(cs.fontWeight, 10) || 400) >= 600;
              if (!titleish) continue;
              if (own[0].textContent.trim().length > 40) continue;   // 본문 문단 제외
              // 아이콘 버튼(고정 32~44px) 안의 라벨은 제외 — 그 자리에 긴 제목이 들어갈 일이 없다.
              //   (좌측 패널 접기 버튼이 매 화면 오탐 1건씩 냈다)
              const host = el.closest('button,a');
              if (host && host.getBoundingClientRect().width <= 48) continue;
              own[0].textContent = LONG; n++;
            }
          }
          return n;
        });
        await sleep(500);
        const hits = await scan(page);
        results.push({
          route: `${label} (${path})`,
          // ★ run.js printSuite 는 r.fail 로 판정한다 — ok 를 쓰면 결함이 있어도 ✅ 로 찍힌다(실제로 그랬다)
          fail: hits.length,
          detail: hits.length === 0
            // ★ 몇 개를 스트레스했는지 같이 남긴다 — 0개면 이 통과는 "검사를 안 한 것" 이다
            ?  `세로로 쌓인 텍스트 없음 (제목 ${stressed}개 스트레스)`
            : hits.map((h) => `<${h.tag}.${h.cls}> "${h.text}" 폭${h.w}px ${h.lines}줄 부모=${h.par} 조부모=${h.gpar}`).join(' | '),
        });
      } catch (e) {
        results.push({ route: `${label} (${path})`, error: 1, detail: `측정 실패: ${e.message}` });
      }
    }
  } finally { await browser.close(); }
  return results;
}

module.exports = { name: '세로로 쌓인 텍스트 (모바일 375px)', run };
if (require.main === module) {
  run().then((rs) => {
    let fail = 0;
    for (const r of rs) { const bad = (r.fail || 0) + (r.error || 0); if (bad) fail++; console.log(`${bad ? '❌' : '✅'} ${r.route} — ${r.detail}`); }
    console.log(`\n━━━ 실패 ${fail}건 ━━━`);
    process.exit(fail ? 1 : 0);
  });
}
