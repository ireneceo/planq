// integratedRollup.js — 통합 보고서 롤업 (R3, 마스터설계 §4.4·§4.5)
//   같은 주기·기간의 프로젝트/부서 단위 보고서를 취합. 확정본은 박제 snapshot, 미확정은 live 초안 + 뱃지.
//   확정/미확정 현황 매트릭스 + 포트폴리오 롤업. 단위 보고서가 없으면 자동 초안으로 채움(빈 화면 0).
const { Project, Department, ReportUnit } = require('../models');
const { buildAutoSnapshot, buildWorkspaceMembers } = require('./reportUnitSnapshot');

async function buildIntegratedRollup(businessId, periodType, periodStart) {
  // 대상 단위 — 활성 프로젝트 + 전체 부서
  const [projects, departments, units] = await Promise.all([
    Project.findAll({ where: { business_id: businessId, status: 'active' }, attributes: ['id', 'name'] }),
    Department.findAll({ where: { business_id: businessId }, attributes: ['id', 'name'] }),
    ReportUnit.findAll({ where: { business_id: businessId, period_type: periodType, period_start: periodStart } }),
  ]);
  const unitMap = new Map(units.map((u) => [`${u.scope}:${u.scope_ref_id}`, u]));

  // 단위 1개 행 — 확정본은 frozen snapshot(+overrides), draft 는 live 재생성(+overrides).
  //   리뷰 C1: draft 의 저장된 auto_snapshot 은 stale 일 수 있어 미확정은 항상 live 재계산.
  //   리뷰 H2: 책임자 보정(edited_overrides)을 단위뷰와 동일하게(mergedView) 롤업에도 반영.
  async function rowFor(scope, ref, name) {
    const existing = unitMap.get(`${scope}:${ref}`);
    const overrides = (existing && existing.edited_overrides) || {};
    let base; let status;
    if (existing && existing.status === 'confirmed') { base = existing.auto_snapshot || {}; status = 'confirmed'; }
    else { base = (await buildAutoSnapshot(businessId, scope, ref, periodType, periodStart)) || {}; status = 'draft'; }
    const snap = { ...base, ...overrides };  // mergedView 와 동일한 top-level 병합
    const kpi = snap.kpi || {};
    return {
      scope, ref_id: ref, name, unit_status: status,
      confirmed: status === 'confirmed',
      progress_percent: kpi.progress_percent ?? 0,
      completed_tasks: kpi.completed_tasks ?? 0,
      total_tasks: kpi.total_tasks ?? 0,
      overdue_count: kpi.overdue_count ?? 0,
      health: kpi.health || null,
      completed_in_period: kpi.completed_in_period ?? 0,
    };
  }

  const projectRows = await Promise.all(projects.map((p) => rowFor('project', p.id, p.name)));
  const departmentRows = await Promise.all(departments.map((d) => rowFor('department', d.id, d.name)));
  const memberRows = await buildWorkspaceMembers(businessId, periodType, periodStart);

  const sum = (arr, k) => arr.reduce((s, r) => s + (r[k] || 0), 0);
  const avg = (arr, k) => (arr.length ? Math.round(sum(arr, k) / arr.length) : 0);
  const healthCounts = projectRows.reduce((acc, r) => { if (r.health) acc[r.health] = (acc[r.health] || 0) + 1; return acc; }, { green: 0, yellow: 0, red: 0 });

  // 통합 확정 상태 (workspace 단위)
  const wsUnit = unitMap.get('workspace:0');

  return {
    schema_version: 1,
    period: { type: periodType, start: periodStart },
    summary: {
      projects_total: projectRows.length,
      projects_confirmed: projectRows.filter((r) => r.confirmed).length,
      departments_total: departmentRows.length,
      departments_confirmed: departmentRows.filter((r) => r.confirmed).length,
      completed_tasks: sum(projectRows, 'completed_tasks'),
      overdue_count: sum(projectRows, 'overdue_count'),
      avg_progress: avg(projectRows, 'progress_percent'),
      completed_in_period: sum(projectRows, 'completed_in_period'),
      health_counts: healthCounts,
    },
    projects: projectRows,
    departments: departmentRows,
    members: memberRows,
    integrated: wsUnit
      ? { id: wsUnit.id, status: wsUnit.status, confirmed_by: wsUnit.confirmed_by, confirmed_at: wsUnit.confirmed_at, finalized_by: wsUnit.finalized_by }
      : { id: null, status: 'draft', confirmed_by: null, confirmed_at: null, finalized_by: null },
  };
}

module.exports = { buildIntegratedRollup };
