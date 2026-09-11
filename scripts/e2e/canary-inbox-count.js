// canary-inbox-count — 확인 필요 / Q Task 배지가 **같은 것을 세는가** (2026-09-07)
//
//   Irene: "나한테 업무요청 온게 이렇게 3가지인데 확인필요에 2개만 나와.
//           그리고 Q task 에 옆에 숫자알림 안떠. 3개 떠야지.
//           확인필요는 다른 메뉴들 알림합친 숫자가 되는 거잖아. 아니야?"
//
//   원인은 두 개였다 — ①`collectTasks` 에 '보낸 업무요청(내 요청이 컨펌 단계)' 수집기가 **아예 없었고**
//   ②`/tasks` NavItem 에 배지 코드가 없었다. 여기서는 서버가 만드는 숫자를 실호출로 잰다.
//
//   ★ 양성 대조군 — 시드를 넣으면 오르고, 지우면 돌아와야 한다. 안 뒤집히면 이 검사는 무효다.
//   ★ 중복 금지 — 내가 pending 컨펌자인 업무는 '확인 요청 받음' 으로 이미 세므로 두 번 세면 안 된다.
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');

const API = process.env.E2E_API || 'http://localhost:3003';
const EMAIL = process.env.E2E_EMAIL || 'health-check@planq.kr';
const PASSWORD = process.env.E2E_PASSWORD || 'HealthCheck2026!';
const BIZ = 5;
const ME = 5;              // health-check — business 5 의 owner
const ASSIGNEE = 1000287;  // 다른 멤버 (담당자 역)

async function login() {
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const j = await r.json();
  if (!j?.data?.accessToken && !j?.data?.token) throw new Error('login failed: ' + JSON.stringify(j).slice(0, 200));
  return j.data.accessToken || j.data.token;
}

async function todo(token) {
  const r = await fetch(`${API}/api/dashboard/todo?business_id=${BIZ}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const j = await r.json();
  if (!j?.data) throw new Error('todo failed: ' + JSON.stringify(j).slice(0, 200));
  return j.data;
}

// ★ 만든 것은 **만든 즉시** 목록에 넣는다. 뒤 INSERT 가 실패해 예외가 나면 반환값이 없어
//   호출자의 변수가 null 로 남고 정리에서 빠진다 — 실제로 한 번 겪었다(2026-09-07,
//   task_reviewers.added_by_user_id 누락). 그 잔재가 다음 스위트의 숫자를 흔든다.
const created = [];

async function seedTask(title, { reviewerIsMe }) {
  const [id] = await sequelize.query(
    `INSERT INTO tasks (business_id, title, created_by, request_by_user_id, assignee_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'reviewing', NOW(), NOW())`,
    { replacements: [BIZ, title, ME, ME, ASSIGNEE] });
  created.push(id);
  if (reviewerIsMe) {
    await sequelize.query(
      `INSERT INTO task_reviewers (task_id, user_id, state, added_by_user_id, created_at, updated_at)
       VALUES (?, ?, 'pending', ?, NOW(), NOW())`,
      { replacements: [id, ME, ME] });
  }
  return id;
}

async function dropTask(id) {
  if (!id) return;
  await sequelize.query('DELETE FROM task_reviewers WHERE task_id = ?', { replacements: [id] });
  await sequelize.query('DELETE FROM tasks WHERE id = ?', { replacements: [id] });
  const i = created.indexOf(id);
  if (i >= 0) created.splice(i, 1);
}

async function dropAll() {
  for (const id of [...created]) {
    try { await dropTask(id); } catch { /* 정리 실패는 다음 것을 막지 않는다 */ }
  }
}

// 화면 확인용 — 브라우저는 필요한 순간에만 띄우고 반드시 닫는다.
//   ★ **데스크탑 폭으로 재야 한다.** 기본 뷰포트(800×600)는 태블릿 이하라 좌측 메뉴가
//     화면 밖(x=-36)으로 밀려 있어 배지가 "안 보임" 으로 나온다 — 기능이 아니라 모드 문제다.
//     2026-09-07 실측으로 겪었다(rect.x=-36, elementFromPoint=null).
async function withBrowser(fn) {
  const b = require('./lib/browser');
  const { browser, page } = await b.launch();
  try {
    await page.setViewport({ width: 1440, height: 900 });
    await b.login(page);
    await b.goto(page, '/tasks');
    await b.sleep(4000);
    return await fn(page);
  } finally { try { await browser.close(); } catch { /* noop */ } }
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });
  let sentId = null, dupId = null;
  try {
    const token = await login();

    // ── 기준선
    const base = await todo(token);
    push('taskCount 필드가 응답에 있다',
      typeof base.taskCount === 'number',
      `taskCount=${JSON.stringify(base.taskCount)} — 없으면 Q Task 배지는 영원히 0 이다`);
    push('taskCount ≤ total (부분집합 계약)',
      (base.taskCount || 0) <= base.total,
      `task ${base.taskCount} / total ${base.total} — 확인필요는 메뉴 배지들의 합이므로 부분집합이어야`);

    // ★ **숫자는 목록 상한에 잘리지 않는다** (2026-09-07 실측 사고).
    //   collectMails 가 목록을 30건에서 끊는데 total 이 그 배열 길이라 숫자까지 잘렸다 —
    //   확인 필요 35 인데 답장 필요 메일만 46 건이었다. "3건인데 2건" 과 같은 계열이다.
    push('메일 배지가 total 을 넘지 않는다 (숫자가 안 잘린다)',
      (base.mailReplyCount || 0) <= base.total,
      `mail ${base.mailReplyCount} ≤ total ${base.total} — 넘으면 total 이 목록 상한에 잘린 것이다`);
    push('bill 배지도 total 안에 있다',
      (base.billCount || 0) <= base.total,
      `bill ${base.billCount} ≤ total ${base.total}`);
    // Q sale (2026-09-11) — 메뉴 배지는 total 의 **부분집합**이다. 예외는 Q mail 하나뿐이고,
    //   sale 은 "나에게 귀속된 것만" 세므로 예외가 필요 없다(docs/Q_SALE_DESIGN.md §16 U1).
    push('saleCount 필드가 응답에 있다',
      typeof base.saleCount === 'number',
      `saleCount=${JSON.stringify(base.saleCount)} — 없으면 Q sale 배지는 영원히 0 이다`);
    push('sale 배지도 total 안에 있다 (부분집합 계약)',
      (base.saleCount || 0) <= base.total,
      `sale ${base.saleCount} ≤ total ${base.total}`);
    push('sale 항목 수 = saleCount (목록과 배지가 같은 것을 센다)',
      (base.items || []).filter((it) => it.type === 'sale').length <= (base.saleCount || 0),
      `items(sale) ${(base.items || []).filter((it) => it.type === 'sale').length} ≤ saleCount ${base.saleCount}`
        + ' — 목록은 상한에 잘려도 배지는 안 잘린다');
    push('가려진 건수를 정확히 알려준다',
      typeof base.shown === 'number' && typeof base.hidden === 'number'
        && base.shown + base.hidden === base.total
        && base.shown === (base.items || []).length,
      `shown ${base.shown} + hidden ${base.hidden} = ${base.total} · items ${(base.items || []).length}`
        + ' — 화면이 "외 N건" 을 말할 근거다');
    const baseTask = base.taskCount || 0;
    const baseTotal = base.total;

    // ── 양성 대조군 ①: 보낸 업무요청(내 요청 · 컨펌 진행 중)
    sentId = await seedTask('inbox-count 카나리 — 보낸 업무요청', { reviewerIsMe: false });
    const afterSent = await todo(token);
    const sentItem = (afterSent.items || []).find((it) => it.id === `task-${sentId}-sent-review`);
    push('보낸 업무요청이 확인 필요에 잡힌다',
      !!sentItem,
      sentItem ? `verb=${sentItem.verb} · "${sentItem.subject}"` : '수집기가 이 버킷을 안 만든다 (신고 원인)');
    push('보낸 업무요청이 taskCount 를 올린다',
      (afterSent.taskCount || 0) === baseTask + 1,
      `${baseTask} → ${afterSent.taskCount} (기대 ${baseTask + 1})`);
    push('보낸 업무요청이 total 도 올린다',
      afterSent.total === baseTotal + 1,
      `${baseTotal} → ${afterSent.total} (기대 ${baseTotal + 1}) — 배지와 목록이 같은 것을 세야`);
    push('동사에 번역이 붙어 있다',
      sentItem && sentItem.verb === 'awaiting_confirm',
      `verb=${sentItem && sentItem.verb} — dashboard.json todo.verb 에 ko/en 둘 다 필요`);

    // ── 중복 금지: 내가 pending 컨펌자이면 '확인 요청 받음' 하나로만 센다
    dupId = await seedTask('inbox-count 카나리 — 내가 컨펌자', { reviewerIsMe: true });
    const afterDup = await todo(token);
    const asReview = (afterDup.items || []).filter((it) => it.id === `task-${dupId}-review`).length;
    const asSent = (afterDup.items || []).filter((it) => it.id === `task-${dupId}-sent-review`).length;
    push('한 업무 = 한 버킷 (중복 계수 없음)',
      asReview === 1 && asSent === 0,
      `review=${asReview} sent=${asSent} — 내가 컨펌자면 '확인 요청 받음' 으로만 센다`);
    push('컨펌자 업무도 taskCount 를 1 만 올린다',
      (afterDup.taskCount || 0) === baseTask + 2,
      `${baseTask} → ${afterDup.taskCount} (기대 ${baseTask + 2})`);

    // ── 화면 — 서버 숫자가 맞아도 배지가 안 그려지면 사용자에겐 고쳐진 게 아니다
    //    (memory: 백엔드만 넣고 화면 안 붙이면 안 고친 것)
    const seen = await withBrowser(async (page) => page.evaluate(() => {
      const g = (id) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
        const hit = document.elementFromPoint(cx, cy);
        return {
          text: (el.textContent || '').trim(),
          w: Math.round(r.width), h: Math.round(r.height),
          x: Math.round(r.left), y: Math.round(r.top),
          // 크기만 보면 속는다 — 실제로 그 좌표에서 잡히는지까지 본다
          visible: r.width > 0 && r.height > 0 && !!hit && (el === hit || el.contains(hit) || hit.contains(el)),
        };
      };
      return { task: g('nav-badge-task'), inbox: g('nav-badge-inbox') };
    }));
    push('Q Task 사이드바 배지가 화면에 뜬다',
      !!(seen.task && seen.task.visible && Number(seen.task.text) > 0),
      seen.task ? `"${seen.task.text}" ${seen.task.w}×${seen.task.h} @(${seen.task.x},${seen.task.y}) 보임=${seen.task.visible}` : '배지 요소 자체가 없다 (신고 원인)');
    push('확인 필요 배지가 Q Task 배지 이상이다',
      !!(seen.task && seen.inbox && Number(seen.inbox.text) >= Number(seen.task.text)),
      `확인필요 ${seen.inbox && seen.inbox.text} ≥ Q Task ${seen.task && seen.task.text} — 확인필요는 메뉴 배지들의 합이다`);

    // ── 음성 대조군: 지우면 기준선으로 돌아온다
    await dropTask(sentId); sentId = null;
    await dropTask(dupId); dupId = null;
    const back = await todo(token);
    push('시드를 지우면 기준선으로 돌아온다',
      (back.taskCount || 0) === baseTask && back.total === baseTotal,
      `task ${back.taskCount} (기준 ${baseTask}) · total ${back.total} (기준 ${baseTotal}) — 안 돌아오면 이 검사는 무효`);
  } catch (e) {
    push('카나리 실행', false, String(e && e.message || e));
  } finally {
    await dropAll();
  }
  return results;
}

module.exports = { run };
