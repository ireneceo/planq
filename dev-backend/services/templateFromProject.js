// 프로젝트 → 업무 템플릿 변환 (routes/task_templates.js POST /from-project 에서 뺐다 — 라우트 500줄 한도, 2026-10-27).
//   날짜 오프셋(날짜 없음 = NULL)·그룹·중요도·역할 힌트·본문·주요·분류·공개 범위·반복·태그·액션·연결을 옮긴다(2026-10-29). 권한(멤버) 확인과 감사는 라우트가 한다.
const { Op } = require('sequelize');
const { Task, BusinessMember, ProjectWorkstream, TaskTemplate, TaskTemplateItem } = require('../models');

/**
 * @param {{ project, userId:number, excludeDone:boolean, name, description?, category? }} p
 * @returns {Promise<{ error:string } | { tpl, datedTasks, groups, undatedSkipped:number, undated:number, privateSkipped:number }>}
 */
async function buildTemplateFromProject({ project, userId, excludeDone, name, description, category }) {
  // 볼 수 있는 업무만 템플릿으로 옮긴다(공개 범위 — 남의 «나만 보기» 제목이 워크스페이스 템플릿으로 새지 않게)
  const vis = (await require('../middleware/access_scope').taskListWhere(userId, project.business_id)) || { id: -1 };
  const where = { project_id: project.id, business_id: project.business_id, [Op.and]: [vis] };
  if (excludeDone) where.status = { [Op.notIn]: ['completed', 'canceled'] };
  // 반복 업무는 시리즈 원본만 — 만들어진 회차(recurrence_parent_id 가 남의 id)는 빼야 회차 30개가 항목 30개가 되지 않는다.
  where[Op.and].push({ [Op.or]: [{ recurrence_parent_id: null }, { recurrence_parent_id: { [Op.col]: 'Task.id' } }] });
  const allTasks = await Task.findAll({
    where,
    order: [['start_date', 'ASC'], ['due_date', 'ASC'], ['created_at', 'ASC']],
  });
  // «나만 보기»(L1) 업무는 담지 않는다 — 템플릿은 워크스페이스 전원에게 보이므로 담는 순간 공개 범위가 넓어진다(복사 계약).
  const kept = allTasks.filter(t => t.vlevel !== 'L1');
  const privateSkipped = allTasks.length - kept.length;
  if (kept.length === 0) {
    return { error: 'no_tasks — 프로젝트에 템플릿으로 옮길 업무가 없습니다.' };
  }
  // 날짜는 시작·마감 **둘 중 하나만** 있어도 그날 하루짜리(기간 0)로 옮긴다.
  //   ★ 날짜가 아예 없는 업무도 옮긴다(2026-10-29 — Irene «템플릿은 디테일 다 가져가야지»). 오프셋 NULL = 적용 때 날짜 없이 만든다.
  //   ★ 날짜는 utils/datetime.ymd 로 읽는다 — DATEONLY 가 Date 객체로 와서 예전 `String(v).slice(0,10)` 은 «Wed Nov 04» 가 됐고
  //     오프셋이 전부 NaN→0 이었다(2026-10-27 실측).
  const day = require('../utils/datetime').ymd;
  // 날짜 있는 업무를 일정 순서대로 먼저, 날짜 없는 업무는 뒤에(DB 정렬은 빈 날짜를 맨 앞에 둔다).
  //   ★ 정렬은 계산된 시작(시작 없으면 마감)으로 — DB 의 start_date 정렬은 «마감만 있는» 업무를 맨 앞에 둔다(Fable 실측: D+4 가 1번).
  const s0Of = (t) => day(t.start_date) || day(t.due_date);
  const datedTasks = kept.filter(t => s0Of(t))
    .map((t, i) => ({ t, i }))
    .sort((a, b) => (s0Of(a.t) < s0Of(b.t) ? -1 : s0Of(a.t) > s0Of(b.t) ? 1 : a.i - b.i))
    .map(x => x.t);
  const tasks = [...datedTasks, ...kept.filter(t => !s0Of(t))];

  // 기준일 = 가장 이른 날짜(시작·마감 모두에서) — 마감만 있는 업무가 더 이르면 음수 오프셋이 나던 것을 막는다.
  const baseStr = datedTasks.reduce((min, t) => {
    for (const d of [day(t.start_date), day(t.due_date)]) if (d && d < min) min = d;
    return min;
  }, '9999-12-31');

  const baseDate = new Date(baseStr + 'T00:00:00Z');
  const dayMs = 86400000;
  const calcOffset = (dateStr) => Math.round((new Date(dateStr + 'T00:00:00Z') - baseDate) / dayMs);

  // role_hint 자동 추출 — assignee 의 BusinessMember.job_title 사용
  const assigneeIds = Array.from(new Set(tasks.map(t => t.assignee_id).filter(Boolean)));
  const memberRows = assigneeIds.length > 0
    ? await BusinessMember.findAll({ where: { user_id: assigneeIds, business_id: project.business_id } })
    : [];
  const userToHint = {};
  memberRows.forEach(m => { userToHint[m.user_id] = m.job_title || null; });

  // 추진과제(그룹) — 옮기는 업무가 쓰는 그룹만, 프로젝트 순서·색 그대로.
  const wsIds = Array.from(new Set(tasks.map(t => t.workstream_id).filter(Boolean)));
  const wsRows = wsIds.length
    ? await ProjectWorkstream.findAll({
      where: { id: wsIds, project_id: project.id, business_id: project.business_id },
      order: [['order_index', 'ASC'], ['id', 'ASC']],
    })
    : [];
  const wsTitleById = new Map(wsRows.map(w => [Number(w.id), w.title]));
  const groups = wsRows.map(w => ({ title: w.title, color: w.color || null, description: w.description || null }));

  // 태그 이름·결과물 액션·같은 템플릿 안 선행 연결(services/templateDetails 한 곳).
  const extras = await require('./templateDetails').collectTaskExtras(tasks, project.business_id);

  let totalDur = 0;
  const tpl = await TaskTemplate.create({
    business_id: project.business_id,
    name: String(name).trim().slice(0, 200),
    description: description ? String(description).slice(0, 2000) : null,
    category: category ? String(category).slice(0, 50) : 'custom',
    is_system: false,
    is_default: false,
    task_count: tasks.length,
    total_duration_days: 0, // 아래에서 갱신
    workstreams: groups.length ? groups : null,
    created_by: userId,
    source_project_id: project.id,
  });

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const s0 = day(t.start_date) || day(t.due_date);
    const d0 = day(t.due_date) || day(t.start_date);
    let off = null;
    let dur = null;
    if (s0) {
      off = calcOffset(s0);
      // 기간 = 마감 − 시작(0 = 같은 날). 적용은 마감 = 시작 + 기간 이라 날짜가 그대로 돌아온다. 마감이 시작보다 이르면 0.
      dur = Math.max(0, calcOffset(d0) - off);
      if (off + dur > totalDur) totalDur = off + dur;
    }
    const ex = extras.get(t.id) || {};

    await TaskTemplateItem.create({
      template_id: tpl.id,
      order_index: i,
      title: t.title,
      description: t.description || null,
      body: t.body || null,
      start_offset_days: off,
      duration_days: dur,
      estimated_hours: t.estimated_hours || null,
      // 중요도도 옮긴다(적용이 priority 를 priority_level 로 되돌린다). 미지정이면 normal.
      priority: ['urgent', 'high', 'normal', 'low'].includes(t.priority_level) ? t.priority_level : 'normal',
      role_hint: userToHint[t.assignee_id] || null,
      workstream_title: t.workstream_id ? (wsTitleById.get(Number(t.workstream_id)) || null) : null,
      is_milestone: !!t.is_milestone,
      category: t.category || null,
      // 공개 범위는 넓히지 않는다 — L2 는 «지정 멤버» 없이 L2(프로젝트 범위)로.
      vlevel: ['L2', 'L3', 'L4'].includes(t.vlevel) ? t.vlevel : 'L3',
      security_level: t.security_level || 'general',
      recurrence_rule: t.recurrence_rule || null,
      tag_names: ex.tag_names || null,
      action_items: ex.action_items || null,
      depends_on_indexes: ex.depends_on_indexes || null,
    });
  }

  await tpl.update({ total_duration_days: totalDur });
  // 신규 템플릿 → AI 추천 매칭용 임베딩 생성 (background, best-effort)
  require('./templateEmbedding').recomputeTemplateEmbedding(tpl.id).catch(() => null);

  // undatedSkipped 는 옛 응답 호환(이제 빠지지 않으므로 0) — 날짜 없이 담긴 수는 undated, 나만 보기로 빠진 수는 private_skipped.
  return { tpl, datedTasks: tasks, groups, undatedSkipped: 0, undated: tasks.length - datedTasks.length, privateSkipped };
}

module.exports = { buildTemplateFromProject };
