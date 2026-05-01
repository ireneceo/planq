// 경영 보고서 생성기 — 5개 탭 데이터 모아서 PDF 한 장으로 빌드.
//
// 입력: businessId, kind('monthly'|'quarterly'|'yearly'|'adhoc'), period:{from,to}, generatedBy?
// 출력: Report 레코드 (status='ready', pdf_url 채워짐) 또는 throw
//
// 부수효과: /opt/planq/dev-backend/uploads/reports/{businessId}/{report_id}.pdf 저장

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const { Report, Business } = require('../models');
const stats = require('./stats');
const { renderPdfFromHtml } = require('./pdfService');
const { reportPdfHtml } = require('./pdfTemplates');

const REPORTS_DIR = path.join(__dirname, '..', 'uploads', 'reports');

// 보고서 기간 자동 계산 — kind 기반
//  monthly:   직전 월 1일~말일
//  quarterly: 직전 분기
//  yearly:    직전 년 1/1~12/31
function computePeriod(kind, today = new Date()) {
  const toIso = (d) => d.toISOString().slice(0, 10);
  if (kind === 'yearly') {
    const y = today.getFullYear() - 1;
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
  if (kind === 'quarterly') {
    const q = Math.floor(today.getMonth() / 3); // 현재 분기 0..3
    const prevQ = q === 0 ? 3 : q - 1;
    const year = q === 0 ? today.getFullYear() - 1 : today.getFullYear();
    const startMonth = prevQ * 3;
    const start = new Date(year, startMonth, 1);
    const end = new Date(year, startMonth + 3, 0);
    return { from: toIso(start), to: toIso(end) };
  }
  // monthly (default)
  const m = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const e = new Date(today.getFullYear(), today.getMonth(), 0);
  return { from: toIso(m), to: toIso(e) };
}

function kindTitle(kind, period) {
  const map = { monthly: '월간', quarterly: '분기', yearly: '연간', adhoc: '맞춤' };
  return `${period.from.slice(0, 7)} ${map[kind] || kind} 경영 보고서`;
}

// 5개 탭 데이터 모으기 — 동일 period 적용
async function collectTabs(businessId, period) {
  const fullPeriod = { ...period, label: `${period.from}~${period.to}` };

  // 각 탭은 자체 모델 fetch — 병렬 호출
  const [overview, profit, team, finance] = await Promise.all([
    stats.buildOverviewTab(businessId, fullPeriod),
    stats.buildProfitTab(businessId, fullPeriod),
    stats.buildTeamTab(businessId, fullPeriod),
    stats.buildFinanceTab(businessId, fullPeriod),
  ]);

  // Tasks 탭은 task 데이터를 라우트에서 미리 fetch 한 후 builder 에 넘기는 구조 → 여기서 해당 흐름 재현
  const { Op } = require('sequelize');
  const { Task, TaskEstimation, User } = require('../models');
  const tasks = await Task.findAll({
    where: {
      business_id: businessId,
      created_at: { [Op.between]: [period.from + ' 00:00:00', period.to + ' 23:59:59'] },
    },
    include: [{ model: User, as: 'assignee', attributes: ['id', 'name'], required: false }],
    order: [['created_at', 'DESC']],
    limit: 2000,
  });
  const taskIds = tasks.map((t) => t.id);
  let aiByTask = {};
  if (taskIds.length) {
    const ests = await TaskEstimation.findAll({
      where: { task_id: { [Op.in]: taskIds }, source: 'ai' },
      order: [['created_at', 'DESC']],
    });
    for (const e of ests) {
      if (!aiByTask[e.task_id]) aiByTask[e.task_id] = Number(e.value);
    }
  }
  const tasksTab = stats.buildTasksTab({ tasks, aiByTask, period: fullPeriod, prevAgg: null });

  return { overview, tasks: tasksTab, profit, team, finance };
}

async function ensureReportsDir(businessId) {
  const dir = path.join(REPORTS_DIR, String(businessId));
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

// 메인 엔트리 — 보고서 생성
async function generateReport({ businessId, kind = 'monthly', period: customPeriod = null, generatedBy = null }) {
  const period = customPeriod || computePeriod(kind);
  const business = await Business.findByPk(businessId, {
    attributes: ['id', 'name', 'brand_name', 'legal_name'],
  });
  if (!business) throw new Error(`business ${businessId} not found`);

  // 1) Report 레코드 먼저 생성 — status='generating'
  const report = await Report.create({
    business_id: businessId,
    kind,
    period_start: period.from,
    period_end: period.to,
    status: 'generating',
    title: kindTitle(kind, period),
    generated_by: generatedBy,
    share_token: crypto.randomBytes(24).toString('hex'),
  });

  try {
    // 2) 5탭 데이터 수집
    const tabs = await collectTabs(businessId, period);

    // 3) 인사이트 통합 — overview 우선 + tasks/profit/team/finance 보조
    const allInsights = [
      ...(tabs.overview.insights || []),
      ...(tabs.tasks.insights || []),
      ...(tabs.profit.insights || []),
      ...(tabs.team.insights || []),
      ...(tabs.finance.insights || []),
    ];
    // urgent → warning → info 순으로 정렬, 중복 제거 후 상위 6개만 보관
    const sevRank = { urgent: 0, warning: 1, info: 2 };
    const dedup = new Map();
    for (const ins of allInsights) {
      const key = ins.title;
      if (!dedup.has(key)) dedup.set(key, ins);
    }
    const topInsights = [...dedup.values()].sort((a, b) => (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9)).slice(0, 6);

    // 4) HTML → PDF
    const html = reportPdfHtml({
      period: { ...period, kind, label: `${period.from}~${period.to}` },
      business: business.toJSON(),
      generatedAt: new Date().toISOString(),
      tabs,
    });
    const pdfBuffer = await renderPdfFromHtml(html, { format: 'A4' });

    // 5) 파일 저장
    const dir = await ensureReportsDir(businessId);
    const filename = `${report.id}.pdf`;
    const filepath = path.join(dir, filename);
    await fs.writeFile(filepath, pdfBuffer);

    // 6) Report 업데이트
    await report.update({
      status: 'ready',
      pdf_url: filepath, // 내부 경로. download endpoint 가 sendFile 로 서빙
      data: {
        kpis: {
          overview: tabs.overview.kpis,
          tasks: tabs.tasks.kpis,
          finance: tabs.finance.kpis,
        },
      },
      insights: topInsights,
      summary: topInsights.map((i) => `${i.title}: ${i.value}`).join(' · '),
      generated_at: new Date(),
    });

    return report;
  } catch (err) {
    await report.update({
      status: 'failed',
      error_message: err.message?.slice(0, 1000) || 'unknown error',
    }).catch(() => {});
    throw err;
  }
}

module.exports = {
  generateReport,
  computePeriod,
  REPORTS_DIR,
};
