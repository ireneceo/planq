// scripts/e2e/canary-project-tab-style.js — 프로젝트 상세의 **탭들이 같은 디자인인가**.
//
// ★ 2026-09-18 신고 (Irene): *"노트탭 프로젝트에 있는 건 Q note랑 다른 스타일이어야 해.
//   프로젝트 > 문서와 같은 스타일의 디자인으로 하라고 전에 요청했는데 왜 안한거야."*
//   · *"디자인 스타일이 다르다고 프로젝트 탭들은."* · *"왜 자꾸 말하게 하는거야?"*
//
//   ★ **두 번 말하게 만든 이유**: 2026-09-13 에 「노트 탭 = Q Note 본체」를 넣고 «했다» 고 적었는데,
//     문서 탭이 프로젝트 안에서 쓰는 **공용 껍데기**(ProjBrowse: 연회색 바탕 + 20px + 툴바/카드)를
//     안 썼다. 실측(1440px): 문서 `#F8FAFC`/padding 20 · 노트 `#FFFFFF`/padding 0 + 접히는 aside 300px.
//     코드에는 「같은 방식」이라고 적혀 있었지만 **화면은 달랐다** —
//     주석은 사실을 보증하지 않는다(memory `feedback_comment_lies_predicate_drifts`).
//
// ★ 그래서 **글로 적지 말고 기계가 센다.** 탭 본문의 바탕색·안쪽 여백·왼쪽 시작점을 재서
//   **다수와 다른 탭**을 집는다. 손잡이는 `project-tab-body-<키>`(확정 testid) 뿐이고,
//   못 찾은 탭은 «미측정» 으로 실패시킨다 — 못 쟀는데 통과가 가장 나쁘다.
// ★ 폭을 하나만 재면 거짓 통과한다(2026-09-14 프로젝트 탭 실측: 데스크탑만 0, 태블릿 20, 폰 398).
const b = require('./lib/browser');
const { sequelize } = require('/opt/planq/dev-backend/config/database');

const BIZ = Number(process.env.E2E_BUSINESS_ID || 5);
const WIDTHS = [[1440, 900, '데스크탑'], [820, 1180, '태블릿'], [375, 812, '폰']];
// 껍데기를 공유해야 하는 «자료» 탭들. 대시보드·설정 등은 내용이 달라 제외한다.
const TABS = ['docs', 'notes', 'files'];

async function run() {
  const results = [];
  const push = (n, ok, m) => results.push({ name: n, fail: ok ? 0 : 1, details: m ? [m] : [] });

  const [rows] = await sequelize.query(
    'SELECT id FROM projects WHERE business_id = ? ORDER BY id DESC LIMIT 1', { replacements: [BIZ] });
  if (!rows.length) return [{ name: 'canary-project-tab-style', unmeasured: true, details: ['프로젝트 없음'] }];
  const pid = rows[0].id;

  const { browser, page } = await b.launch();
  try {
    await b.login(page);
    for (const [w, h, label] of WIDTHS) {
      await page.setViewport({ width: w, height: h });
      await b.goto(page, `/projects/p/${pid}`);
      await b.sleep(3500);
      const seen = {};
      for (const tab of TABS) {
        await page.evaluate((t) => document.querySelector(`[data-testid="project-tab-${t}"]`)?.click(), tab);
        await b.sleep(2500);
        seen[tab] = await page.evaluate((t) => {
          const root = document.querySelector(`[data-testid="project-tab-body-${t}"]`);
          if (!root) return null;
          // ★ **실제로 칠해진 색**을 «빈 지점에서» 읽는다 (Fable 지적).
          //   앞선 두 판은 ⓐ투명을 지나 자손으로 내려가 **선택 행의 민트색**을 집었고
          //   ⓑ루트/첫자식에서 조상으로 올라가 **그 안을 덮는 셸이 흰색이어도 회색**으로 읽었다.
          //   둘 다 «감싸는 상자를 재는» 계열이다(memory feedback_judge_measures_wrapper_not_defect).
          //   → 탭 본문 안의 **내용이 없는 지점**을 집어 거기 실제로 그려진 요소에서 올라간다.
          const rr = root.getBoundingClientRect();
          const probeX = Math.round(rr.left + rr.width - 6);   // 오른쪽 끝 — 카드/목록이 잘 안 닿는다
          const probeY = Math.round(rr.top + 6);
          let hit = document.elementFromPoint(probeX, probeY);
          if (!hit || !root.contains(hit)) hit = root;
          let el = hit, bg = 'rgba(0, 0, 0, 0)';
          while (el) {
            const c = getComputedStyle(el).backgroundColor;
            if (c && c !== 'rgba(0, 0, 0, 0)') { bg = c; break; }
            el = el.parentElement;
          }
          // ★ 프로젝트 탭은 **자체 사이드바를 두지 않는다** — 그 자리는 이미 탭 막대다.
          const rail = root.querySelector('aside') ? 1 : 0;
          // ★ 내용 시작 여백 — **셸 자신을 빼고** 잰다. 앞선 판은 전폭 셸이 후보에 들어가
          //   언제나 0 이 나와 padding 차이를 영영 못 잡았다(Fable 이 주입으로 증명).
          const shell = root.firstElementChild || root;
          let minX = Infinity;
          shell.querySelectorAll('*').forEach((e) => {
            const q = e.getBoundingClientRect();
            if (q.width > 8 && q.height > 8 && q.width < rr.width - 1) minX = Math.min(minX, q.left);
          });
          return { bg, rail, x: Math.round(rr.left), inset: isFinite(minX) ? Math.round(minX - rr.left) : null };
        }, tab);
      }
      const missing = TABS.filter((t) => !seen[t]);
      if (missing.length) {
        results.push({ name: `${label} 탭 본문`, unmeasured: true, details: [`손잡이 못 찾음: ${missing.join(', ')}`] });
        continue;
      }
      const same = (k) => new Set(TABS.map((t) => String(seen[t][k]))).size === 1;
      const show = (k) => TABS.map((t) => `${t}=${seen[t][k]}`).join(' · ');
      push(`${label} 보이는 바탕색 한 값`, same('bg'), show('bg'));
      push(`${label} 내용 시작 여백 한 값`, same('inset'), show('inset'));
      push(`${label} 탭 본문 시작점 한 값`, same('x'), show('x'));
      push(`${label} 자체 사이드바 없음`, TABS.every((t) => seen[t].rail === 0), show('rail'));
    }
  } finally { try { await browser.close(); } catch { /* ignore */ } }
  return results;
}

module.exports = { run, name: 'canary-project-tab-style' };
