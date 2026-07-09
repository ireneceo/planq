// scripts/e2e/mobile-keyboard.js — 모바일 키보드 가림 스위트
//   각 화면의 입력요소에 focus + 키보드 시뮬(뷰포트 축소) → 가림/점프/가로스크롤 판정.
//   INSPECTION_PLAYBOOK.md §3. 신규 입력화면 추가 시 SCENARIOS 에 1줄 추가.
const b = require('./lib/browser');

// 화면에서 모달 여는 opener. ★ 우선순위: data-testid 클릭 > URL 파라미터(deterministic) > 텍스트(폴백).
//   구 clickFab(위치 휴리스틱)은 불안정(tasks FAB opener 실패)해 제거 — 대신 create 모달은 URL 파라미터로 연다
//   (RightDock handleCreate 가 실제로 /tasks?create=1 등으로 네비게이션하므로 사용자 경로와 동일).
async function clickByText(page, texts) {
  return page.evaluate((texts) => {
    const els = [...document.querySelectorAll('button, [role="button"], a')];
    for (const t of texts) {
      const el = els.find((e) => e.offsetParent !== null && (e.textContent || '').trim().includes(t));
      if (el) { el.click(); return true; }
    }
    return false;
  }, texts);
}
async function clickTestId(page, id) {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (el && el.offsetParent !== null) { el.click(); return true; }
    return false;
  }, id);
}

// 시나리오: path + (선택) open 스텝. open 후 보이는 입력요소 전부 판정.
//   create 모달은 URL 파라미터(?create=1 · ?new=1)로 결정론적 오픈 — path 에 쿼리를 넣으면 goto 시 자동 오픈.
const SCENARIOS = [
  { name: 'clients-search', path: '/business/clients', open: null },
  { name: 'clients-invite', path: '/business/clients', open: (p) => clickTestId(p, 'clients-invite-open').then((ok) => ok || clickByText(p, ['고객 초대', '초대'])) },
  { name: 'qbill-list', path: '/bills', open: null },
  { name: 'bill-new', path: '/bills?tab=invoices&new=1', open: null },  // 청구서 발행 모달(invoices 서브탭 활성 후 URL 자동 오픈)
  { name: 'tasks-week', path: '/tasks', open: null },
  { name: 'tasks-create', path: '/tasks?create=1', open: null },        // 업무 생성 모달(RightDock create 경로와 동일)
  { name: 'inbox', path: '/inbox', open: null },
  { name: 'calendar-add', path: '/calendar?create=1', open: null },     // 새 일정 모달(URL 자동 오픈)
  { name: 'docs', path: '/docs', open: null },
  { name: 'wiki', path: '/wiki', open: null },
  { name: 'settings-profile', path: '/business/settings', open: null },
];

async function run() {
  const results = [];
  const { browser, page } = await b.launch({ mobile: true });
  try {
    await b.login(page);
    for (const sc of SCENARIOS) {
      const rec = { name: sc.name, path: sc.path, inputs: 0, pass: 0, fail: 0, fatal: 0, details: [] };
      try {
        await b.goto(page, sc.path);
        // 인증 리다이렉트 체크
        if (page.url().includes('/login')) { rec.details.push('로그인 리다이렉트 — 접근 불가'); results.push(rec); continue; }
        if (sc.open) { const opened = await sc.open(page); await b.sleep(700); if (!opened) rec.details.push('opener 트리거 못 찾음(수동 확인 필요)'); }
        // 고정 sleep 만으로는 SPA 지연 렌더 시 입력 0개 플레이크 → 입력 출현을 명시 대기(최대 3s).
        await b.waitForInputs(page, 3000);
        const inputs = await b.visibleInputs(page);
        rec.inputs = inputs.length;
        // 시나리오당 입력요소 최대 4개까지 판정(시간)
        for (const el of inputs.slice(0, 4)) {
          const { fails, info, fatal } = await b.assertKeyboardSafe(page, el);
          if (fatal) { rec.fatal++; rec.details.push(`⚠️ FATAL ${fatal}`); }
          else if (fails.length === 0) { rec.pass++; }
          else { rec.fail++; rec.details.push(`[${info ? info.tag : '?'}] ${fails.join(' / ')}`); }
        }
        if (inputs.length === 0 && !sc.open) rec.details.push('보이는 입력요소 없음(모달 opener 필요할 수 있음)');
      } catch (e) { rec.details.push('ERROR: ' + e.message.slice(0, 120)); }
      results.push(rec);
    }
  } finally { await browser.close(); }
  return results;
}

module.exports = { run, name: 'mobile-keyboard' };

// 단독 실행
if (require.main === module) {
  run().then((res) => {
    let fail = 0, fatal = 0;
    console.log('\n=== 모바일 키보드 스위트 ===');
    for (const r of res) {
      const status = (r.fatal > 0) ? '🔥' : (r.fail > 0 ? '❌' : (r.inputs === 0 ? '⚪' : '✅'));
      console.log(`${status} ${r.name} (${r.path}) — 입력 ${r.inputs} · 통과 ${r.pass} · 실패 ${r.fail}${r.fatal ? ' · FATAL ' + r.fatal : ''}`);
      r.details.forEach((d) => console.log('     └ ' + d));
      fail += r.fail; fatal += (r.fatal || 0);
    }
    console.log(`\n총 실패: ${fail}${fatal ? ' · FATAL(하니스 환경): ' + fatal : ''}`);
    process.exit(fatal > 0 ? 2 : (fail > 0 ? 1 : 0));
  }).catch((e) => { console.error('FATAL', e.message); process.exit(2); });
}
