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

// Q Mail 작성 풀페이지 열기 — 모바일은 리스트(사이드바)가 접힘 오버레이라 먼저 펼친 뒤 [＋ 새 메일] 클릭.
//   compose 열면 사이드바 자동 접힘(main 패널 풀폭) → 입력 온전히 노출.
async function openMailCompose(page) {
  await clickTestId(page, 'mail-list-expand');   // 접힘 상태에서만 렌더되는 펼치기 버튼
  await b.sleep(450);
  return clickTestId(page, 'mail-compose-open');
}

// #204 — 모바일 진입 시 메일 리스트가 기본 접힘이라 "메일이 안 나온다"던 회귀.
//   blank 판정은 페이지가 그려지기만 하면 통과해 이 계열을 못 잡는다(실제로 ⚪ 로 통과했다).
//   불변식: 좁은 화면에서 ?thread= 없이 /mail 에 들어오면 목록이 먼저 보여야 한다
//   (= 접힘 상태에서만 렌더되는 `mail-list-expand` 버튼이 있으면 안 된다).
//   행 수는 계정 데이터에 좌우되므로 판정 근거로 쓰지 않고 참고로만 기록한다.
async function assertMailListVisible(page) {
  const r = await page.evaluate(() => {
    const main = document.querySelector('[data-panel-main]');
    const rows = [...document.querySelectorAll('div,li,button')].filter((el) => {
      const bb = el.getBoundingClientRect();
      if (bb.width < 120 || bb.height < 30 || bb.height > 200) return false;
      if (bb.top >= window.innerHeight || bb.bottom <= 0) return false;
      if (main && main.contains(el)) return false;
      return getComputedStyle(el).cursor === 'pointer' && (el.innerText || '').trim().length > 10;
    });
    return { rows: rows.length, collapsed: !!document.querySelector('[data-testid="mail-list-expand"]') };
  });
  if (r.collapsed) return { ok: false, msg: `🔴 모바일 진입 시 메일 목록이 접혀 있음 — 사용자는 빈 상세만 본다 (보이는 행 ${r.rows})` };
  return { ok: true, msg: `목록 펼침 · 보이는 행 ${r.rows}` };
}

// 운영 #283 — "큐노트 모바일로 가면 리스트가 안 나와".
//   Q Note 는 좁은 화면이면 **선택 여부와 무관하게** 사이드바를 접고 있었다. 이 스위트에 /notes 케이스가
//   아예 없어서(하니스 사각) exit 0 인 채로 운영까지 나갔다. 불변식은 Q Mail(#204)과 같다:
//   좁은 화면에서 세션을 지목하지 않고 들어오면 **리스트가 먼저 보여야 한다**.
async function assertQNoteListVisible(page) {
  const r = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="qnote-list"]');
    if (!el) return { missing: true };
    const cs = getComputedStyle(el);
    const bb = el.getBoundingClientRect();
    return {
      missing: false,
      hidden: cs.visibility === 'hidden' || cs.display === 'none',
      offscreen: bb.right <= 1 || bb.width < 40,
      w: Math.round(bb.width), left: Math.round(bb.left),
    };
  });
  if (r.missing) return { ok: false, msg: '🔴 qnote-list 앵커를 못 찾음 — 판정 불가(하니스가 거짓 통과할 수 있다)' };
  if (r.hidden || r.offscreen) {
    return { ok: false, msg: `🔴 모바일 진입 시 Q Note 세션 목록이 접혀 있음 — 사용자는 빈 본문만 본다 (w=${r.w} left=${r.left})` };
  }
  return { ok: true, msg: `목록 펼침 · 폭 ${r.w}px` };
}

// 운영 #283 — "메일 상세는 상단이 잘려".
//   목록 열기 버튼이 absolute 로 상세 제목 위에 겹쳐 그려지던 회귀. 불변식: 제목과 버튼의 사각형이
//   겹치지 않고, 제목의 좌상단이 패널 안에 있어야 한다. (정적 검사로는 안 잡힌다 — 두 파일의 CSS 가
//   합쳐진 뒤에만 존재하는 겹침이다.)
async function assertMailDetailHeaderClear(page) {
  const opened = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-panel-main] ~ * [role="button"], aside button, aside [role="button"], aside li')];
    const el = rows.find((e) => e.offsetParent !== null && (e.innerText || '').trim().length > 10);
    if (el) { el.click(); return true; }
    return false;
  });
  if (!opened) return { ok: true, msg: '⚪ 열 수 있는 스레드가 없어 판정 생략(데이터 없음)' };
  await b.sleep(900);
  const r = await page.evaluate(() => {
    const subj = document.querySelector('[data-testid="mail-detail-subject"]');
    if (!subj) return { missing: true };
    const btn = document.querySelector('[data-testid="mail-list-expand"]');
    const s = subj.getBoundingClientRect();
    const bb = btn ? btn.getBoundingClientRect() : null;
    const overlap = bb ? !(bb.right <= s.left || bb.left >= s.right || bb.bottom <= s.top || bb.top >= s.bottom) : false;
    return { missing: false, overlap, clipped: s.top < 0 || s.left < 0, top: Math.round(s.top), left: Math.round(s.left) };
  });
  if (r.missing) return { ok: true, msg: '⚪ 상세가 열리지 않아 판정 생략' };
  if (r.overlap) return { ok: false, msg: `🔴 목록열기 버튼이 상세 제목을 덮는다 — "상단이 잘린" 것처럼 보인다 (top=${r.top} left=${r.left})` };
  if (r.clipped) return { ok: false, msg: `🔴 상세 제목이 뷰포트 밖으로 잘림 (top=${r.top} left=${r.left})` };
  return { ok: true, msg: `상세 제목 가림 0 (top=${r.top} left=${r.left})` };
}

// 시나리오: path + (선택) open 스텝 + (선택) assert 판정. open 후 보이는 입력요소 전부 판정.
//   create 모달은 URL 파라미터(?create=1 · ?new=1)로 결정론적 오픈 — path 에 쿼리를 넣으면 goto 시 자동 오픈.
const SCENARIOS = [
  { name: 'clients-search', path: '/business/clients', open: null },
  { name: 'clients-invite', path: '/business/clients', open: (p) => clickTestId(p, 'clients-invite-open').then((ok) => ok || clickByText(p, ['고객 초대', '초대'])) },
  { name: 'qbill-list', path: '/bills', open: null },
  { name: 'bill-new', path: '/bills?tab=invoices&new=1', open: null },  // 청구서 발행 모달(invoices 서브탭 활성 후 URL 자동 오픈)
  { name: 'tasks-week', path: '/tasks', open: null },
  { name: 'tasks-create', path: '/tasks?create=1', open: null },        // 업무 생성 모달(RightDock create 경로와 동일)
  { name: 'inbox', path: '/inbox', open: null },
  { name: 'mail-list', path: '/mail', open: null, assert: assertMailListVisible },  // #173/174/159/178 흰 화면 + #204 목록 접힘 회귀 가드
  { name: 'mail-compose', path: '/mail', open: openMailCompose },       // 작성 풀페이지 입력(받는사람·제목·본문) 키보드 가림
  { name: 'mail-detail', path: '/mail', open: null, assert: assertMailDetailHeaderClear },  // #283 상세 상단 겹침 회귀 가드
  { name: 'qnote-list', path: '/notes', open: null, assert: assertQNoteListVisible },       // #283 모바일 리스트 미노출 회귀 가드
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
      const rec = { name: sc.name, path: sc.path, inputs: 0, pass: 0, fail: 0, fatal: 0, blank: false, details: [] };
      try {
        await b.goto(page, sc.path);
        // 인증 리다이렉트 체크
        if (page.url().includes('/login')) { rec.details.push('로그인 리다이렉트 — 접근 불가'); results.push(rec); continue; }
        // 흰 화면(blank) 가드 — opener(모달) 열기 전 base 페이지가 실제로 그려졌는지. painted<2면 통째로 안 그려진 것.
        await b.sleep(300);
        const rendered = await b.assertRendered(page);
        if (rendered.painted < 2) { rec.blank = true; rec.details.push(`🔴 흰 화면(blank) — painted ${rendered.painted}/${rendered.samples}`); }
        // 시나리오 고유 판정 (opener 실행 전 — 진입 직후 상태를 본다)
        if (sc.assert) {
          const a = await sc.assert(page);
          if (a.ok) { rec.details.push(a.msg); } else { rec.fail++; rec.details.push(a.msg); }
        }
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
      const status = (r.fatal > 0) ? '🔥' : ((r.fail > 0 || r.blank) ? '❌' : (r.inputs === 0 ? '⚪' : '✅'));
      console.log(`${status} ${r.name} (${r.path}) — 입력 ${r.inputs} · 통과 ${r.pass} · 실패 ${r.fail}${r.blank ? ' · 흰화면' : ''}${r.fatal ? ' · FATAL ' + r.fatal : ''}`);
      r.details.forEach((d) => console.log('     └ ' + d));
      fail += r.fail + (r.blank ? 1 : 0); fatal += (r.fatal || 0);
    }
    console.log(`\n총 실패: ${fail}${fatal ? ' · FATAL(하니스 환경): ' + fatal : ''}`);
    process.exit(fatal > 0 ? 2 : (fail > 0 ? 1 : 0));
  }).catch((e) => { console.error('FATAL', e.message); process.exit(2); });
}
