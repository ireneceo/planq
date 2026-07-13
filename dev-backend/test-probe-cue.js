// 프로브 3 — createTask(행동 계층)를 인프로세스로 불러 afterCreate 내부 어느 await 가 180초를 먹는지 특정
require('dotenv').config();
const { Task, CueUsage, AuditLog } = require('./models');
const taskActions = require('./services/actions/task_actions');

const BIZ = 3, OWNER = 3, CUE = 11;
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';

// executeForTask 를 감싸 호출 시점을 기록 (실행 자체는 그대로)
const executor = require('./services/cue_task_executor');
const origExec = executor.executeForTask;
executor.executeForTask = async (...args) => {
  console.log(`  ★ executeForTask 호출됨 — ${el()}`);
  return origExec(...args);
};

(async () => {
  const usageBefore = await CueUsage.count();
  console.log(`createTask 호출 — ${el()}`);
  const result = await taskActions.createTask(
    { kind: 'user', userId: OWNER },
    { businessId: BIZ, title: '[probe3] afterCreate 지연 소재', assigneeId: CUE },
    { autoAiEstimate: true },   // POST /api/tasks 와 동일한 opts
  );
  const taskId = result.data.task.id;
  console.log(`createTask 반환 (task=${taskId}) — ${el()}`);

  // afterCreate 는 fire-and-forget — 최대 200초 기다리며 executeForTask 호출 시점 관찰
  const deadline = Date.now() + 200000;
  while (Date.now() < deadline) {
    const t = await Task.findByPk(taskId, { attributes: ['id', 'status', 'body'] });
    if (t && (t.status === 'reviewing' || t.body)) { console.log(`  ★ Cue 결과물 기록됨 — ${el()}`); break; }
    await new Promise((r) => setTimeout(r, 1000));
  }

  await AuditLog.destroy({ where: { target_type: 'task', target_id: taskId } });
  await Task.destroy({ where: { id: taskId }, force: true });
  console.log(`원복: task 삭제 · cue_usage ${usageBefore} → ${await CueUsage.count()}`);
  process.exit(0);
})();
