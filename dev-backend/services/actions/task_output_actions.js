// 업무 «산출물» 바꾸기 — 화면(PUT /api/tasks/:id/output-kinds)과 외부 AI·Cue(update_task)가 같은 함수
// (docs/TASK_DELIVERABLES_DESIGN.md §3.2 — task_actions.setTags 와 같은 뼈대).
//
//   권한: 작성자·담당자·owner/admin·platform_admin(태그와 같은 축 — 고객·무관 멤버 403).
//   반복 업무면 seriesTargetIds 로 범위를 정하고, 회차마다 «이번에 뺀 것만 빼고 넣은 것만 넣는다».
//   같은 목록이면 쓰지 않는다(감사·소켓 없음).
const { Op } = require('sequelize');
const { resolveSubject, fail, done } = require('./_subject');
const { getIO } = require('../taskTransition');
const outputs = require('../taskOutputKinds');

async function setOutputKinds(task, actor, { kindIds = [], seriesScope } = {}) {
  const subj = await resolveSubject(actor);
  if (!subj.ok) return subj;
  const { assertMemberOrAbove } = require('../../middleware/access_scope');
  if (!(await assertMemberOrAbove(subj.subjectId, task.business_id, subj.platformRole))) return fail('forbidden', 403);
  const { fieldContext, audit } = require('./task_actions');
  const ctx = await fieldContext(task, subj.subjectId, subj.platformRole);
  if (!(ctx.isCreator || ctx.isAssignee || ctx.isOwnerOrAdmin)) return fail('forbidden_field_output_kinds', 403);

  const v = await outputs.validateIds(task.business_id, kindIds);
  if (!v.ok) return fail(v.code);

  const { TaskOutputKindLink } = require('../../models');
  const existing = await TaskOutputKindLink.findAll({ where: { task_id: task.id }, attributes: ['output_kind_id'] });
  const before = existing.map((l) => l.output_kind_id).sort((a, b) => a - b);
  const after = [...v.ids].sort((a, b) => a - b);
  if (JSON.stringify(before) === JSON.stringify(after)) {
    const [row] = await outputs.attachOutputKindsTo([{ id: task.id }], task.business_id);
    return done({ task, output_kinds: row.output_kinds, changed: false });
  }

  const { seriesTargetIds } = require('../taskSeriesScope');
  const { ids: targetIds, scope: appliedScope } = await seriesTargetIds(task, seriesScope);
  const toAdd = after.filter((id) => !before.includes(id));
  const toRemove = before.filter((id) => !after.includes(id));
  for (const tid of targetIds) {
    if (toRemove.length) await TaskOutputKindLink.destroy({ where: { task_id: tid, output_kind_id: { [Op.in]: toRemove } } });
    if (toAdd.length) {
      await TaskOutputKindLink.bulkCreate(toAdd.map((output_kind_id) => ({ task_id: tid, output_kind_id })), { ignoreDuplicates: true });
    }
  }
  const [row] = await outputs.attachOutputKindsTo([{ id: task.id }], task.business_id);
  audit(actor, {
    action: 'task.output_kinds_update', targetType: 'task', targetId: task.id, businessId: task.business_id,
    oldValue: { output_kind_ids: before },
    newValue: { output_kind_ids: after, series_scope: appliedScope, applied_to: targetIds.length },
  });
  const io = getIO();
  if (io) {
    const { serializeTaskForBroadcast } = require('../taskBroadcast');
    const base = await serializeTaskForBroadcast(task.id, task.business_id);
    const payload = { ...(base || task.toJSON()), output_kinds: row.output_kinds, actor_user_id: subj.subjectId };
    require('../taskRoom').emitTask(io, 'task:updated', payload, { businessId: task.business_id, projectId: task.project_id })
      .catch((e) => console.warn('[emitTask]', e.message));
  }
  return done({ task, output_kinds: row.output_kinds, changed: true });
}

module.exports = { setOutputKinds };
