// canary-modal-top — 모달은 **어떤 층 안에서도 최상위로 보여야 한다** (2026-09-07)
//
//   Irene 신고: "출근으로 기록한다는 알림이 … 우측패널 뒤로 떠. 모든 팝업은 무조건 최상위 아니야?"
//   원인: 자동 출근 모달은 사이드바(AttendanceWidget) 안에서 그려졌고, 사이드바는
//         `position:fixed; z-index:100`(+ 태블릿 이하 `transform`) 이라 **층을 만든다**.
//         그 안의 z-index 1100 은 페이지 기준 100 이라 업무 상세 드로어(130) 뒤로 깔린다.
//   그래서 여기서는 숫자를 재지 않는다 — **그 좌표에서 실제로 무엇이 잡히는지**를 잰다.
//   (memory feedback_measure_the_screen_not_innertext)
const b = require('./lib/browser');

const TASK_ID = Number(process.env.E2E_MODAL_TASK || 1978);
const BIZ_ID = Number(process.env.E2E_MODAL_BIZ || 5);

const VPS = [
  { name: '데스크탑 1440', w: 1440, h: 900 },
  { name: '태블릿 900', w: 900, h: 1000 },
  // ★ 2026-09-07 (Irene: "태블릿 세로 좌측메뉴 열었더니 출근으로 처리한다는 팝업이
  //   좌측메뉴 안에 들어있었어") — **사이드바를 연 채로** 잰다. 그 폭에서 사이드바는
  //   `transform` 으로 미끄러져 들어오는데, transform 은 containing block 을 만들어
  //   그 안의 `position:fixed` 를 가둔다. 포털이 풀리면 정확히 이 조합에서 되살아난다.
  { name: '태블릿세로 768(메뉴 열림)', w: 768, h: 1024, openSidebar: true },
  { name: '태블릿세로 1024(메뉴 열림)', w: 1024, h: 1366, openSidebar: true },
  { name: '폰 390', w: 390, h: 780 },
];

/** 앱 안에서 인증 API 호출 */
async function api(page, path, init) {
  return page.evaluate(async (p, i) => {
    const tok = window.__pqGetToken ? window.__pqGetToken() : null;
    const r = await fetch(p, {
      ...i,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok, ...(i && i.headers) },
    });
    let j = null; try { j = await r.json(); } catch { /* 본문 없음 */ }
    return { status: r.status, ok: r.ok, body: j };
  }, path, init || {});
}

/** 화면에 떠 있는 자동 출근 모달을 좌표로 판정한다 */
function probe() {
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]'));
  const el = dialogs.find((d) => /출근으로 기록|Clocked in|clock/i.test(d.getAttribute('aria-label') || d.innerText || ''));
  if (!el) return { found: false, dialogs: dialogs.length };

  const r = el.getBoundingClientRect();
  // 조상 체인 — 층을 만드는 조상(fixed/z-index/transform)과 클리핑 조상을 모두 적는다
  const chain = [];
  let clipped = false;
  for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
    const cs = getComputedStyle(p);
    const stacking = (cs.position !== 'static' && cs.zIndex !== 'auto') || cs.transform !== 'none'
      || cs.filter !== 'none' || cs.contain !== 'none' || cs.willChange !== 'auto';
    if (stacking || cs.overflow !== 'visible') {
      chain.push(`${p.tagName.toLowerCase()}.${(p.className || '').toString().split(' ')[0]}` +
        ` {pos:${cs.position} z:${cs.zIndex} tf:${cs.transform === 'none' ? 'none' : 'yes'} ov:${cs.overflow}}`);
    }
    if (cs.overflow !== 'visible' && cs.overflow !== '') {
      const pr = p.getBoundingClientRect();
      if (r.left < pr.left - 1 || r.top < pr.top - 1 || r.right > pr.right + 1 || r.bottom > pr.bottom + 1) clipped = true;
    }
  }
  // 진짜로 보이는가 — 모달 중앙에서 실제로 잡히는 요소가 모달 안쪽인지
  const cx = Math.round(r.left + r.width / 2);
  const cy = Math.round(r.top + r.height / 2);
  const hit = document.elementFromPoint(cx, cy);
  const hitInside = !!hit && el.contains(hit);
  const hitDesc = hit ? `${hit.tagName.toLowerCase()}.${(hit.className || '').toString().split(' ')[0]}` : 'null';

  // 백드롭이 뷰포트를 덮는가
  const bd = el.parentElement;
  const br = bd ? bd.getBoundingClientRect() : null;
  const coversViewport = !!br && br.width >= window.innerWidth - 2 && br.height >= window.innerHeight - 2;

  // 하단 라운드 — Footer 가 Dialog 의 14px 를 사각 배경으로 덮고 있었다
  const footer = el.lastElementChild;
  const fr = footer ? getComputedStyle(footer) : null;

  return {
    found: true,
    rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    parentIsBody: bd ? bd.parentElement === document.body : false,
    stackingAncestors: chain,
    clipped,
    hitInside, hitDesc,
    coversViewport,
    backdropRect: br ? { w: Math.round(br.width), h: Math.round(br.height) } : null,
    footerRadius: fr ? fr.borderBottomLeftRadius + ' / ' + fr.borderBottomRightRadius : null,
    dialogRadius: getComputedStyle(el).borderBottomLeftRadius,
  };
}

async function run() {
  const raw = [];
  const results = [];
  const { browser, page } = await b.launch();
  try {
    await b.login(page);
    await b.goto(page, '/tasks');

    // ─── 준비: 오늘 근태를 비우고, 업무를 '진행중' 으로 올려 자동 출근을 실제로 발생시킨다 ───
    await api(page, '/api/attendance/undo-auto-clock-in', { method: 'POST', body: JSON.stringify({ business_id: BIZ_ID }) });
    await api(page, `/api/tasks/by-business/${BIZ_ID}/${TASK_ID}`, { method: 'PUT', body: JSON.stringify({ status: 'not_started' }) });
    await api(page, '/api/attendance/undo-auto-clock-in', { method: 'POST', body: JSON.stringify({ business_id: BIZ_ID }) });
    const put = await api(page, `/api/tasks/by-business/${BIZ_ID}/${TASK_ID}`, { method: 'PUT', body: JSON.stringify({ status: 'in_progress' }) });
    const today = await api(page, `/api/attendance/today?business_id=${BIZ_ID}`);
    const notice = today.body?.data?.auto_notice || null;
    raw.push({
      name: 'seed/자동출근 발생', ok: !!notice,
      msg: notice ? `PUT ${put.status} → auto_notice at=${notice.at} can_undo=${notice.can_undo}`
                  : `자동 출근 알림이 안 만들어졌다 (PUT ${put.status}, today=${JSON.stringify(today.body?.data?.state)})`,
    });
    if (!notice) return { results, browser };

    for (const vp of VPS) {
      await page.setViewport({ width: vp.w, height: vp.h });
      // 확인 박제를 지워 매 뷰포트마다 같은 조건에서 뜨게 한다
      await page.evaluate(() => { try { localStorage.removeItem('planq.attn.autoSeen'); } catch { /* private */ } });
      // 업무 상세(우측 패널)를 연 채로 — 신고 상황 그대로
      await b.goto(page, `/tasks?task=${TASK_ID}`);
      await b.sleep(2500);
      if (vp.openSidebar) {
        await page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll('button'))
            .find((e) => /메뉴|사이드바|menu/i.test(e.getAttribute('aria-label') || ''));
          if (btn) btn.click();
        });
        await b.sleep(1200);
      }

      const p = await page.evaluate(probe);
      if (!p.found) {
        raw.push({ name: `${vp.name}/모달 표시`, ok: false, msg: `모달이 화면에 없다 (aria-modal ${p.dialogs}개)` });
        continue;
      }
      raw.push({
        name: `${vp.name}/최상위`, ok: p.hitInside && !p.clipped,
        msg: p.hitInside && !p.clipped
          ? `중앙(${p.rect.x + p.rect.w / 2 | 0},${p.rect.y + p.rect.h / 2 | 0})에서 모달이 잡힌다 · 클리핑 없음 · 백드롭 ${p.backdropRect.w}×${p.backdropRect.h}`
          : `가려짐 — 중앙에서 잡힌 것: ${p.hitDesc} · 클리핑 ${p.clipped} · 층 조상 [${p.stackingAncestors.join(' < ')}]`,
      });
      raw.push({
        name: `${vp.name}/body 직속`, ok: p.parentIsBody,
        msg: p.parentIsBody ? '백드롭이 body 직속 (포털)' : `백드롭이 body 밖 — 층 조상 [${p.stackingAncestors.join(' < ')}]`,
      });
      raw.push({
        name: `${vp.name}/하단 라운드`, ok: p.footerRadius === (vp.w <= 640 ? '0px / 0px' : '14px / 14px'),
        msg: `footer ${p.footerRadius} (dialog ${p.dialogRadius})`,
      });

      // ★ 양성 대조군 — Irene 이 본 증상 그대로 잰다: **우측 상세 패널 위에서 무엇이 잡히는가.**
      //   모달의 중앙만 재면 데스크탑에서는 겹치는 것이 없어 뒤집히지 않는다 —
      //   가려짐은 **겹치는 자리에서만** 드러난다(memory feedback_measure_with_same_lens_as_code).
      //   백드롭을 층 조상 안으로 옮겨 옛 상태를 되살렸을 때 판정이 뒤집혀야 검사기가 유효하다.
      const ctrl = await page.evaluate(() => {
        const d = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]'))
          .find((x) => /출근으로 기록|clock/i.test(x.getAttribute('aria-label') || x.innerText || ''));
        const bd = d && d.parentElement;
        if (!bd) return null;
        // 우측 상세 패널 = position:fixed + right 가 0 이고 화면 전폭이 아닌 것
        const panel = Array.from(document.querySelectorAll('div,aside,section')).find((e) => {
          if (bd.contains(e) || e.contains(bd)) return false;
          const cs = getComputedStyle(e);
          if (cs.position !== 'fixed') return false;
          const r = e.getBoundingClientRect();
          // 폰에서는 상세 드로어가 100vw 라 "전폭이 아닐 것" 조건을 걸면 못 찾는다.
          const narrow = window.innerWidth <= 640;
          return r.width > 200 && (narrow || r.width < window.innerWidth - 40)
            && r.height > window.innerHeight * 0.5 && Math.abs(r.right - window.innerWidth) < 2;
        });
        if (!panel) return { why: '우측 상세 패널 미발견' };
        const pr = panel.getBoundingClientRect();
        const px = Math.round(pr.left + pr.width / 2);
        const py = Math.round(pr.top + pr.height / 2);
        const inModalLayer = (el) => !!el && (bd === el || bd.contains(el));
        const before = inModalLayer(document.elementFromPoint(px, py));

        // 옛 상태 복원 — 층을 만드는 조상 안으로 되돌린다
        const layer = Array.from(document.querySelectorAll('div,aside,nav')).filter((e) => {
          const cs = getComputedStyle(e);
          const z = parseInt(cs.zIndex, 10);
          return cs.position === 'fixed' && Number.isFinite(z) && z > 0 && z < 1100;
        }).sort((a, x) => parseInt(getComputedStyle(a).zIndex, 10) - parseInt(getComputedStyle(x).zIndex, 10))[0];
        if (!layer) return { why: '층 조상 미발견', before };
        layer.appendChild(bd);
        const after = inModalLayer(document.elementFromPoint(px, py));
        return { before, after, point: [px, py], layerZ: getComputedStyle(layer).zIndex, panelW: Math.round(pr.width) };
      });
      raw.push({
        name: `${vp.name}/양성 대조군`, ok: !!ctrl && ctrl.before === true && ctrl.after === false,
        msg: !ctrl || ctrl.why
          ? `대조군을 못 만들었다 — ${ctrl ? ctrl.why : '모달 미발견'}`
          : (ctrl.before && !ctrl.after
              ? `우측 패널 위 (${ctrl.point}) — 지금은 모달이 잡히고, z-index ${ctrl.layerZ} 층 안으로 되돌리면 가려진다 · 검사기 유효`
              : `🔴 before=${ctrl.before} after=${ctrl.after} — 판정이 안 뒤집힌다`),
      });

      await page.screenshot({ path: `/tmp/claude-1000/-opt-planq/a6a2cd14-2506-43c5-b7f3-3d47090a88c4/scratchpad/modal-${vp.w}.png` });
    }
  } finally {
    // ─── 원복 — 남의 데이터를 바꿔 놓고 끝내지 않는다 ───
    await api(page, '/api/attendance/undo-auto-clock-in', { method: 'POST', body: JSON.stringify({ business_id: BIZ_ID }) }).catch(() => null);
    await api(page, `/api/tasks/by-business/${BIZ_ID}/${TASK_ID}`, { method: 'PUT', body: JSON.stringify({ status: 'not_started' }) }).catch(() => null);
  }
  return finish(raw, results, browser);
}

/** 러너 계약({ name, fail, details })으로 옮기고 브라우저를 닫는다 —
 *  단독 실행만 빨갛고 스위트는 영원히 초록이던 전례를 막는다
 *  (memory feedback_canary_must_match_runner_contract). */
async function finish(raw, results, browser) {
  for (const r of raw) results.push({ name: r.name, fail: r.ok ? 0 : 1, details: [r.msg] });
  await browser.close().catch(() => null);
  return results;
}

module.exports = { name: 'modaltop', run };

if (require.main === module) {
  run().then((results) => {
    let bad = 0;
    for (const r of results) { if (r.fail) bad++; console.log(`${r.fail ? '❌' : '✅'} ${r.name} — ${r.details[0]}`); }
    console.log(bad ? `
실패 ${bad}/${results.length}` : `
통과 ${results.length}/${results.length}`);
    process.exit(bad ? 1 : 0);
  }).catch((e) => { console.error('🔴 하니스 오류:', e.message); process.exit(2); });
}
