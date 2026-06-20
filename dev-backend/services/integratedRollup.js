// integratedRollup.js — 통합 보고서 롤업 (피드백 재설계)
//   프로젝트별·개인별 단위 보고를 "내용까지" 취합. 확정본은 박제, 미확정은 live + 확정/미확정 표시.
//   부서 차원 제거(개인 소속 태그만). 단위 보고를 정리·확정하면 곧 통합으로 롤업되는 한 파이프라인.
const { Op } = require('sequelize');
const { Project, BusinessMember, User, ReportUnit } = require('../models');
const { buildAutoSnapshot } = require('./reportUnitSnapshot');

const displayName = (u, uid) => u?.name_localized?.ko || u?.name || `user ${uid}`;

async function buildIntegratedRollup(businessId, periodType, periodStart) {
  const [projects, members, units] = await Promise.all([
    Project.findAll({ where: { business_id: businessId, status: 'active' }, attributes: ['id', 'name'] }),
    BusinessMember.findAll({
      where: { business_id: businessId, role: { [Op.ne]: 'ai' } },
      attributes: ['user_id', 'name', 'department_id'],
      include: [
        { model: User, as: 'user', attributes: ['id', 'name', 'name_localized'], required: false },
        { model: require('../models').Department, as: 'department', attributes: ['name'], required: false },
      ],
    }),
    ReportUnit.findAll({ where: { business_id: businessId, period_type: periodType, period_start: periodStart } }),
  ]);
  const unitMap = new Map(units.map((u) => [`${u.scope}:${u.scope_ref_id}`, u]));

  // 단위 1개 — 확정본은 박제(+overrides), 미확정은 live 재생성. 내용(snapshot) 전체 + 확정상태·코멘트.
  async function unitContent(scope, ref) {
    const existing = unitMap.get(`${scope}:${ref}`);
    const overrides = (existing && existing.edited_overrides) || {};
    let base; let status;
    if (existing && existing.status === 'confirmed') { base = existing.auto_snapshot || {}; status = 'confirmed'; }
    else { base = (await buildAutoSnapshot(businessId, scope, ref, periodType, periodStart)) || {}; status = 'draft'; }
    const snap = { ...base, ...overrides };
    return {
      snap,
      unit_status: status,
      confirmed: status === 'confirmed',
      finalized_by: existing?.finalized_by || null,
      confirmed_at: existing?.confirmed_at || null,
      narrative: existing?.narrative || '',
    };
  }

  // 프로젝트별 — 각 프로젝트 풍부 내용 (전략·워크스트림·완료·진행·이슈·블로커·산출물·다음·팀)
  const projectViews = await Promise.all(projects.map(async (p) => {
    const c = await unitContent('project', p.id);
    return { scope: 'project', ref_id: p.id, name: p.name, ...c };
  }));

  // 개인별 — 각 멤버 풍부 내용 (완료·진행·지연·블로커·다음) + 소속 부서 태그
  const memberViews = await Promise.all(members.filter((m) => m.user_id).map(async (m) => {
    const c = await unitContent('member', m.user_id);
    return { scope: 'member', ref_id: m.user_id, name: m.name || displayName(m.user, m.user_id), department: m.department?.name || null, ...c };
  }));

  // 전사 한 줄 요약 (통계 아님 — 본문 수치 한 줄)
  const sumKpi = (views, k) => views.reduce((s, v) => s + (v.snap?.kpi?.[k] || 0), 0);
  const summary = {
    projects_total: projectViews.length,
    projects_confirmed: projectViews.filter((v) => v.confirmed).length,
    members_total: memberViews.length,
    members_confirmed: memberViews.filter((v) => v.confirmed).length,
    completed_in_period: sumKpi(projectViews, 'completed_in_period'),
    in_progress: sumKpi(projectViews, 'in_progress_count'),
    open_issues: sumKpi(projectViews, 'open_issues'),
    overdue: sumKpi(projectViews, 'overdue_count'),
    deliverables: projectViews.reduce((s, v) => s + ((v.snap?.deliverables || []).length), 0),
    all_confirmed: projectViews.length + memberViews.length > 0
      && projectViews.every((v) => v.confirmed) && memberViews.every((v) => v.confirmed),
  };

  const wsUnit = unitMap.get('workspace:0');
  return {
    schema_version: 2,
    period: { type: periodType, start: periodStart },
    summary,
    projects: projectViews,
    members: memberViews,
    integrated: wsUnit
      ? { id: wsUnit.id, status: wsUnit.status, confirmed_by: wsUnit.confirmed_by, confirmed_at: wsUnit.confirmed_at, finalized_by: wsUnit.finalized_by }
      : { id: null, status: 'draft', confirmed_by: null, confirmed_at: null, finalized_by: null },
  };
}

module.exports = { buildIntegratedRollup };
