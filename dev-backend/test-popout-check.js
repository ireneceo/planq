// 팝아웃 체크박스 완료처리 — 실 HTTP 검증 (Fable 게이트 전 자체 확인)
// 생성은 모델 직접(= createTask 의 autoAiEstimate LLM 비용 회피), 전이는 전부 실 HTTP.
// 종료 시 생성한 테스트 데이터 전량 삭제.
const { Task, TaskReviewer, TaskStatusHistory, User, BusinessMember } = require('./models');

const BASE = 'http://localhost:3003';
const EMAIL = 'health-check@planq.kr';
const PASSWORD = 'HealthCheck2026!';
const BIZ = 5;

const created = [];
let pass = 0, fail = 0;
function ck(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const j = await r.json();
  if (!j.success) throw new Error('login failed: ' + JSON.stringify(j).slice(0, 300));
  return j.data.token;
}

function api(token) {
  return async (path, method = 'GET', body) => {
    const r = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    let j = null;
    try { j = await r.json(); } catch { /* noop */ }
    return { status: r.status, ok: r.ok, json: j };
  };
}

function mondayOfToday() {
  const d = new Date();
  const dow = (d.getDay() + 6) % 7;         // 월=0
  d.setDate(d.getDate() - dow);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function mkTask(userId, status, title) {
  const t = await Task.create({
    business_id: BIZ, title, status,
    assignee_id: userId, created_by: userId,
    planned_week_start: mondayOfToday(),
    completed_at: ['completed', 'canceled'].includes(status) ? new Date() : null,
    source: 'manual',
  });
  created.push(t.id);
  return t;
}

(async () => {
  const me = await User.findOne({ where: { email: EMAIL } });
  if (!me) throw new Error('test user not found');
  const token = await login();
  const call = api(token);
  console.log(`\n로그인 OK — user_id=${me.id}, business=${BIZ}\n`);

  // ── 1. my-week 가 reviewer_count 를 싣는가 + 기존 컬럼 무손실 ──────────
  console.log('[A] my-week reviewer_count');
  const tA = await mkTask(me.id, 'in_progress', '[TEST] popout A reviewer_count');
  const tAr = await mkTask(me.id, 'in_progress', '[TEST] popout A with reviewer');
  const reviewer = await BusinessMember.findOne({ where: { business_id: BIZ, user_id: { [require('sequelize').Op.ne]: me.id } } });
  if (reviewer) await TaskReviewer.create({ task_id: tAr.id, user_id: reviewer.user_id, state: 'pending', added_by_user_id: me.id });

  const wk = await call(`/api/tasks/my-week?business_id=${BIZ}`);
  ck('my-week 200', wk.status === 200, `status=${wk.status}`);
  const rows = wk.json?.data?.tasks || [];
  const rowA = rows.find((r) => r.id === tA.id);
  const rowAr = rows.find((r) => r.id === tAr.id);
  ck('신규 task 가 my-week 에 등장', !!rowA);
  ck('reviewer_count 필드 존재', rowA && rowA.reviewer_count !== undefined, `value=${JSON.stringify(rowA?.reviewer_count)}`);
  ck('reviewer 0 → 0', rowA && Number(rowA.reviewer_count) === 0, `Number()=${Number(rowA?.reviewer_count)}`);
  if (reviewer) ck('reviewer 1 → 1', rowAr && Number(rowAr.reviewer_count) === 1, `Number()=${Number(rowAr?.reviewer_count)}`);
  // ★ attributes:{include} 를 배열로 잘못 쓰면 여기가 깨진다 (전 컬럼 소실 반증)
  ck('기존 컬럼 무손실 (title/status/due_date/progress_percent/priority_order)',
    rowA && rowA.title && rowA.status && 'due_date' in rowA && 'progress_percent' in rowA && 'priority_order' in rowA,
    `keys=${rowA ? Object.keys(rowA).length : 0}`);
  ck('include(Project/assignee) 유지', rowA && 'Project' in rowA && 'assignee' in rowA);
  ck('summary/capacity/burndown 무회귀',
    !!wk.json?.data?.summary && !!wk.json?.data?.burndown, `keys=${Object.keys(wk.json?.data || {}).join(',')}`);

  // ── 2. reviewer 0 · in_progress → /complete ──────────────────────────
  console.log('\n[B] reviewer0 in_progress → 체크 → completed');
  const r1 = await call(`/api/tasks/${tA.id}/complete`, 'POST');
  ck('/complete 200', r1.status === 200, `status=${r1.status} msg=${r1.json?.message || ''}`);
  await tA.reload();
  ck('status=completed', tA.status === 'completed', tA.status);
  ck('completed_at 기록', !!tA.completed_at, String(tA.completed_at));
  const hist1 = await TaskStatusHistory.findOne({ where: { task_id: tA.id, event_type: 'completed' }, order: [['id', 'DESC']] });
  ck('history event_type=completed', !!hist1, hist1 ? `from=${hist1.from_status} to=${hist1.to_status}` : 'none');
  ck('history from_status=in_progress', hist1?.from_status === 'in_progress', hist1?.from_status);

  // ── 3. ★ 신규 가드: completed 재호출 → 400 task_closed ────────────────
  console.log('\n[C] ★ closed 가드 (신규)');
  const r2 = await call(`/api/tasks/${tA.id}/complete`, 'POST');
  ck('completed 재호출 → 400', r2.status === 400, `status=${r2.status}`);
  ck('code=task_closed', r2.json?.message === 'task_closed', String(r2.json?.message));

  const tC = await mkTask(me.id, 'canceled', '[TEST] popout C canceled');
  const r3 = await call(`/api/tasks/${tC.id}/complete`, 'POST');
  ck('canceled → 400 (뒤집힘 차단)', r3.status === 400, `status=${r3.status}`);
  ck('code=task_closed', r3.json?.message === 'task_closed', String(r3.json?.message));
  await tC.reload();
  ck('canceled 그대로 유지', tC.status === 'canceled', tC.status);

  // ── 4. reviewer0 completed → /revert-status (언체크) ──────────────────
  console.log('\n[D] reviewer0 completed → 언체크');
  const r4 = await call(`/api/tasks/${tA.id}/revert-status`, 'POST');
  ck('/revert-status 200', r4.status === 200, `status=${r4.status} msg=${r4.json?.message || ''}`);
  await tA.reload();
  ck('직전 상태(in_progress) 복귀', tA.status === 'in_progress', tA.status);
  const hist2 = await TaskStatusHistory.findOne({ where: { task_id: tA.id, event_type: 'revert' }, order: [['id', 'DESC']] });
  ck("history event_type='revert'", !!hist2, hist2 ? `from=${hist2.from_status} to=${hist2.to_status}` : 'none');

  // ── 5. reviewer>=1 · /complete 차단 유지 (기존 동작 무회귀) ────────────
  console.log('\n[E] reviewer≥1 → /complete 차단 (무회귀)');
  if (reviewer) {
    const r5 = await call(`/api/tasks/${tAr.id}/complete`, 'POST');
    ck('400 not_ready_for_complete', r5.status === 400 && r5.json?.message === 'not_ready_for_complete',
      `status=${r5.status} msg=${r5.json?.message}`);
  } else { console.log('  ⏭  다른 멤버 없음 — skip'); }

  // ── 6. reviewer>=1 · in_progress → /submit-review ────────────────────
  console.log('\n[F] reviewer≥1 in_progress → 확인요청');
  if (reviewer) {
    const r6 = await call(`/api/tasks/${tAr.id}/submit-review`, 'POST');
    ck('/submit-review 200', r6.status === 200, `status=${r6.status} msg=${r6.json?.message || ''}`);
    await tAr.reload();
    ck('status=reviewing (completed 아님)', tAr.status === 'reviewing', tAr.status);
    const revs = await TaskReviewer.findAll({ where: { task_id: tAr.id } });
    ck('컨펌자 전원 pending', revs.length > 0 && revs.every((r) => r.state === 'pending'),
      revs.map((r) => r.state).join(','));
  }

  // ── 7. 타 사용자 → 403 only_assignee ────────────────────────────────
  console.log('\n[G] 담당자 아닌 사용자');
  const other = await mkTask(me.id, 'in_progress', '[TEST] popout G other-assignee');
  await other.update({ assignee_id: reviewer ? reviewer.user_id : me.id });
  if (reviewer) {
    const r7 = await call(`/api/tasks/${other.id}/complete`, 'POST');
    ck('403 only_assignee', r7.status === 403 && r7.json?.message === 'only_assignee',
      `status=${r7.status} msg=${r7.json?.message}`);
  }

  console.log(`\n───────────── ${pass} PASS / ${fail} FAIL ─────────────`);
  process.exitCode = fail === 0 ? 0 : 1;
})()
  .catch((e) => { console.error('\n💥', e); process.exitCode = 1; })
  .finally(async () => {
    // 테스트 데이터 원복
    if (created.length) {
      await TaskStatusHistory.destroy({ where: { task_id: created } });
      await TaskReviewer.destroy({ where: { task_id: created } });
      await Task.destroy({ where: { id: created }, force: true });
      console.log(`정리 완료 — task ${created.join(',')} 삭제`);
    }
    process.exit(process.exitCode || 0);
  });
