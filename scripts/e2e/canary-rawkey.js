// canary-rawkey — 화면에 **번역 키가 그대로** 나오는 곳을 찾는다 (2026-09-07)
//
//   2026-09-07 실측: 프로젝트 카드의 상태 칩이 `status.active` 로 떠 있었다.
//   코드는 `t(\`status.${p.status}\`)` 인데 qproject.json 에 그 키가 ko/en 둘 다 없어서,
//   i18next 가 **키를 그대로 그린다**. 정적 가드는 이런 **동적 키**(템플릿 리터럴)를
//   구조적으로 못 본다 — 프리픽스만 알고 뒤가 런타임 값이라 대조할 대상이 없다.
//   그래서 판정을 화면으로 옮긴다: "무엇이 보이는가" (memory feedback_measure_the_screen_not_innertext).
//
//   키 모양: 점으로 이어진 영문 식별자 (예: status.active, tab.docs, filter.kind.all).
//   오탐을 줄이려고 도메인·파일명·버전·URL·이메일은 뺀다.
const b = require('./lib/browser');

const ROUTES = ['/dashboard', '/projects', '/tasks', '/mail', '/docs', '/files', '/clients', '/calendar', '/bill'];
// ★ 폰과 데스크탑을 **둘 다** 잰다. 처음엔 1440 만 쟀는데, 그 폭에서 프로젝트는 표(리스트)로
//   그려져 상태 칩이 아예 없다 — 버그(`status.active`)는 폰 카드뷰에만 있었고 검사기는
//   초록을 냈다. 양성 대조군(키를 지우고 다시 재기)이 안 뒤집혀서 잡았다.
//   (memory feedback_measure_with_same_lens_as_code · "축을 좁히면 F=1 이 거짓말이 된다")
const VPS = [
  { name: '폰390', width: 390, height: 780, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { name: '데스크탑1440', width: 1440, height: 900 },
];

// 점으로 이어진 소문자 시작 식별자 2~4마디. 확장자·도메인·버전은 제외.
const KEYISH = /^[a-z][A-Za-z0-9_]*(\.[a-z][A-Za-z0-9_]*){1,3}$/;
// 파일명·도메인은 키가 아니다 — 파일 목록에 `autoinstaller3.log` 가 있어 오탐이 났다(실측).
const DENY = /\.(com|net|org|kr|io|co|dev|png|jpg|jpeg|gif|svg|pdf|js|mjs|ts|tsx|css|json|html|htm|txt|log|md|csv|zip|tar|gz|xls|xlsx|doc|docx|ppt|pptx|hwp|mp3|mp4|wav|m4a)$/i;

async function run() {
  const results = [];
  const { browser, page } = await b.launch();
  try {
    await b.login(page);
    for (const vp of VPS) {
    await page.setViewport({ width: vp.width, height: vp.height, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch, deviceScaleFactor: vp.deviceScaleFactor || 1 });
    for (const route of ROUTES) {
      await b.goto(page, route);
      await b.sleep(2200);
      const hits = await page.evaluate((src, deny) => {
        const re = new RegExp(src);
        const dre = new RegExp(deny, 'i');
        const out = [];
        const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = walk.nextNode())) {
          const t = (n.textContent || '').trim();
          if (!t || t.length > 60 || t.includes(' ')) continue;
          if (!re.test(t) || dre.test(t)) continue;
          const el = n.parentElement;
          if (!el) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;   // 안 그려지는 것은 세지 않는다
          out.push(t);
        }
        return Array.from(new Set(out));
      }, KEYISH.source, DENY.source);
      results.push({
        name: `rawkey ${vp.name}${route}`,
        fail: hits.length ? 1 : 0,
        details: hits.length ? [`번역 키가 화면에 노출: ${hits.slice(0, 8).join(', ')}${hits.length > 8 ? ` 외 ${hits.length - 8}` : ''}`] : ['노출 0'],
      });
    }
    }
  } finally { await browser.close(); }
  return results;
}

module.exports = { name: 'rawkey', run };

if (require.main === module) {
  run().then((rs) => {
    let bad = 0;
    rs.forEach((r) => { if (r.fail) bad++; console.log(`${r.fail ? '❌' : '✅'} ${r.name} — ${r.details[0]}`); });
    process.exit(bad ? 1 : 0);
  }).catch((e) => { console.error('🔴 하니스 오류:', e.message); process.exit(2); });
}
