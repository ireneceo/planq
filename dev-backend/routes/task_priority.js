// 우선순위(priority_order) 쓰기 전용 라우트 — #250 ②청크.
//
// tasks.js 는 2,449줄로 godfile 래칫 한도(라우트 500줄)를 이미 크게 넘겨 동결돼 있다 —
//   신규 엔드포인트를 거기 얹지 않는다. 로직은 `services/taskPriority.js` 가 정본이고
//   이 파일은 얇은 HTTP 껍데기다.
//
// ★ mount 는 `/api/tasks` 체인 **최상단** (server.js — task_estimations 보다도 앞).
//   리터럴 `/priority/*` 가 다른 라우터의 파라미터 패턴(`/:taskId/...`)에 먹히지 않게 하는 방어선이다.
//   현재는 세그먼트 수가 달라 충돌이 없지만, 미래에 라우트가 추가돼도 안전하도록 위치로 못박는다.
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { assertMemberOrAbove } = require('../middleware/access_scope');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { resolvePeriod, reindexPriorities, togglePriority } = require('../services/taskPriority');
const { logAudit } = require('../services/auditService');

// 변경된 task 를 실시간 반영 (CLAUDE.md 운영 안정성 §16 (b)).
//   ★ broadcastInboxRefresh 는 호출하지 않는다 — 우선순위는 inbox 카운트와 무관하고,
//     호출하면 팝아웃이 이중 reload 한다(Fable 설계 조건 9).
//   ★ #277 — 표시명 직렬화는 **배치**로 한다. reindex 1회에 N건을 emit 하므로 per-task
//     조회/헬퍼면 드래그 한 번에 쿼리가 폭증한다. serializeTasksForBroadcast 가 조회 1 + 표시명 1.
async function broadcastChanged(req, tasks) {
  const io = req.app.get('io');
  if (!io || !tasks.length) return;
  const { serializeTasksForBroadcast } = require('../services/taskBroadcast');
  const bizId = tasks[0].business_id;
  let byId = new Map();
  try {
    const rows = await serializeTasksForBroadcast(tasks.map((t) => t.id), bizId);
    byId = new Map(rows.map((r) => [r.id, r]));
  } catch (e) { console.warn('[task_priority broadcastChanged serialize]', e.message); }
  for (const t of tasks) {
    const raw = typeof t.toJSON === 'function' ? t.toJSON() : { ...t };
    const payload = { ...(byId.get(raw.id) || raw), actor_user_id: req.user.id };
    if (payload.project_id) io.to(`project:${payload.project_id}`).emit('task:updated', payload);
    io.to(`business:${payload.business_id}`).emit('task:updated', payload);
  }
}

// 공통 전처리 — business_id 검증 + member 이상 + 기간 확정.
//   client 는 제외한다: my-week 우선순위는 client 에게 존재하지 않는 개념이다
//   (tasks.js 의 assertBusinessAccess 는 client 도 통과시키므로 그걸 쓰면 안 된다 — Fable 조건 7).
async function prepare(req, res) {
  const businessId = Number(req.body.business_id || req.user.active_business_id);
  if (!businessId) { errorResponse(res, 'business_id required', 400); return null; }
  if (!(await assertMemberOrAbove(req.user.id, businessId, req.user.platform_role))) {
    errorResponse(res, 'forbidden', 403); return null;
  }
  const period = await resolvePeriod(businessId, req.body.from, req.body.to);
  if (period.error) { errorResponse(res, period.error, 400); return null; }
  return { businessId, from: period.from, to: period.to };
}

// POST /api/tasks/priority/toggle — 부여/해제 + 정본 집합 재인덱스 (원자적)
// body: { business_id?, task_id, from?, to? }
router.post('/priority/toggle', authenticateToken, async (req, res, next) => {
  try {
    const ctx = await prepare(req, res);
    if (!ctx) return;
    const taskId = Number(req.body.task_id);
    if (!taskId) return errorResponse(res, 'task_id required', 400);

    const r = await togglePriority(req.user.id, ctx.businessId, taskId, ctx.from, ctx.to);
    // 정본 집합 밖 task 는 거절한다 — 화면에 없는 업무의 번호를 만들 수 있으면 단일화가 무의미하다.
    if (r.error) return errorResponse(res, r.error, 400);

    await broadcastChanged(req, r.changed);
    logAudit(req, {
      action: 'task.priority_toggle',
      targetType: 'task',
      targetId: taskId,
      oldValue: { assigned: !r.assigning },
      newValue: { assigned: r.assigning, period: `${ctx.from}~${ctx.to}` },
    });
    return successResponse(res, {
      assigned: r.assigning,
      changed: r.changed.length,
      priorities: r.priorities,
    });
  } catch (err) { next(err); }
});

// POST /api/tasks/priority/reindex — 갭 정리(멱등). 프론트 진입 effect 를 대체한다.
// body: { business_id?, from?, to? }
//   ★ 멱등이라 changed=0 이 정상이다. 그 경우 broadcast 도 audit 도 하지 않는다 —
//     안 그러면 화면을 열기만 해도 소켓이 울려 다른 탭이 계속 reload 한다(무한 루프 벡터).
router.post('/priority/reindex', authenticateToken, async (req, res, next) => {
  try {
    const ctx = await prepare(req, res);
    if (!ctx) return;
    const r = await reindexPriorities(req.user.id, ctx.businessId, ctx.from, ctx.to);
    if (r.changed.length > 0) {
      await broadcastChanged(req, r.changed);
      logAudit(req, {
        action: 'task.priority_reindex',
        targetType: 'task',
        targetId: r.changed[0].id,
        oldValue: null,
        newValue: { changed: r.changed.length, period: `${ctx.from}~${ctx.to}` },
      });
    }
    return successResponse(res, { changed: r.changed.length, priorities: r.priorities });
  } catch (err) { next(err); }
});

module.exports = router;
