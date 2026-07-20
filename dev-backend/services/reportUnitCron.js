// reportUnitCron.js — 단위 보고서 주/월 경계 자동확정 (R3, 마스터설계 §4.3·§4.5)
//   직전(마감된) 기간의 프로젝트/부서 단위 보고서를 자동 초안 생성 + 미확정 자동확정(finalized_by='auto').
//   멱등 — 직전 기간만 다루므로 시간당 재실행해도 현재 기간 무영향(확정본은 재확정 안 함).
//   monthly 는 businesses.monthly_finalize_enabled 토글로 게이팅.
const cron = require('node-cron');
const { Business, Project, Department, ReportUnit } = require('../models');
const { buildAutoSnapshot } = require('./reportUnitSnapshot');
const { todayInTz, mondayOfDateStr, addDaysStr } = require('../utils/datetime');

// 직전 기간 period_start (ws_tz 기준 today 기반)
function prevPeriodStart(periodType, todayStr) {
  if (periodType === 'monthly') {
    const [y, m] = todayStr.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 - 1, 1)); // 전월 1일
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
  }
  return mondayOfDateStr(addDaysStr(mondayOfDateStr(todayStr), -7)); // 전주 월요일
}

// 한 워크스페이스·기간 단위 자동확정. 테스트/수동 트리거 가능.
async function finalizeUnitsForPeriod(businessId, periodType, periodStart, { autoConfirm = true } = {}) {
  const [projects, departments] = await Promise.all([
    Project.findAll({ where: { business_id: businessId, status: 'active' }, attributes: ['id'] }),
    Department.findAll({ where: { business_id: businessId }, attributes: ['id'] }),
  ]);
  const targets = [
    ...projects.map((p) => ({ scope: 'project', ref: p.id })),
    ...departments.map((d) => ({ scope: 'department', ref: d.id })),
  ];
  let created = 0; let confirmed = 0;
  for (const tgt of targets) {
    let unit = await ReportUnit.findOne({ where: { business_id: businessId, scope: tgt.scope, scope_ref_id: tgt.ref, period_type: periodType, period_start: periodStart } });
    if (!unit) {
      const snap = await buildAutoSnapshot(businessId, tgt.scope, tgt.ref, periodType, periodStart);
      if (snap === null) continue;
      unit = await ReportUnit.create({ business_id: businessId, scope: tgt.scope, scope_ref_id: tgt.ref, period_type: periodType, period_start: periodStart, status: 'draft', auto_snapshot: snap });
      created++;
    }
    if (autoConfirm && unit.status === 'draft') {
      const fresh = await buildAutoSnapshot(businessId, tgt.scope, tgt.ref, periodType, periodStart);
      await unit.update({ auto_snapshot: fresh || unit.auto_snapshot, status: 'confirmed', confirmed_by: null, confirmed_at: new Date(), finalized_by: 'auto' });
      confirmed++;
    }
  }
  return { created, confirmed, targets: targets.length };
}

// 시간당 — ws_tz 가 직전 기간을 충분히 지났을 때 자동확정 (멱등이라 여러 번 무해)
async function runReportUnitCron() {
  try {
    // 계정 삭제로 soft-delete 된 워크스페이스는 리포트 자동확정 대상에서 제외 (access_scope 관문 밖 cron)
    const businesses = await Business.findAll({
      attributes: ['id', 'timezone', 'monthly_finalize_enabled'],
      where: { deleted_at: null },
    });
    for (const biz of businesses) {
      const tz = biz.timezone || 'Asia/Seoul';
      let todayStr;
      try { todayStr = todayInTz(tz); } catch { todayStr = todayInTz('Asia/Seoul'); }
      // 주간 — 직전 주 자동확정 (항상)
      await finalizeUnitsForPeriod(biz.id, 'weekly', prevPeriodStart('weekly', todayStr), { autoConfirm: true }).catch(() => null);
      // 월간 — 직전 월 (설정 ON 시만)
      if (biz.monthly_finalize_enabled) {
        await finalizeUnitsForPeriod(biz.id, 'monthly', prevPeriodStart('monthly', todayStr), { autoConfirm: true }).catch(() => null);
      }
    }
  } catch (e) {
    console.error('[reportUnitCron] error:', e.message);
  }
}

function initReportUnitCron() {
  // 매시 7분 (다른 cron 과 분산)
  cron.schedule('7 * * * *', runReportUnitCron);
  console.log('[reportUnitCron] scheduled (hourly :07)');
}

module.exports = { initReportUnitCron, runReportUnitCron, finalizeUnitsForPeriod, prevPeriodStart };
