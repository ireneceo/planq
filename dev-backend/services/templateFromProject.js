// 프로젝트 → 업무 템플릿 변환 (routes/task_templates.js POST /from-project 에서 뺐다 — 라우트 500줄 한도, 2026-10-27).
//   날짜 오프셋·그룹(추진과제)·중요도·역할 힌트를 옮긴다. 권한(멤버) 확인과 감사는 라우트가 한다.
const { Op } = require('sequelize');
const { Task, BusinessMember, ProjectWorkstream, TaskTemplate, TaskTemplateItem } = require('../models');

/**
 * @param {{ project, userId:number, excludeDone:boolean, name, description?, category? }} p
 * @returns {Promise<{ error:string } | { tpl, datedTasks, groups, undatedSkipped:number }>}
 */
async function buildTemplateFromProject({ project, userId, excludeDone, name, description, category }) {
  // 볼 수 있는 업무만 템플릿으로 옮긴다(공개 범위 — 남의 «나만 보기» 제목이 워크스페이스 템플릿으로 새지 않게)
  const vis = (await require('../middleware/access_scope').taskListWhere(userId, project.business_id)) || { id: -1 };
  const where = { project_id: project.id, business_id: project.business_id, [Op.and]: [vis] };
  if (excludeDone) where.status = { [Op.notIn]: ['completed', 'canceled'] };
  const tasks = await Task.findAll({
    where,
    order: [['start_date', 'ASC'], ['due_date', 'ASC'], ['created_at', 'ASC']],
  });
  // 날짜는 시작·마감 **둘 중 하나만** 있어도 옮긴다(예전엔 둘 다 있어야 해서 마감만 정한 업무가 조용히 빠졌다).
  //   하나만 있으면 그날 하루짜리(기간 0). 날짜가 아예 없는 업무만 뺀다 — 적용할 날을 정할 수 없다.
  //   ★ 날짜는 utils/datetime.ymd 로 읽는다 — DATEONLY 가 Date 객체로 와서 예전 `String(v).slice(0,10)` 은 «Wed Nov 04» 가 됐고
  //     오프셋이 전부 NaN→0 이었다(임의로 짠 일정이 적용하면 전부 첫날·이튿날로 뭉쳤다 — 2026-10-27 실측).
  const day = require('../utils/datetime').ymd;
  const datedTasks = tasks.filter(t => day(t.start_date) || day(t.due_date));
  if (datedTasks.length === 0) {
    return { error: 'no_dated_tasks — 프로젝트에 시작/마감 날짜가 있는 업무가 없습니다.' };
  }

  // 기준일 = 가장 이른 날짜(시작·마감 모두에서) — 마감만 있는 업무가 더 이르면 음수 오프셋이 나던 것을 막는다.
  const baseStr = datedTasks.reduce((min, t) => {
    for (const d of [day(t.start_date), day(t.due_date)]) if (d && d < min) min = d;
    return min;
  }, '9999-12-31');

  const baseDate = new Date(baseStr + 'T00:00:00Z');
  const dayMs = 86400000;
  const calcOffset = (dateStr) => Math.round((new Date(dateStr + 'T00:00:00Z') - baseDate) / dayMs);

  // role_hint 자동 추출 — assignee 의 BusinessMember.job_title 사용
  const assigneeIds = Array.from(new Set(datedTasks.map(t => t.assignee_id).filter(Boolean)));
  const memberRows = assigneeIds.length > 0
    ? await BusinessMember.findAll({ where: { user_id: assigneeIds, business_id: project.business_id } })
    : [];
  const userToHint = {};
  memberRows.forEach(m => { userToHint[m.user_id] = m.job_title || null; });

  // 추진과제(그룹) — 옮기는 업무가 쓰는 그룹만, 프로젝트 순서·색 그대로.
  const wsIds = Array.from(new Set(datedTasks.map(t => t.workstream_id).filter(Boolean)));
  const wsRows = wsIds.length
    ? await ProjectWorkstream.findAll({
      where: { id: wsIds, project_id: project.id, business_id: project.business_id },
      order: [['order_index', 'ASC'], ['id', 'ASC']],
    })
    : [];
  const wsTitleById = new Map(wsRows.map(w => [Number(w.id), w.title]));
  const groups = wsRows.map(w => ({ title: w.title, color: w.color || null, description: w.description || null }));

  let totalDur = 0;
  const tpl = await TaskTemplate.create({
    business_id: project.business_id,
    name: String(name).trim().slice(0, 200),
    description: description ? String(description).slice(0, 2000) : null,
    category: category ? String(category).slice(0, 50) : 'custom',
    is_system: false,
    is_default: false,
    task_count: datedTasks.length,
    total_duration_days: 0, // 아래에서 갱신
    workstreams: groups.length ? groups : null,
    created_by: userId,
  });

  for (let i = 0; i < datedTasks.length; i++) {
    const t = datedTasks[i];
    const s0 = day(t.start_date) || day(t.due_date);
    const d0 = day(t.due_date) || day(t.start_date);
    const off = calcOffset(s0);
    // 기간 = 마감 − 시작(0 = 같은 날). 적용은 마감 = 시작 + 기간 이라 날짜가 그대로 돌아온다.
    //   예전 max(1, …) 은 하루짜리 업무를 이틀로 늘렸다. 마감이 시작보다 이르면(잘못 든 날짜) 0.
    const dur = Math.max(0, calcOffset(d0) - off);
    const endOffset = off + dur;
    if (endOffset > totalDur) totalDur = endOffset;

    await TaskTemplateItem.create({
      template_id: tpl.id,
      order_index: i,
      title: t.title,
      description: t.description || null,
      start_offset_days: off,
      duration_days: dur,
      estimated_hours: t.estimated_hours || null,
      // 중요도도 옮긴다(적용이 priority 를 priority_level 로 되돌린다). 미지정이면 normal.
      priority: ['urgent', 'high', 'normal', 'low'].includes(t.priority_level) ? t.priority_level : 'normal',
      role_hint: userToHint[t.assignee_id] || null,
      workstream_title: t.workstream_id ? (wsTitleById.get(Number(t.workstream_id)) || null) : null,
    });
  }

  await tpl.update({ total_duration_days: totalDur });
  // 신규 템플릿 → AI 추천 매칭용 임베딩 생성 (background, best-effort)
  require('./templateEmbedding').recomputeTemplateEmbedding(tpl.id).catch(() => null);

  return { tpl, datedTasks, groups, undatedSkipped: tasks.length - datedTasks.length };
}

module.exports = { buildTemplateFromProject };
