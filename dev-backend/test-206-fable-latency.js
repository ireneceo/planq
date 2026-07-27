/* Fable — hold/resume 지연 실측 (nonzero in_progress 라운드에서 lock deadlock 검증, 실행 후 rm) */
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
(async () => {
  const login = await api('POST', '/api/auth/login', { email: 'health-check@planq.kr', password: 'HealthCheck2026!' });
  TOKEN = login.j.data.token;
  const { Task, TaskStatusHistory } = require('./models');
  const sequelize = TaskStatusHistory.sequelize;

  const create = await api('POST', '/api/tasks', { business_id: 5, title: 'F206-지연 실측 임시 (자동삭제)' });
  const taskId = create.j.data.id;
  await api('PUT', `/api/tasks/by-business/5/${taskId}`, { status: 'in_progress' });
  // in_progress 진입 이력을 2시간 전으로 백데이트 → 보류 시 라운드 마감 2.0h != 0 → recompute 가 task.update 시도
  await sequelize.query('UPDATE task_status_history SET created_at = DATE_SUB(NOW(), INTERVAL 2 HOUR) WHERE task_id = ? AND to_status = \'in_progress\'', { replacements: [taskId] });

  let t0 = Date.now();
  const hold = await api('POST', `/api/tasks/${taskId}/hold`, { reason: '지연 실측' });
  const holdMs = Date.now() - t0;
  console.log(`HOLD http=${hold.status} latency=${holdMs}ms`);

  let t1 = Date.now();
  const resume = await api('POST', `/api/tasks/${taskId}/resume`);
  const resumeMs = Date.now() - t1;
  console.log(`RESUME http=${resume.status} latency=${resumeMs}ms`);

  const task = await Task.findByPk(taskId);
  console.log(`actual_hours=${task.actual_hours} (기대 2.0 — in_progress 2h 라운드) source=${task.actual_source} status=${task.status}`);

  // cleanup
  await api('DELETE', `/api/tasks/by-business/5/${taskId}`);
  await TaskStatusHistory.destroy({ where: { task_id: taskId } });
  console.log('cleanup done. taskId=', taskId);
  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(2); });
