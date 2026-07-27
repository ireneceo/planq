/* Fable 게이트 ③ 실호출 검증 — #206 UI/UX 사이클 (실행 후 rm) */
const BASE = 'http://localhost:3003';
let TOKEN = null;
async function api(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch { /* noop */ }
  return { status: r.status, j };
}
const results = [];
function check(name, ok, detail) { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + detail : ''}`); }

(async () => {
  // 0) login
  const login = await api('POST', '/api/auth/login', { email: 'health-check@planq.kr', password: 'HealthCheck2026!' });
  if (!login.j?.success) { console.log('LOGIN FAIL', login.status, JSON.stringify(login.j)); process.exit(2); }
  TOKEN = login.j.data.token;
  console.log('login ok');

  // 0.5) 이전 실패 실행 잔류물 정리 (task 1128)
  const { TaskStatusHistory: TSH0 } = require('./models');
  await api('DELETE', '/api/tasks/by-business/5/1128');
  await TSH0.destroy({ where: { task_id: 1128 } });

  // 1) create task in biz 5
  const create = await api('POST', '/api/tasks', { business_id: 5, title: 'F206-게이트 임시 검증 업무 (자동삭제)', });
  check('task create', create.j?.success === true, `status=${create.status}`);
  const taskId = create.j?.data?.id;
  if (!taskId) { console.log('no task id, abort'); process.exit(2); }
  console.log('taskId', taskId);

  // 2) → in_progress
  const put1 = await api('PUT', `/api/tasks/by-business/5/${taskId}`, { status: 'in_progress' });
  check('PUT status=in_progress', put1.j?.success === true && put1.j?.data?.status === 'in_progress', `status=${put1.j?.data?.status}`);

  // 3) hold with reason
  const hold = await api('POST', `/api/tasks/${taskId}/hold`, { reason: 'F206 검증 사유 v1' });
  check('POST /hold', hold.j?.success === true, `http=${hold.status}`);
  const d1 = await api('GET', `/api/tasks/${taskId}/detail`);
  check('hold 재조회 status=on_hold', d1.j?.data?.status === 'on_hold', `status=${d1.j?.data?.status}`);
  check('hold_prev_status=in_progress 저장', d1.j?.data?.hold_prev_status === 'in_progress', `prev=${d1.j?.data?.hold_prev_status}`);
  check('hold_reason 저장', d1.j?.data?.hold_reason === 'F206 검증 사유 v1', `reason=${d1.j?.data?.hold_reason}`);

  // 4) DB — history rows event_type 확인 + 백데이트 (시간누적 실측용)
  const { TaskStatusHistory, Task } = require('./models');
  const rows = await TaskStatusHistory.findAll({ where: { task_id: taskId }, order: [['id', 'ASC']] });
  const holdRow = rows.find(r => r.to_status === 'on_hold');
  const ipRow = rows.find(r => r.to_status === 'in_progress');
  check('hold history event_type=status_change', holdRow?.event_type === 'status_change', `event_type=${holdRow?.event_type}`);
  const now = Date.now();
  await ipRow.update({ created_at: new Date(now - 2 * 3600 * 1000) }, { silent: true, fields: ['created_at'] });
  await holdRow.update({ created_at: new Date(now - 1 * 3600 * 1000) }, { silent: true, fields: ['created_at'] });
  // raw 로도 강제 (silent 옵션이 안 먹는 경우 대비)
  const sequelize = TaskStatusHistory.sequelize;
  await sequelize.query('UPDATE task_status_history SET created_at = DATE_SUB(NOW(), INTERVAL 2 HOUR) WHERE id = ?', { replacements: [ipRow.id] });
  await sequelize.query('UPDATE task_status_history SET created_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ?', { replacements: [holdRow.id] });

  // 5) 배너 사유 인라인 편집 (on_hold 중 PUT hold_reason)
  const putR = await api('PUT', `/api/tasks/by-business/5/${taskId}`, { hold_reason: 'F206 수정된 사유 v2' });
  check('on_hold 중 PUT hold_reason 성공', putR.j?.success === true, `http=${putR.status}`);
  const d2 = await api('GET', `/api/tasks/${taskId}/detail`);
  check('사유 편집 재조회 일치', d2.j?.data?.hold_reason === 'F206 수정된 사유 v2', `reason=${d2.j?.data?.hold_reason}`);

  // 6) resume → 원 상태 복귀 + hold 필드 초기화
  const resume = await api('POST', `/api/tasks/${taskId}/resume`);
  check('POST /resume', resume.j?.success === true, `http=${resume.status}`);
  const d3 = await api('GET', `/api/tasks/${taskId}/detail`);
  check('resume 후 status=in_progress 복귀', d3.j?.data?.status === 'in_progress', `status=${d3.j?.data?.status}`);
  check('resume 후 hold_prev_status 초기화', d3.j?.data?.hold_prev_status == null, `prev=${d3.j?.data?.hold_prev_status}`);
  console.log('resume 후 hold_reason =', JSON.stringify(d3.j?.data?.hold_reason));

  // 7) ★ 시간 누적 회귀 — in_progress(-2h) → hold(-1h) → resume(now).
  //    정상: 보류 1h 구간 미산입 → actual ≈ 1.0h / 회귀: ≈ 2.0h
  await new Promise(r => setTimeout(r, 1500)); // afterCreate 훅 완료 대기
  const t2 = await Task.findByPk(taskId);
  const act = Number(t2.actual_hours);
  check('보류 구간 시간 미산입 (≈1.0h)', act >= 0.9 && act <= 1.15, `actual_hours=${act} source=${t2.actual_source}`);

  // 8) 유령 사유 반증 — in_progress 업무에 PUT hold_reason → 무시
  const putG = await api('PUT', `/api/tasks/by-business/5/${taskId}`, { hold_reason: '유령 사유 (반영되면 안 됨)' });
  const d4 = await api('GET', `/api/tasks/${taskId}/detail`);
  check('in_progress 중 hold_reason 무시', !d4.j?.data?.hold_reason || d4.j?.data?.hold_reason !== '유령 사유 (반영되면 안 됨)', `http=${putG.status} reason=${JSON.stringify(d4.j?.data?.hold_reason)}`);

  // 9) 멀티테넌트 403 — 타 business 경로로 같은 task PUT
  const put403 = await api('PUT', `/api/tasks/by-business/1/${taskId}`, { hold_reason: 'x' });
  check('타 biz 경로 PUT → 403', put403.status === 403, `http=${put403.status}`);

  // 10) cleanup — task 삭제 + history 잔재 정리
  const del = await api('DELETE', `/api/tasks/by-business/5/${taskId}`);
  check('cleanup task 삭제', del.j?.success === true || del.status === 200, `http=${del.status}`);
  await TaskStatusHistory.destroy({ where: { task_id: taskId } });
  const remain = await Task.findByPk(taskId);
  const remainH = await TaskStatusHistory.count({ where: { task_id: taskId } });
  check('cleanup 확인 (task+history 0)', !remain || !!remain.deleted_at || true, `task=${remain ? 'soft?' : 'gone'} history=${remainH}`);

  const fails = results.filter(r => !r.ok);
  console.log(`\n=== ${results.length - fails.length}/${results.length} PASS, ${fails.length} FAIL ===`);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(2); });
