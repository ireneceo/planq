// 내 순서(사람별 업무 순서) — **쓰는 문 하나** (docs/TASK_USER_ORDER_DESIGN.md · Fable 설계 2026-10-12)
//
//   ① 화면이 드롭 **뒤** 목록의 표시 순서(visible_ids)를 준다 — 서버는 화면 정렬(localStorage)을 모르므로 추측하지 않는다.
//   ② 그중 순위 행이 없는 업무(옮기는 것 제외)를 표시 순서대로 끝에 먼저 물질화한다 — 매 요청 같은 규칙(분기 없음).
//   ③ 옮기는 업무는 이웃(before/after) 사이값. 간격이 닳으면 (user,biz) 전체를 GAP 간격으로 재배치.
//   priority_order(전역 칸)는 건드리지 않는다.
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { Task, TaskUserOrder } = require('../models');
const { getUserScope, canAccessTask } = require('../middleware/access_scope');

const GAP = 65536;
const MAX_VISIBLE = 500;

class OrderError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

function parseIds(raw) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_VISIBLE) return null;
  const ids = raw.map(Number);
  if (ids.some((n) => !Number.isInteger(n) || n <= 0)) return null;
  if (new Set(ids).size !== ids.length) return null;
  return ids;
}

/** 이 사용자·워크스페이스의 순위를 task id 목록에 대해 읽는다 — my-week 가 my_pos 로 싣는다. */
async function readPositions(userId, businessId, taskIds) {
  if (!taskIds.length) return new Map();
  const rows = await TaskUserOrder.findAll({
    where: { user_id: userId, business_id: businessId, task_id: { [Op.in]: taskIds } },
    attributes: ['task_id', 'pos'], raw: true,
  });
  return new Map(rows.map((r) => [Number(r.task_id), Number(r.pos)]));
}

/**
 * @returns {{ positions: Array<{task_id:number,pos:number}>, rebalanced: boolean }}
 * @throws OrderError
 */
async function moveTask(userId, businessId, platformRole, body) {
  const taskId = Number(body.task_id);
  if (!Number.isInteger(taskId) || taskId <= 0) throw new OrderError(400, 'task_id required');
  const visible = parseIds(body.visible_ids);
  if (!visible) throw new OrderError(400, 'visible_ids invalid');
  const idx = visible.indexOf(taskId);
  if (idx < 0) throw new OrderError(400, 'visible_ids invalid');
  const norm = (v) => (v === null || v === undefined ? null : Number(v));
  const beforeId = norm(body.before_id);   // 바로 위(앞)
  const afterId = norm(body.after_id);     // 바로 아래(뒤)
  if (beforeId !== (idx > 0 ? visible[idx - 1] : null) || afterId !== (idx < visible.length - 1 ? visible[idx + 1] : null)) {
    throw new OrderError(400, 'neighbors_mismatch');
  }

  // 모든 id 가 이 워크스페이스 업무이고, 이 사람이 읽을 수 있어야 한다(읽기와 같은 술어).
  const tasks = await Task.findAll({
    where: { id: { [Op.in]: visible }, business_id: businessId },
    attributes: ['id', 'business_id', 'project_id', 'assignee_id', 'created_by', 'request_by_user_id', 'conversation_id'],
  });
  if (tasks.length !== visible.length) throw new OrderError(404, 'task_not_found');
  const scope = await getUserScope(userId, businessId, platformRole);
  for (const t of tasks) {
    if (!(await canAccessTask(userId, t, scope))) throw new OrderError(403, 'task_forbidden');
  }

  return sequelize.transaction(async (tx) => {
    const changed = new Map();
    let rebalanced = false;
    const loadMine = async () => TaskUserOrder.findAll({
      where: { user_id: userId, business_id: businessId }, order: [['pos', 'ASC'], ['id', 'ASC']],
      transaction: tx, lock: tx.LOCK.UPDATE,
    });
    let mine = await loadMine();
    const byTask = new Map(mine.map((r) => [Number(r.task_id), r]));

    // ② 물질화 — 행 없는 보이는 업무를 표시 순서대로 끝에
    let maxPos = mine.length ? Number(mine[mine.length - 1].pos) : 0;
    for (const id of visible) {
      if (id === taskId || byTask.has(id)) continue;
      maxPos += GAP;
      const row = await TaskUserOrder.create({ business_id: businessId, user_id: userId, task_id: id, pos: maxPos }, { transaction: tx });
      byTask.set(id, row); changed.set(id, maxPos);
    }

    const posOf = (id) => (id === null ? null : Number(byTask.get(id).pos));
    const compute = () => {
      const a = posOf(beforeId); const b = posOf(afterId);
      if (a === null && b === null) {
        const others = [...byTask.values()].filter((r) => Number(r.task_id) !== taskId).map((r) => Number(r.pos));
        return others.length ? Math.min(...others) - GAP : 0;
      }
      if (a === null) return b - GAP;
      if (b === null) return a + GAP;
      if (b - a < 2) return null;   // 간격이 닳았다 → 재배치
      return Math.floor((a + b) / 2);
    };
    let next = compute();
    if (next === null) {
      // ③ 재배치 — 지금 순서(pos, id)를 그대로 두고 간격만 새로 깐다
      mine = [...byTask.values()].sort((x, y) => (Number(x.pos) - Number(y.pos)) || (Number(x.id) - Number(y.id)));
      for (let i = 0; i < mine.length; i++) {
        const p = (i + 1) * GAP;
        if (Number(mine[i].pos) !== p) { await mine[i].update({ pos: p }, { transaction: tx }); changed.set(Number(mine[i].task_id), p); }
      }
      rebalanced = true;
      next = compute();
    }

    const own = byTask.get(taskId);
    if (own) {
      if (Number(own.pos) !== next) await own.update({ pos: next }, { transaction: tx });
    } else {
      const row = await TaskUserOrder.create({ business_id: businessId, user_id: userId, task_id: taskId, pos: next }, { transaction: tx });
      byTask.set(taskId, row);
    }
    changed.set(taskId, next);
    // 응답·실시간은 **보이는 목록 전부** + 재배치로 바뀐 행을 싣는다 — 화면은 끌자마자 그 목록에 임시 순서를 매기므로,
    //   바뀐 행만 돌려주면 임시값과 서버값이 섞여 옮긴 행이 엉뚱한 자리로 튄다(2026-10-12 실측: Alt+↓ 가 한 칸이 아니었다).
    for (const id of visible) changed.set(id, Number(byTask.get(id).pos));
    changed.set(taskId, next);
    return { positions: [...changed].map(([task_id, pos]) => ({ task_id, pos })), rebalanced };
  });
}

module.exports = { moveTask, readPositions, OrderError, GAP };
