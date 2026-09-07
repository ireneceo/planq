// canary-realtime — **다른 기기에서 바꾼 것이 보고 있는 화면에 즉시 오는가** (2026-09-07)
//
//   Irene: "태블릿에서 좌측메뉴의 업무재개를 눌렀는데 pwa 데스크탑앱에서 바로 적용이 안되는데
//           시차가 1분은 있어보여. … 여기 저기 실시간 안되게 데이터 변경되는게 너무 자주 보여."
//
//   실측으로 가른 것: 근태(attendance)는 이미 529ms 에 반영됐고, **포커스(업무 시작·재개)만**
//   소켓 리스너가 아예 없어 30초 폴링에 의존하고 있었다. 같은 계열인데 한쪽만 빠져 있으면
//   사용자에게는 "어떤 건 되고 어떤 건 안 되는" 것으로 보인다 — 그래서 둘을 한 검사로 묶는다.
//
//   판정 렌즈 주의: 페이지 전체에서 '휴게' 를 찾으면 **근무중일 때도 '휴게' 버튼이 있어**
//   판정이 영영 참이 못 된다(2026-09-07 실측으로 겪음). 상태 라벨 한 덩어리만 읽는다.
const b = require('./lib/browser');

const BIZ = Number(process.env.E2E_RT_BIZ || 5);
const TASK = Number(process.env.E2E_RT_TASK || 1978);
const WAIT_MS = 8000;   // 이 안에 안 오면 실시간이 아니다 (폴링은 30초다)

const api = (page, p, i) => page.evaluate(async (pp, ii) => {
  const tok = window.__pqGetToken ? window.__pqGetToken() : null;
  const r = await fetch(pp, { ...ii, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok, ...(ii && ii.headers) } });
  return { s: r.status, b: await r.json().catch(() => null) };
}, p, i || {});

/** 근태 상태 라벨 — 위젯이 그리는 것과 같은 한 덩어리만 읽는다. */
const readAttendance = (page) => page.evaluate(() => {
  const STATES = ['근무중', '휴게중', '퇴근', '미출근'];
  const el = Array.from(document.querySelectorAll('div,span,p'))
    .filter((e) => e.children.length === 0)
    .find((e) => STATES.includes((e.textContent || '').trim()));
  const dot = Array.from(document.querySelectorAll('[title]'))
    .map((e) => (e.getAttribute('title') || '').trim()).find((t) => STATES.includes(t));
  return el ? el.textContent.trim() : (dot || null);
});

/** 포커스 위젯 상태 — **표식으로** 읽는다.
 *  ★ 처음엔 본문에서 타이머 정규식(\d+:[0-5]\d)을 찾았는데 **사이드바 시계(13:24)** 가 걸려
 *    검사가 1ms 만에 거짓 통과했다(2026-09-07 실측). 화면 텍스트로 상태를 추측하지 않는다. */
const readFocus = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-testid="focus-widget"]');
  if (!el) return 'idle';
  return el.getAttribute('data-focus-state') === 'active' ? 'running' : 'idle';
});

async function waitFor(page, read, want, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await read(page) === want) return Date.now() - t0;
    await b.sleep(300);
  }
  return null;
}

async function run() {
  const results = [];
  const push = (n, ok, m) => results.push({ name: n, fail: ok ? 0 : 1, details: [m] });
  let focusRestore = false;
  const A = await b.launch();   // 조작하는 기기
  const B = await b.launch();   // 보고 있는 기기
  try {
    await b.login(A.page); await b.login(B.page);
    await b.goto(A.page, '/tasks');
    // ★ 포커스 설정은 **페이지를 열기 전에** 켠다. 위젯은 focus_enabled 가 꺼져 있으면
    //   렌더 자체를 안 한다(early return) — 나중에 켜도 이미 뜬 화면은 다시 읽지 않는다.
    //   이 순서를 놓쳐서 "8초 안에 안 옴" 이 나왔고, 그건 앱이 아니라 준비의 문제였다.
    const prevSet = await api(A.page, '/api/focus/settings');
    const wasEnabled = prevSet.b?.data?.focus_enabled;
    if (!wasEnabled) await api(A.page, '/api/focus/settings', { method: 'PUT', body: JSON.stringify({ focus_enabled: true }) });
    focusRestore = wasEnabled === false;
    await B.page.setViewport({ width: 1440, height: 900 });
    await b.goto(B.page, '/tasks');
    await b.sleep(3000);

    // ── 근태 ──
    // ★ 알려진 상태로 몰고 시작한다. `undo-auto-clock-in` 은 **자동 출근 한 건일 때만** 통하므로
    //   앞선 실행이 남긴 사용자 출근에는 안 먹고, 그러면 clock-in 이 400 → 뒤 판정이 전부 흔들린다
    //   (2026-09-07 실측: 기준선 3ms·휴게 실패·재개 2ms 처럼 이미 그 상태였던 것을 통과로 셌다).
    const A0 = { method: 'POST', body: JSON.stringify({ business_id: BIZ }) };
    await api(A.page, '/api/attendance/break-end', A0).catch(() => null);   // 휴게 중이면 먼저 푼다
    await api(A.page, '/api/attendance/clock-out', A0).catch(() => null);
    await api(A.page, '/api/attendance/undo-auto-clock-in', A0).catch(() => null);
    await b.sleep(600);
    await api(A.page, '/api/attendance/clock-in', A0);
    // ★ **B 가 받을 준비가 됐는지 먼저 확인한다.** 페이지를 연 직후에는 소켓이 아직 안 붙어 있어
    //   첫 이벤트를 놓친다 — 그걸 "실시간이 아니다" 로 읽으면 검사기가 거짓 빨간불을 낸다
    //   (2026-09-07 실측: 첫 항목만 실패하고 뒤 항목은 통과). 기준선이 없으면 측정도 없다.
    const ready = await waitFor(B.page, readAttendance, '근무중', 25000);
    push('근태: 기준선(B 가 근무중을 받음)', ready !== null,
      ready === null ? '🔴 25초 안에 B 가 출근을 못 받음 — 아래 판정 무의미' : `${ready}ms`);
    if (ready === null) return results;
    await api(A.page, '/api/attendance/break-start', A0);
    const gotBreak = await waitFor(B.page, readAttendance, '휴게중', WAIT_MS);
    push('근태: 휴게 시작이 다른 기기에', gotBreak !== null, gotBreak === null ? `🔴 ${WAIT_MS}ms 안에 안 옴` : `${gotBreak}ms`);
    const t = Date.now();
    await api(A.page, '/api/attendance/break-end', A0);
    const gotWork = await waitFor(B.page, readAttendance, '근무중', WAIT_MS);
    push('근태: 재개가 다른 기기에', gotWork !== null, gotWork === null ? `🔴 ${WAIT_MS}ms 안에 안 옴` : `${gotWork}ms`);

    // ── 포커스 (업무 시작) ──
    //   ★ 이 계정은 focus_enabled 가 꺼져 있을 수 있다(403 focus_disabled). 켜고 재고 **되돌린다**
    //     — 검사기가 남의 설정을 바꿔 놓고 끝나면 그 자체가 사고다.
    // stop 은 session_id 가 필요하다(없으면 400). 현재 세션을 읽어 넘긴다.
    const cur = await api(A.page, '/api/focus/current');
    if (cur.b?.data?.id) await api(A.page, '/api/focus/stop', { method: 'POST', body: JSON.stringify({ session_id: cur.b.data.id }) }).catch(() => null);
    // ★ **시작 전에 idle 인지 확인한다.** 앞선 세션이 남아 있으면 '이미 running' 을 보고
    //   2ms 만에 통과했다고 착각한다(2026-09-07 실측). 기준선이 없으면 측정도 없다.
    const idleBefore = await waitFor(B.page, readFocus, 'idle', WAIT_MS);
    push('포커스: 시작 전 기준선(idle)', idleBefore !== null,
      idleBefore === null ? '🔴 시작 전에 이미 running — 아래 판정 무의미' : `${idleBefore}ms 만에 idle 확인`);
    if (idleBefore === null) {
      const now = await B.page.evaluate(() => {
        const el = document.querySelector('[data-testid="focus-widget"]');
        return el ? { state: el.getAttribute('data-focus-state'), task: el.getAttribute('data-focus-task') } : null;
      });
      console.log('   [진단] B 위젯', JSON.stringify(now));
      return results;
    }
    const st = await api(A.page, '/api/focus/start', { method: 'POST', body: JSON.stringify({ business_id: BIZ, task_id: TASK }) });
    const gotFocus = st.s === 200 ? await waitFor(B.page, readFocus, 'running', WAIT_MS) : null;
    push('포커스: 업무 시작이 다른 기기에', gotFocus !== null,
      st.s !== 200 ? `시작 실패 ${st.s} — 판정 불가` : (gotFocus === null ? `🔴 ${WAIT_MS}ms 안에 안 옴 (폴링 30초에 의존)` : `${gotFocus}ms`));
    // 멈춤도 같이 본다 — 시작만 오고 종료가 안 오면 화면에 유령 세션이 남는다.
    const sid = st.b?.data?.id;
    if (sid) {
      const stopR = await api(A.page, '/api/focus/stop', { method: 'POST', body: JSON.stringify({ session_id: sid }) });
      const gotStop = stopR.s === 200 ? await waitFor(B.page, readFocus, 'idle', WAIT_MS) : null;
      push('포커스: 종료가 다른 기기에', gotStop !== null,
        stopR.s !== 200 ? `종료 실패 ${stopR.s}` : (gotStop === null ? `🔴 ${WAIT_MS}ms 안에 안 옴` : `${gotStop}ms`));
    }
    // session_id 없이 부르면 500 이 아니라 400 이어야 한다 (2026-09-07 실버그)
    const bad = await api(A.page, '/api/focus/stop', { method: 'POST', body: JSON.stringify({}) });
    push('포커스: 인자 빠뜨리면 400', bad.s === 400, `${bad.s} (500 이면 서버 오류로 위장)`);
  } finally {
    const last = await api(A.page, '/api/focus/current').catch(() => null);
    if (last?.b?.data?.id) await api(A.page, '/api/focus/stop', { method: 'POST', body: JSON.stringify({ session_id: last.b.data.id }) }).catch(() => null);
    if (focusRestore) await api(A.page, '/api/focus/settings', { method: 'PUT', body: JSON.stringify({ focus_enabled: false }) }).catch(() => null);
    // ★ **살아 있는 자동출근 알림을 남기지 않는다.**
    //   포커스 시작은 autoClockInOnFocus 로 자동 출근을 찍는다. `undo-auto-clock-in` 은
    //   **이벤트가 그 하나뿐일 때만** 통하므로 여기서는 안 먹는다(오늘 이미 여러 건이 쌓여 있다).
    //   그대로 두면 30분 동안 모든 브라우저에 그 모달이 떠서 **뒤 스위트의 클릭을 가로챈다**
    //   (2026-09-07 실측: mailband·rowtags 가 그것 때문에 빨간불이었다).
    //   clock_out 을 하나 얹으면 마지막 이벤트가 clock_in 이 아니게 되어 알림이 사라진다.
    const A1 = { method: 'POST', body: JSON.stringify({ business_id: BIZ }) };
    await api(A.page, '/api/attendance/break-end', A1).catch(() => null);
    await api(A.page, '/api/attendance/clock-out', A1).catch(() => null);
    await api(A.page, '/api/attendance/undo-auto-clock-in', A1).catch(() => null);
    // 정말 사라졌는지 확인한다 — 원복을 했다고 말만 하지 않는다.
    const chk = await api(A.page, `/api/attendance/today?business_id=${BIZ}`).catch(() => null);
    const leftover = chk?.b?.data?.auto_notice || null;
    if (leftover) results.push({ name: '정리: 자동출근 알림 잔존', fail: 1, details: [`🔴 남아 있다(${leftover.at}) — 뒤 스위트를 가린다`] });
    await A.browser.close().catch(() => null);
    await B.browser.close().catch(() => null);
  }
  return results;
}

module.exports = { name: 'realtime', run };

if (require.main === module) {
  run().then((rs) => {
    let bad = 0;
    rs.forEach((r) => { if (r.fail) bad++; console.log(`${r.fail ? '❌' : '✅'} ${r.name} — ${r.details[0]}`); });
    console.log(bad ? `\n실패 ${bad}/${rs.length}` : `\n통과 ${rs.length}/${rs.length}`);
    process.exit(bad ? 1 : 0);
  }).catch((e) => { console.error('🔴 하니스 오류:', e.message); process.exit(2); });
}
