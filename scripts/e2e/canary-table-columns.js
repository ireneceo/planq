// canary-table-columns — 업무 목록 열 좌우 이동·폭 조절 (2026-10-27 · Fable 설계 GO · hooks/useTableColumns)
//
//   Irene: «모든 표들 다 열을 좌우로 이동할 수 있어야 하는 거 아니야? … 제목이 잘려보이는게 제일 속터져.»
//   재는 것(Fable 검증 설계 6절):
//     ① 머리 칸 ↔ 첫·마지막 행 칸 left·width 차이 ≤1px — Q task(1440·1280·1024·800 × 패널 열림/접힘 × 내 이번 주/전체 업무) · 프로젝트 업무(4폭)
//        양성 대조군: 행 칸 하나에 폭 +10px 을 심으면 판정이 뒤집혀야 한다
//     ② 끌기: «예측» 을 «상태» 앞으로 → 머리·행 순서가 같이 바뀜 · 새로 고침해도 남음 · 정렬은 안 바뀜 · 열 설정 «기본으로 되돌리기» 로 원래 순서
//        5px 미만 클릭은 정렬이 바뀐다(음성 대조)
//     ③ 폭: 손잡이 +40 → 머리·행 둘 다 +40 · 최대에서 멈춤 · 두 번 누르면 기본 · 키보드 → 3번 = +24
//     ④ 1024 + 패널 열림 + 모든 폭 최대 저장 → 업무 칸 ≥ 최소폭 · 자동으로 빠진 열이 열 설정에 «좁아서 숨겨짐» · 제목이 실제로 보임(elementFromPoint)
//     ⑤ 폰 390: 머리줄 없음 · 문서 가로 넘침 0 · 저장값 무시
//     ⑥ 깨진 저장값(쓰레기 JSON·모르는 키·폭 99999·업무 칸 숨김) → 화면이 그려지고 업무 칸 보임
const b = require('./lib/browser');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OWNER = { email: 'owner@test.planq.kr', password: 'Test1234!' };
const PROJECT_ID = Number(process.env.E2E_TABLECOLS_PROJECT || 35); // ws6 업무가 가장 많은 프로젝트
const results = [];
const push = (name, pass, detail) => { results.push({ name, fail: !pass, details: detail ? [detail] : [] }); if (require.main === module) console.log(`${pass ? "✅" : "❌"} ${name}${!pass && detail ? " — " + detail : ""}`); };

// 계정별 저장(서버) — 검사 전후 표 값을 서버에서 바로 맞춘다(2026-10-27 Irene «권고대로» 계정별)
let TOKEN = null;
async function api(tableId, prefs) {
  if (!TOKEN) {
    const r = await fetch(`${b.BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(OWNER) });
    TOKEN = (await r.json())?.data?.token;
  }
  const r = await fetch(`${b.BASE}/api/businesses/6/me/table-prefs`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ table_id: tableId, prefs }) });
  return r.status;
}
const resetAll = async () => { for (const t of ['qtask-list', 'project-tasks', 'project-tasks-timeline']) await api(t, null); };

async function openPage(width, height = 900) {
  const { browser } = await b.launch();
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  await page.setViewport({ width, height });
  await b.login(page, OWNER);
  return { browser, page };
}
async function go(page, path, clearPrefs = true) {
  await page.goto(`${b.BASE}${path}`, { waitUntil: 'domcontentloaded' });
  if (clearPrefs) {
    await resetAll();
    await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('pq_table_')) localStorage.removeItem(k); });
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
  await page.waitForSelector('[data-col-key]', { timeout: 20000 }).catch(() => null);
  await b.dismissBlockers(page).catch(() => {});
  await sleep(1500);
}

// 머리 칸과 행 칸 정렬 — 머리줄을 품은 목록 안에서
const alignment = (page) => page.evaluate(() => {
  const head = document.querySelector('[data-col-key]')?.parentElement;
  if (!head) return { err: 'no-header' };
  const heads = Array.from(head.querySelectorAll('[data-col-key]')).filter(e => e.getBoundingClientRect().width > 0);
  const rows = Array.from(document.querySelectorAll('[data-task-row]')).filter(r => r.getBoundingClientRect().height > 0 && r.querySelector('[data-col]'));
  if (!rows.length) return { err: 'no-rows', heads: heads.length };
  const pick = [rows[0], rows[rows.length - 1]];
  let worst = 0; const bad = [];
  for (const h of heads) {
    const k = h.dataset.colKey; const hr = h.getBoundingClientRect();
    for (const r of pick) {
      const c = r.querySelector(`[data-col="${k}"]`);
      if (!c) { bad.push(`${k}:행에 없음`); worst = 999; continue; }
      const cr = c.getBoundingClientRect();
      const d = Math.max(Math.abs(cr.left - hr.left), Math.abs(cr.width - hr.width));
      if (d > worst) worst = d;
      if (d > 1) bad.push(`${k}:${hr.left.toFixed(0)}/${hr.width.toFixed(0)} vs ${cr.left.toFixed(0)}/${cr.width.toFixed(0)}`);
    }
    // 행에만 있는 칸
  }
  const extra = Array.from(pick[0].querySelectorAll('[data-col]')).map(e => e.dataset.col).filter(k => !heads.some(h => h.dataset.colKey === k));
  return { worst, bad, heads: heads.map(h => h.dataset.colKey), extra, rows: rows.length };
});
const order = (page) => page.evaluate(() => {
  const head = document.querySelector('[data-col-key]')?.parentElement;
  const h = Array.from(head?.querySelectorAll('[data-col-key]') || []).map(e => e.dataset.colKey);
  const row = document.querySelector('[data-task-row]');
  const r = Array.from(row?.querySelectorAll('[data-col]') || []).map(e => e.dataset.col);
  return { h, r };
});
const rectOf = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }, sel);
const firstTitles = (page) => page.evaluate(() => Array.from(document.querySelectorAll('[data-task-row]')).slice(0, 5).map(r => r.textContent.slice(0, 30)).join('|'));

async function togglePanel(page) {
  const btn = await page.$('[aria-label*="패널 접기"],[aria-label*="Collapse panel"]');
  if (!btn) return false;
  await btn.click(); await sleep(900); return true;
}

async function run() {
  await resetAll();
  // ① 정렬 — Q task
  for (const w of [1440, 1280, 1024, 800]) {
    const { browser, page } = await openPage(w);
    try {
      for (const path of ['/tasks?tab=week', '/tasks/workspace?tab=workspace-tasks']) {
        await go(page, path);
        for (const panel of ['열림', '접힘']) {
          if (panel === '접힘') { const ok = await togglePanel(page); if (!ok) continue; } // 좁은 폭은 우측 패널이 겹쳐 뜨는 방식이라 접기 손잡이가 없다
          const a = await alignment(page);
          push(`① Q task ${w} ${path} 패널 ${panel} — 머리·행 어긋남 ≤1px (최대 ${a.worst ?? '-'} · 열 ${a.heads?.join(',')}${a.extra?.length ? ' · 행에만 ' + a.extra : ''})`, !a.err && a.worst <= 1 && !a.extra.length, a.err || a.bad.slice(0, 4).join(' ; '));
        }
        // 패널 다시 열기(다음 경로용)
        await togglePanel(page).catch(() => {});
        const exp = await page.$('[aria-label*="패널 열기"],[aria-label*="Expand panel"]'); if (exp) { await exp.click(); await sleep(600); }
      }
      if (w === 1440) {
        // 양성 대조군 — 행 칸 하나에 폭 +10px
        await go(page, '/tasks?tab=week');
        await page.evaluate(() => { const c = document.querySelector('[data-task-row] [data-col="dates"]'); if (c) { c.style.flex = `0 0 ${c.getBoundingClientRect().width + 10}px`; c.style.width = `${c.getBoundingClientRect().width + 10}px`; } });
        const a = await alignment(page);
        push(`① 양성 대조군: 행 칸 +10px 심으면 판정이 뒤집힘 (최대 ${a.worst})`, a.worst > 1);
      }
    } finally { await browser.close().catch(() => {}); }
  }
  // ① 정렬 — 프로젝트 업무
  for (const w of [1440, 1280, 1024, 800]) {
    const { browser, page } = await openPage(w);
    try {
      await go(page, `/projects/p/${PROJECT_ID}?tab=tasks`);
      const a = await alignment(page);
      push(`① 프로젝트 업무 ${w} — 머리·행 어긋남 ≤1px (최대 ${a.worst ?? '-'} · 열 ${a.heads?.join(',')})`, !a.err && a.worst <= 1 && !a.extra.length, a.err || a.bad.slice(0, 4).join(' ; '));
    } finally { await browser.close().catch(() => {}); }
  }

  // ②③ 끌기·폭 — Q task 1440, 패널 접힘(열 전부 보이게)
  {
    const { browser, page } = await openPage(1440);
    try {
      await go(page, '/tasks?tab=all');
      await togglePanel(page);
      const o0 = await order(page);
      const sortBefore = await firstTitles(page);
      const est = await rectOf(page, '[data-col-key="est"]');
      const st = await rectOf(page, '[data-col-key="status"]');
      await page.mouse.move(est.x + est.w / 2, est.y + est.h / 2);
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) { await page.mouse.move(est.x + est.w / 2 + ((st.x + 4) - (est.x + est.w / 2)) * i / 10, est.y + est.h / 2); await sleep(30); }
      await page.mouse.up(); await sleep(1800);   // 300ms 모음 + 400ms 모음 + 서버 왕복
      const o1 = await order(page);
      const iE = o1.h.indexOf('est'), iS = o1.h.indexOf('status');
      push(`② 끌기: «예측» 이 «상태» 앞으로 (머리 ${o1.h.join(',')})`, iE >= 0 && iE < iS, `전 ${o0.h.join(',')}`);
      push('② 끌기: 행 칸 순서도 같이', JSON.stringify(o1.h) === JSON.stringify(o1.r), `행 ${o1.r.join(',')}`);
      push('② 끌기 뒤 정렬은 안 바뀜(클릭 삼킴)', (await firstTitles(page)) === sortBefore);
      await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('[data-col-key]'); await sleep(1500);
      const o2 = await order(page);
      push('② 새로 고침해도 순서 남음', JSON.stringify(o2.h) === JSON.stringify(o1.h), o2.h.join(','));
      // 계정별: 이 브라우저 저장소를 비운 «다른 기기» 에서도 같은 순서
      {
        const other = await openPage(1440);
        try {
          await go(other.page, '/tasks?tab=all', false);
          const local = await other.page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('pq_table_')).length);
          const oo = await order(other.page);
          push(`② 다른 기기(새 브라우저 · 이 기기 저장 ${local}개)에서도 같은 순서`, local === 0 && JSON.stringify(oo.h) === JSON.stringify(o1.h), oo.h.join(','));
        } finally { await other.browser.close().catch(() => {}); }
      }
      await togglePanel(page);
      // 5px 미만 클릭 = 정렬(음성 대조)
      const before2 = await firstTitles(page);
      const ti = await rectOf(page, '[data-col-key="title"]');
      await page.mouse.click(ti.x + ti.w / 2, ti.y + ti.h / 2); await sleep(900);
      const after2 = await firstTitles(page);
      push('② 짧은 클릭은 정렬이 바뀜(음성 대조)', before2 !== after2);

      // ③ 폭 손잡이 — 실제(h). 마지막 칸(기간) 손잡이는 화면 가운데 높이에서 우측 패널 접기 손잡이(FloatingPanelToggle)와 겹친다 — 보고에 남김
      const d0 = await rectOf(page, '[data-col-key="act"]');
      const hd = await rectOf(page, '[data-col-resize="act"]');
      await page.mouse.move(hd.x + hd.w / 2, hd.y + hd.h / 2); await page.mouse.down();
      for (let i = 1; i <= 8; i++) { await page.mouse.move(hd.x + hd.w / 2 + 5 * i, hd.y + hd.h / 2); await sleep(25); }
      await page.mouse.up(); await sleep(500);
      const d1 = await rectOf(page, '[data-col-key="act"]');
      const r1 = await rectOf(page, '[data-task-row] [data-col="act"]');
      push(`③ 손잡이 +40 → 머리 ${Math.round(d0.w)}→${Math.round(d1.w)} · 행 ${Math.round(r1.w)}`, Math.abs(d1.w - d0.w - 40) <= 1 && Math.abs(r1.w - d1.w) <= 1);
      // 최대에서 멈춤(200)
      const hd2 = await rectOf(page, '[data-col-resize="act"]');
      await page.mouse.move(hd2.x + hd2.w / 2, hd2.y + hd2.h / 2); await page.mouse.down();
      await page.mouse.move(hd2.x + 400, hd2.y + hd2.h / 2, { steps: 10 }); await page.mouse.up(); await sleep(400);
      const d2 = await rectOf(page, '[data-col-key="act"]');
      push(`③ 최대에서 멈춤 (${Math.round(d2.w)} = 120)`, Math.round(d2.w) === 120);
      // 두 번 누르면 기본
      const hd3 = await rectOf(page, '[data-col-resize="act"]');
      await page.mouse.click(hd3.x + hd3.w / 2, hd3.y + hd3.h / 2, { clickCount: 2 }); await sleep(400);
      const d3 = await rectOf(page, '[data-col-key="act"]');
      push(`③ 두 번 누르면 기본 폭 (${Math.round(d3.w)} = 62)`, Math.round(d3.w) === 62);
      // 키보드 → ×3 = +24
      await page.focus('[data-col-resize="act"]');
      for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
      await sleep(300);
      const d4 = await rectOf(page, '[data-col-key="act"]');
      push(`③ 키보드 → 3번 = +24 (${Math.round(d4.w)} = 86)`, Math.round(d4.w) === 86);

      // 열 설정 → 기본으로 되돌리기
      await page.click('[data-testid="qtask-columns"]'); await sleep(400);
      await page.click('[data-testid="qtask-columns-reset"]'); await sleep(500);
      const o3 = await order(page);
      const d5 = await rectOf(page, '[data-col-key="dates"]');
      push(`② 기본으로 되돌리기 → 처음 순서·폭 (${o3.h.join(',')} · 기간 ${Math.round(d5.w)})`, JSON.stringify(o3.h) === JSON.stringify(o0.h) && Math.round(d5.w) === 100);
      // 열 숨기기(체크) — 예측 끄기 → 머리·행에서 빠짐
      await page.click('[data-testid="qtask-columns-row-est"] input'); await sleep(400);
      const o4 = await order(page);
      push('열 설정: «예측» 끄면 머리·행 둘 다에서 빠짐', !o4.h.includes('est') && !o4.r.includes('est'));
      const titleLocked = await page.$eval('[data-testid="qtask-columns-row-title"] input', (e) => e.disabled).catch(() => null);
      push('열 설정: 업무 칸은 숨기기 잠김', titleLocked === true);
      await page.click('[data-testid="qtask-columns-reset"]'); await sleep(300);
    } finally { await browser.close().catch(() => {}); }
  }

  // ④ 1024 + 패널 열림 + 모든 폭 최대
  {
    const { browser, page } = await openPage(1024);
    try {
      await go(page, '/tasks/workspace?tab=workspace-tasks');
      await api('qtask-list', { order: [], hidden: [], widths: { project: 240, assignee: 200, status: 200, est: 120, act: 120, progress: 220, dates: 200 } });
      await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('[data-col-key]'); await sleep(1800);
      const r = await page.evaluate(() => {
        const t = document.querySelector('[data-task-row] [data-col="title"]');
        const tt = t?.querySelector('[data-testid="qtask-row-title"], span');
        const rr = t?.getBoundingClientRect();
        const hit = rr ? document.elementFromPoint(rr.left + Math.min(60, rr.width / 2), rr.top + rr.height / 2) : null;
        return { w: t?.clientWidth || 0, hit: !!(hit && t.contains(hit)), heads: Array.from(document.querySelectorAll('[data-col-key]')).map(e => e.dataset.colKey), tt: !!tt };
      });
      push(`④ 1024+패널+최대 폭: 업무 칸 ${r.w}px ≥ 180 · 제목 보임 (열 ${r.heads.join(',')})`, r.w >= 180 && r.hit);
      await page.click('[data-testid="qtask-columns"]'); await sleep(400);
      const autoTxt = await page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"]')).map(d => d.textContent).join(' '));
      push('④ 자동으로 빠진 열이 열 설정에 «좁아서 숨겨짐»', /좁아서 숨겨짐|too narrow/.test(autoTxt));
    } finally { await browser.close().catch(() => {}); }
  }

  // ⑤ 폰 390 · ⑥ 깨진 저장값
  {
    const { browser, page } = await openPage(390, 844);
    try {
      await go(page, '/tasks?tab=all');
      await api('qtask-list', { order: ['dates', 'title'], hidden: ['title'], widths: { dates: 99999 } });
      await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);
      const r = await page.evaluate(() => {
        const head = document.querySelector('[data-col-key]');
        return {
          headVisible: !!head && head.getBoundingClientRect().height > 0,
          over: document.documentElement.scrollWidth - window.innerWidth,
          titleCells: Array.from(document.querySelectorAll('[data-task-row] [data-col="title"]')).filter(e => e.getBoundingClientRect().width > 200).length,
          rows: document.querySelectorAll('[data-task-row]').length,
        };
      });
      push(`⑤ 폰 390: 머리줄 안 보임 · 가로 넘침 ${r.over}px · 제목 칸 ${r.titleCells}/${r.rows}`, !r.headVisible && r.over <= 0 && r.rows > 0 && r.titleCells === r.rows);
    } finally { await browser.close().catch(() => {}); }
  }
  {
    const { browser, page } = await openPage(1440);
    try {
      await go(page, '/tasks?tab=all');
      await page.evaluate(() => localStorage.setItem('pq_table_qtask-list', '{not json'));
      await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('[data-col-key]', { timeout: 15000 }).catch(() => null); await sleep(1500);
      const a = await order(page);
      await api('qtask-list', { order: ['zzz', 'dates', 'title'], hidden: ['title', 'nope'], widths: { dates: 99999, zzz: 5 } });
      await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('[data-col-key]', { timeout: 15000 }).catch(() => null); await sleep(1500);
      const o = await order(page);
      const dw = await rectOf(page, '[data-col-key="dates"]');
      // 계정별 전환 전 이 브라우저 값 — 한 번 서버로 올라가고 지워진다
      await resetAll();
      await page.evaluate(() => localStorage.setItem('pq_table_qtask-list', JSON.stringify({ v: 1, order: ['dates', 'title'], hidden: [], widths: {} })));
      await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('[data-col-key]', { timeout: 15000 }).catch(() => null); await sleep(2000);
      const mig = await page.evaluate(() => localStorage.getItem('pq_table_qtask-list'));
      const meR = await fetch(`${b.BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${TOKEN}` } }); const meJ = await meR.json();
      const up = meJ?.data?.table_prefs?.tables?.['qtask-list']?.order || [];
      push(`⑦ 옛 기기 저장값 → 서버로 한 번 올라가고 이 브라우저에서 지워짐 (서버 ${up.join(',')} · 남은 값 ${mig ? '있음' : '없음'})`, !mig && up.indexOf('dates') >= 0 && up.indexOf('dates') < up.indexOf('title'));
      push(`⑥ 깨진 JSON → 기본 배치로 그림 (${a.h.join(',')})`, a.h.includes('title') && a.h.length >= 7);
      push(`⑥ 모르는 키·폭 99999·업무 숨김 → 업무 보임 · 기간 200 으로 자름 · 저장 순서(기간 → 업무) 유지 (${o.h.join(',')} · ${Math.round(dw?.w || 0)})`, o.h.includes('title') && !o.h.includes('zzz') && Math.round(dw?.w || 0) === 200 && o.h.indexOf('dates') < o.h.indexOf('title'));
      await page.evaluate(() => localStorage.removeItem('pq_table_qtask-list'));
      await resetAll();
    } finally { await browser.close().catch(() => {}); }
  }
  await resetAll();
  return results;
}

module.exports = { name: '업무 목록 열 좌우 이동·폭 조절 — 머리·행 정렬 · 끌기 · 폭 · 자동 빠짐 · 폰 · 깨진 저장값', run };
if (require.main === module) run().then((r) => { let f = 0; for (const x of r) { console.log(`${x.fail ? '❌' : '✅'} ${x.name}${x.details.length && x.details[0] ? '\n     ' + x.details.join('\n     ') : ''}`); if (x.fail) f++; } console.log(`\n${r.length - f}/${r.length} 통과`); process.exit(f ? 1 : 0); });
