// 업무 템플릿 적용 서비스 (사이클 N+1)
// 템플릿 + 시작일 + 담당자 매핑 → Task 일괄 생성 + task_estimations(source='ai') row.
// 의존성 (depends_on_indexes) — 신규 생성된 task id 로 변환되어 description 안 메타로 저장 (task_dependencies 테이블 미존재 → 향후 확장).

const { Task, TaskEstimation, TaskTemplate, TaskTemplateItem, BusinessMember, User } = require('../models');
const { addDaysStr } = require('../utils/datetime');

// 멤버 매핑 — role_hint → user_id (assignee_map 명시 우선, 없으면 fuzzy)
function resolveAssignee(roleHint, assigneeMap, members) {
  if (!roleHint) return null;
  // 1) 사용자가 명시적으로 매핑한 경우
  if (assigneeMap && Object.prototype.hasOwnProperty.call(assigneeMap, roleHint)) {
    const explicit = assigneeMap[roleHint];
    return explicit ? Number(explicit) : null;
  }
  // 2) fuzzy — job_title / expertise 토큰 매칭
  const h = String(roleHint).toLowerCase().trim();
  if (!h || !members || members.length === 0) return null;
  const matches = members.filter(m => {
    const fields = [m.job_title, m.expertise, m.role].filter(Boolean).join(' ').toLowerCase();
    if (!fields) return false;
    const tokens = h.split(/[\s,/+]+/).filter(t => t.length >= 2);
    return tokens.some(tok => fields.includes(tok));
  });
  return matches.length === 1 ? matches[0].user_id : null;
}

/**
 * 템플릿 적용 — task 일괄 생성.
 * @param {Object} opts
 * @param {number} opts.templateId
 * @param {number} opts.businessId
 * @param {number} [opts.projectId]
 * @param {string} opts.startDate — YYYY-MM-DD (시작 기준일)
 * @param {Object} [opts.assigneeMap] — { roleHint: userId } 명시 매핑
 * @param {number} opts.actorUserId — 생성자
 * @returns {Promise<{ created: Task[], templateId: number }>}
 */
async function applyTemplate({ templateId, businessId, projectId = null, startDate, assigneeMap = {}, actorUserId }) {
  if (!templateId) throw new Error('templateId required');
  if (!businessId) throw new Error('businessId required');
  if (!startDate) throw new Error('startDate required (YYYY-MM-DD)');
  if (!actorUserId) throw new Error('actorUserId required');

  const template = await TaskTemplate.findByPk(templateId, {
    include: [{ model: TaskTemplateItem, as: 'items' }],
  });
  if (!template) throw new Error('template_not_found');

  // 시스템 preset 또는 같은 워크스페이스 템플릿만 적용 가능
  if (!template.is_system && template.business_id !== Number(businessId)) {
    throw new Error('forbidden_template');
  }

  // 멤버 목록 (fuzzy 매칭용)
  const memberRows = await BusinessMember.findAll({
    where: { business_id: businessId },
    attributes: ['user_id', 'role', 'job_title', 'expertise', 'name'],
    include: [{ model: User, as: 'user', attributes: ['id', 'name'] }],
  });
  const members = memberRows.map(m => ({
    user_id: m.user_id,
    name: m.name || m.user?.name || '',
    job_title: m.job_title || '',
    expertise: m.expertise || '',
    role: m.role || '',
  }));

  const items = (template.items || []).sort((a, b) => a.order_index - b.order_index);
  if (items.length === 0) {
    return { created: [], templateId: template.id };
  }

  const created = [];
  const indexToTaskId = {}; // order_index → 생성된 task.id (의존성 메타용)

  for (const item of items) {
    const start = addDaysStr(startDate, item.start_offset_days || 0);
    const due = addDaysStr(startDate, (item.start_offset_days || 0) + (item.duration_days || 1));
    const assigneeId = resolveAssignee(item.role_hint, assigneeMap, members) || actorUserId;
    const isInternalRequest = assigneeId !== actorUserId;

    // 의존성 메모 — depends_on_indexes 가 있으면 description 끝에 메타로 첨부 (task_dependencies 테이블 추가 시 정식 row)
    let descParts = [];
    if (item.description) descParts.push(String(item.description));
    if (Array.isArray(item.depends_on_indexes) && item.depends_on_indexes.length > 0) {
      const depTitles = item.depends_on_indexes
        .map(idx => items.find(it => it.order_index === idx)?.title)
        .filter(Boolean);
      if (depTitles.length > 0) {
        descParts.push(`[선행: ${depTitles.join(' / ')}]`);
      }
    }

    const task = await Task.create({
      business_id: businessId,
      project_id: projectId,
      title: String(item.title).slice(0, 200),
      description: descParts.length > 0 ? descParts.join('\n\n').slice(0, 2000) : null,
      assignee_id: assigneeId,
      start_date: start,
      due_date: due,
      estimated_hours: item.estimated_hours ? Number(item.estimated_hours) : null,
      created_by: actorUserId,
      source: isInternalRequest ? 'internal_request' : 'manual',
      request_by_user_id: isInternalRequest ? actorUserId : null,
    });

    if (item.estimated_hours) {
      try {
        await TaskEstimation.create({
          task_id: task.id,
          business_id: task.business_id,
          value: Number(item.estimated_hours),
          source: 'ai',
          model: 'task_template',
        });
      } catch { /* ignore — TaskEstimation 미존재 케이스 */ }
    }

    indexToTaskId[item.order_index] = task.id;
    created.push(task);
  }

  // usage_count 증가
  try {
    await template.increment('usage_count', { by: 1 });
  } catch { /* ignore */ }

  return { created, templateId: template.id };
}

module.exports = { applyTemplate, resolveAssignee };
