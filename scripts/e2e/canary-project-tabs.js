// scripts/e2e/canary-project-tabs.js — 프로젝트 상세 탭 세 가지 계약 (2026-09-13)
//
// Irene: *"상단에 문서 다음에 노트 넣어줘."* · *"프로젝트 > 노트 탭은 문서 랑 완전히 똑같이 해서
//   Q note 기능 그대로 구현해."* · *"정보페이지도 디자인 맞춰. AI로 자동추가는 버튼색도 아이콘도
//   안맞아. Q info랑 매칭해봐."* · *"Q note나 문서 등 고객이 연결되면 고객프로필에도 나와야 하는 거야."*
//
// 정적 검사로 못 잡는 것만 본다:
//   ① 탭 순서 — 문자열 배열은 grep 으로 보이지만 **화면에 그려진 순서**는 렌더 뒤에만 존재
//   ② 노트 탭이 **Q Note 본체**인가 — 목록만 베낀 화면과 구별하려면 Q Note 만 있는 표식이 있어야 한다
//   ③ 정보 탭 AI 버튼이 **Q info 와 같은 색**인가 — computed style 은 CSS 가 합쳐진 뒤에만 존재
//   ④ 정보 탭 행이 Q info 와 **같은 그리드**인가 (열 수)
//   ⑤ 고객 프로필에 노트·정보 묶음이 **보이는가**
//
// ★ 0건이면 판정 불가 = 실패다(memory feedback_empty_fixture_false_verdict).
const { launch, login, goto, gotoSPA, sleep, dismissBlockers, BASE, CREDS } = require('./lib/browser');

const results = [];
const push = (name, pass, detail) => results.push({ name, fail: !pass, details: detail ? [detail] : [] });

const EXPECTED_TABS = ['dashboard', 'tasks', 'docs', 'notes', 'files', 'info',
  'report', 'history', 'transactions', 'clients', 'details', 'settings'];

// Node 쪽 로그인 — 화면이 아니라 API 로 대상 하나를 고른다.
// 탭 클릭 — 셀렉터가 나타날 때까지 기다린 뒤 누른다(느린 렌더에서 FATAL 로 죽지 않게).
async function clickTab(page, key, waitMs = 2200) {
  try {
    await page.waitForSelector(`[data-testid="project-tab-${key}"]`, { timeout: 15000 });
  } catch { return false; }
  await page.click(`[data-testid="project-tab-${key}"]`);
  await sleep(waitMs);
  return true;
}

// grid-template-columns 의 **트랙 수**를 센다.
//   computed 가 레이아웃 전이면 `minmax(160px, 1.6fr) …` 원문으로 나오고 그 안에 공백이 있어
//   단순 split 은 거짓(8열)이 된다 — 괄호 안 공백은 세지 않는다.
function trackCount(css) {
  if (!css) return 0;
  let depth = 0, n = 0, tok = false;
  for (const ch of css.trim()) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) { tok = false; continue; }
    if (!tok) { tok = true; n++; }
  }
  return n;
}

// ── 픽스처 ─────────────────────────────────────────────
//   ★ 0건이면 판정 불가 = 실패다. 프로젝트 정보(Q info scope='project')가 비어 있는 워크스페이스에서도
//     "행이 Q info 와 같은 그리드인가" 를 잴 수 있어야 하므로 **한 건 만들고 끝나면 지운다.**
//   ★ Node 쪽 로그인은 **브라우저 로그인보다 먼저** 한다.
async function setupFixture() {
  const out = { projId: null, kbId: null, tok: null, biz: null };
  try {
    const lj = await (await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: CREDS.email, password: CREDS.password }),
    })).json();
    out.tok = lj?.data?.token; out.biz = lj?.data?.user?.active_business_id;
    if (!out.tok || !out.biz) return out;
    const H = { Authorization: `Bearer ${out.tok}`, 'Content-Type': 'application/json', 'X-Workspace-Id': String(out.biz) };
    const pj = await (await fetch(`${BASE}/api/projects?business_id=${out.biz}`, { headers: H })).json();
    out.projId = (pj?.data || [])[0]?.id || null;
    if (!out.projId) return out;
    const kj = await (await fetch(`${BASE}/api/businesses/${out.biz}/kb/documents`, {
      method: 'POST', headers: H,
      body: JSON.stringify({
        title: `ZZ카나리-정보행-${Date.now()}`, body: '카나리 픽스처(자동 삭제)',
        category: 'manual', scope: 'project', project_id: out.projId,
      }),
    })).json();
    out.kbId = kj?.data?.id || null;
  } catch { /* 실패하면 아래 판정이 0건으로 떨어져 **실패**로 보고된다 */ }
  return out;
}

async function teardownFixture(fx) {
  if (!fx.kbId || !fx.tok) return;
  try {
    await fetch(`${BASE}/api/businesses/${fx.biz}/kb/documents/${fx.kbId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${fx.tok}`, 'X-Workspace-Id': String(fx.biz) },
    });
  } catch { /* noop */ }
}

async function run() {
  const fx = await setupFixture();
  const { browser, page } = await launch();
  try {
    // ★ 데스크탑 폭으로 잰다 — Q info 행은 ≤900px 에서 `1fr auto` 2열로 접힌다.
    //   기본 뷰포트(800×600)로 재면 "열 2개" 가 나와 **접힌 모습을 규격으로 오해**한다.
    await page.setViewport({ width: 1440, height: 900 });
    await login(page);

    // ── 프로젝트 하나 고른다 ───────────────────────────────
    //   ★ 여기서 **두 번째 로그인을 하지 않는다.** 같은 계정으로 Node 쪽에서 또 로그인하면
    //     refresh 사슬이 돌아 브라우저 세션이 401 로 떨어지고 /login 으로 튕긴다
    //     (실측 2026-09-13: 그 탓에 탭 0개로 전부 거짓 실패했다).
    //   ★ **첫 이동은 full goto** 다 — gotoSPA 는 앱이 이미 부팅·인증된 뒤에만 쓴다.
    //     로그인 직후 곧바로 pushState 로 옮기면 앱 상태가 아직 '미인증' 이라 /login 으로 튕긴다
    //     (실측 2026-09-13: 그래서 모든 판정이 0건으로 떨어졌다).
    //   ★ **첫 이동은 full goto** 다 — gotoSPA 는 앱이 이미 부팅·인증된 뒤에만 쓴다.
    //     로그인 직후 곧바로 pushState 로 옮기면 앱 상태가 아직 '미인증' 이라 /login 으로 튕긴다
    //     (실측 2026-09-13: 그래서 모든 판정이 0건으로 떨어졌다).
    if (!fx.projId) {
      push('프로젝트 1건 확보', false, '워크스페이스에 프로젝트 0건 — 판정 불가(실패)');
      return results;
    }
    if (!fx.kbId) {
      push('정보 픽스처 1건 생성', false, 'kb 문서를 만들지 못했다 — ④ 판정이 0건으로 떨어진다');
    }
    await goto(page, `/projects/p/${fx.projId}`);
    await sleep(2400);
    await dismissBlockers(page).catch(() => {});

    // ── ① 탭 순서 ────────────────────────────────────────
    const order = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid^="project-tab-"]')]
        .map((b) => b.getAttribute('data-testid').replace('project-tab-', '')));
    push('① 탭 순서 = 개요 업무 문서 노트 파일 정보 보고서 히스토리 거래 고객 상세정보 설정',
      order.join(',') === EXPECTED_TABS.join(','),
      `실제: ${order.join(' ') || '(탭 0개)'}`);

    // ── ② 노트 탭이 Q Note 본체인가 ───────────────────────
    const hasNotesTab = order.includes('notes');
    if (!hasNotesTab) {
      push('② 노트 탭이 Q Note 본체(목록 패널 존재)', false, '노트 탭 자체가 없다');
    } else {
      const okNotes = await clickTab(page, 'notes', 2800);
      if (!okNotes) push('② 노트 탭 버튼을 찾았다', false, 'project-tab-notes 를 못 찾았다');
      const note = await page.evaluate(() => {
        const list = document.querySelector('[data-testid="qnote-list"]');
        const r = list ? list.getBoundingClientRect() : null;
        return {
          hasList: !!list,
          listW: r ? Math.round(r.width) : 0,
          listVisible: !!r && r.width > 40 && r.height > 40,
          // Q Note 본체에만 있는 것 — 목록만 베낀 화면에는 없다
          text: (document.body.innerText || '').slice(0, 4000),
        };
      });
      push('② 노트 탭에 Q Note 목록 패널이 **보인다** (목록만 베낀 화면이 아니다)',
        note.hasList && note.listVisible, `qnote-list ${note.hasList ? `폭 ${note.listW}` : '없음'}`);
      // 문서 탭과 같은 껍데기인가 — 본문 박스의 좌/우 x 가 같아야 한다(2026-09-13 레이아웃 계약)
      const notesBox = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="project-tab-body-notes"]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left), right: Math.round(r.right) };
      });
      await clickTab(page, 'docs', 2400);
      const docsBox = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="project-tab-body-docs"]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left), right: Math.round(r.right) };
      });
      push('② 노트 탭 본문 가로가 문서 탭과 같다',
        !!notesBox && !!docsBox && notesBox.x === docsBox.x && notesBox.right === docsBox.right,
        `노트 ${notesBox ? `${notesBox.x}~${notesBox.right}` : '없음'} · 문서 ${docsBox ? `${docsBox.x}~${docsBox.right}` : '없음'}`);
    }

    // ── ③④ 정보 탭 ───────────────────────────────────────
    const okInfo = await clickTab(page, 'info', 2600);
    if (!okInfo) push('③ 정보 탭 버튼을 찾았다', false, 'project-tab-info 를 못 찾았다');
    const info = await page.evaluate(() => {
      const ai = document.querySelector('[data-testid="projinfo-ai-add"]');
      if (!ai) return { hasAi: false };
      const cs = getComputedStyle(ai);
      const r = ai.getBoundingClientRect();
      const rows = [...document.querySelectorAll('[data-kb-id]')];
      const colStr = rows.length ? getComputedStyle(rows[0]).gridTemplateColumns : '';
      return {
        hasAi: true,
        aiBg: cs.backgroundImage || '',
        aiColor: cs.color,
        aiH: Math.round(r.height),
        hasStar: !!ai.querySelector('svg path'),
        rowCount: rows.length,
        colStr,
        rowKids: rows.length ? rows[0].children.length : 0,
        rowCls: rows.length ? String(rows[0].className || '') : '',
        rowDisplay: rows.length ? getComputedStyle(rows[0]).display : '',
      };
    });
    push('③ 정보 탭 AI 버튼이 Q info 규격(그라디언트 배경 + 흰 글자)',
      !!info.hasAi && /gradient/.test(info.aiBg) && /255,\s*255,\s*255/.test(info.aiColor),
      info.hasAi ? `bg=${String(info.aiBg).slice(0, 60)} color=${info.aiColor} h=${info.aiH}` : 'AI 버튼 없음');
    const infoCols = trackCount(info.colStr);
    push('④ 정보 탭 행이 Q info 와 같은 grid 행 (열 4개 이상)',
      info.rowCount > 0 && info.rowDisplay === 'grid' && infoCols >= 4,
      info.rowCount ? `행 ${info.rowCount}건 · display=${info.rowDisplay} · 열 ${infoCols}` : '행 0건 — 판정 불가(실패)');

    // 같은 계약을 Q info 본체에서도 재서 **두 화면이 같은지** 대조한다.
    //   ★ **새 문서**에서 연다. 같은 문서에서 /info 로 옮기면 탭 모드가 직전(프로젝트) 탭을
    //     활성으로 되살려 /info 는 비활성 창에 그려지고, computed 가 `minmax(...)` 원문으로
    //     나와 열 수가 거짓이 된다(실측 2026-09-13: 8열 → 0열). 부팅 경로가 /info 여야 한다.
    const page2 = await browser.newPage();
    await page2.setViewport({ width: 1440, height: 900 });
    await goto(page2, '/info');
    await sleep(2600);
    await dismissBlockers(page2).catch(() => {});
    const qinfo = await page2.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-kb-id]')];
      return {
        rowCount: rows.length,
        colStr: rows.length ? getComputedStyle(rows[0]).gridTemplateColumns : '',
        rowKids: rows.length ? rows[0].children.length : 0,
        rowDisplay: rows.length ? getComputedStyle(rows[0]).display : '',
      };
    });
    // ★ 트랙 **폭(px)** 으로 대조하지 않는다 — 두 화면은 좌측 트리 폭이 달라 px 이 같을 리 없다.
    //   같은 한 벌인지는 **열 수 + 칸 수**로 본다(클래스 이름은 청크가 갈리면 달라져 증거가 못 된다).
    const qinfoCols = trackCount(qinfo.colStr);
    push('④-b Q info 본체와 **같은 열 수·같은 칸 수**',
      qinfo.rowCount > 0 && info.rowCount > 0
        && qinfoCols === infoCols && qinfo.rowKids === info.rowKids,
      `프로젝트 ${infoCols}열/${info.rowKids}칸 · Q info ${qinfoCols}열/${qinfo.rowKids}칸 `
      + `(행 ${info.rowCount}/${qinfo.rowCount})`);

    // ── ⑥ /info?doc=N 딥링크가 **상세를 연다** ─────────────────
    //   고객 프로필의 [정보] 칩이 이 주소로 연다. 열리지 않으면 "누르면 아무 일도 안 나는 칩" 이다.
    const kbId = await page2.evaluate(() => {
      const el = document.querySelector('[data-kb-id]');
      return el ? el.getAttribute('data-kb-id') : null;
    });
    if (!kbId) {
      push('⑥ /info?doc=N 이 상세를 연다', false, 'Q info 문서 0건 — 판정 불가(실패)');
    } else {
      await goto(page2, `/info?doc=${kbId}`);
      await sleep(2600);
      const opened = await page2.evaluate(() => {
        const p = document.querySelector('[data-pq-drawer-panel]');
        if (!p) return { open: false };
        const r = p.getBoundingClientRect();
        return { open: r.width > 40 && r.height > 40, w: Math.round(r.width) };
      });
      push('⑥ /info?doc=N 이 상세 패널을 연다', opened.open,
        opened.open ? `패널 폭 ${opened.w}` : '패널이 안 열렸다 (딥링크가 소비되지 않음)');
    }

    await page2.close().catch(() => {});

    // ── ⑤ 고객 프로필의 노트·정보 묶음 ──────────────────────
    await gotoSPA(page, '/sale');
    await sleep(2000);
    await dismissBlockers(page).catch(() => {});
    await page.click('[data-testid="sale-tab-clients"]').catch(() => {});
    await sleep(1400);
    const rowId = await page.evaluate(() => {
      const b = document.querySelector('[data-testid^="sale-row-"]');
      return b ? b.getAttribute('data-testid') : null;
    });
    if (!rowId) {
      push('⑤ 고객 프로필에 노트·정보 묶음', false, '고객 0건 — 판정 불가(실패)');
    } else {
      await page.click(`[data-testid="${rowId}"]`);
      await sleep(1600);
      const links = await page.evaluate(() => {
        const q = document.querySelector('[data-testid="client-links-qnote"]');
        const i = document.querySelector('[data-testid="client-links-info"]');
        const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 20 && r.height > 8; };
        return { qnote: vis(q), info: vis(i) };
      });
      push('⑤ 고객 패널에 [노트]·[정보] 묶음이 보인다',
        links.qnote && links.info, `노트 ${links.qnote} · 정보 ${links.info}`);
    }
  } finally { await browser.close(); await teardownFixture(fx); }
  return results;
}

module.exports = { name: '프로젝트 탭 — 순서·노트=Q Note 본체·정보=Q info 규격 · 고객 프로필 연결', run };
