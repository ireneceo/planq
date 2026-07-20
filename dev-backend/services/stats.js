// 사이클 Q-G — Insights 통계 룰 엔진 + 집계 헬퍼.
//
// 출력은 routes/stats.js 가 그대로 successResponse 로 내려줌.
// 차트 데이터 형식은 frontend 의 recharts 가 직접 소비할 수 있는 모양.

const { Op, fn, col, literal } = require('sequelize');
const { Task, TaskEstimation, sequelize } = require('../models');

// MAPE = mean of |est - actual| / actual (0 < actual)
// 단일값 0 div 가드, 그 외 task 평균
// 순 수금액 = 결제액 - 환불액. 매출 통계는 항상 이 값으로 합산(환불 반영). refunded_amount 미차감 시 매출 과대.
const netPay = (p) => Number(p.amount || 0) - Number(p.refunded_amount || 0);

// ── 다통화 정합 (Fable 설계 게이트 통과) ──
// 재무 집계는 워크스페이스 홈 통화만 합산한다. 외화(USD/EUR/JPY/CNY)를 KRW 에 그대로 더하면
// 범주 오류(예: $2,200 = ₩2,200)라 매출이 오염된다. 외화는 별도 by_currency 브레이크다운으로
// 분리 노출하고, 환산(홈통화 기준 합치기)은 트리거 기반 후속(사업 Fable (c))으로 미룬다.
// 통화 원천은 Invoice.currency 단일화 (InvoicePayment.currency 와 일치 검증됨, mismatch 0).
async function getHomeCurrency(businessId) {
  const { Business } = require('../models');
  const biz = await Business.findByPk(businessId, { attributes: ['default_currency'] });
  return (biz && biz.default_currency) || 'KRW';
}
// 통화별 합계 맵 {KRW: n, USD: m, ...}. curOf/valOf 로 각 row 의 통화·값 추출.
function groupByCurrency(rows, curOf, valOf) {
  const map = {};
  for (const r of rows) {
    const c = curOf(r) || 'KRW';
    map[c] = (map[c] || 0) + valOf(r);
  }
  return map;
}
// 홈 통화 외 통화만(반올림 0 제외). 프론트 브레이크다운 칩용 {USD: 2200, ...}.
function foreignBreakdown(map, home) {
  const out = {};
  for (const [c, v] of Object.entries(map)) {
    if (c !== home && Math.round(v) !== 0) out[c] = Math.round(v);
  }
  return out;
}

function mape(rows) {
  let sum = 0; let n = 0;
  for (const r of rows) {
    const actual = Number(r.actual);
    const est = Number(r.est);
    if (!actual || actual <= 0) continue;
    if (est == null || isNaN(est)) continue;
    sum += Math.abs(est - actual) / actual;
    n += 1;
  }
  if (n === 0) return null;
  return sum / n;
}

// Estimation Bias = (Σactual - Σuser_est) / Σactual × 100
// 양수 = 사용자 과소추정 경향, 음수 = 과대추정
function bias(rows) {
  let sumActual = 0;
  let sumEst = 0;
  for (const r of rows) {
    const actual = Number(r.actual);
    const est = Number(r.est);
    if (!actual || actual <= 0) continue;
    if (est == null || isNaN(est)) continue;
    sumActual += actual;
    sumEst += est;
  }
  if (sumActual === 0) return null;
  return ((sumActual - sumEst) / sumActual) * 100;
}

// 단일 task 정확도 (0 ~ 100, clamp). actual=0 또는 est=null 면 null.
function accuracy(actual, est) {
  if (!actual || actual <= 0) return null;
  if (est == null || isNaN(est)) return null;
  const ratio = Math.abs(est - actual) / actual;
  return Math.max(0, Math.min(100, (1 - ratio) * 100));
}

// percentile (sorted array)
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * p)));
  return sorted[i];
}

// ──────────────────────────────────────────────
// 비교 기간 카운트 (이전 기간) — 간단 집계만
// ──────────────────────────────────────────────
async function aggregateTaskCounts(businessId, period) {
  const where = {
    business_id: businessId,
    created_at: { [Op.between]: [period.from + ' 00:00:00', period.to + ' 23:59:59'] },
  };
  const created = await Task.count({ where });
  const completed = await Task.count({
    where: {
      business_id: businessId,
      status: 'completed',
      completed_at: { [Op.between]: [period.from + ' 00:00:00', period.to + ' 23:59:59'] },
    },
  });
  return { created, completed };
}

// ──────────────────────────────────────────────
// Tasks & Time 탭 — 메인 빌더
// ──────────────────────────────────────────────
function buildTasksTab({ tasks, aiByTask, period, prevAgg }) {
  // 분류 — 완료된 task 만 시간 분석 의미 있음 (actual 기록 가능성)
  const completed = tasks.filter((t) => t.status === 'completed' && t.completed_at);
  const all = tasks;

  // ── KPI ────────────────────────────────────
  const completedCount = completed.length;
  const createdCount = all.length;

  // 리드타임 (완료된 task 만)
  const leadtimes = completed
    .map((t) => {
      const c = new Date(t.created_at).getTime();
      const d = new Date(t.completed_at).getTime();
      return Math.max(0, (d - c) / 86400000);
    })
    .sort((a, b) => a - b);

  const p50 = percentile(leadtimes, 0.5);
  const p90 = percentile(leadtimes, 0.9);

  // user_estimate vs actual 행 (완료된 것만)
  const userRows = completed
    .filter((t) => Number(t.estimated_hours) > 0 && Number(t.actual_hours) > 0)
    .map((t) => ({ actual: Number(t.actual_hours), est: Number(t.estimated_hours) }));

  const biasPct = bias(userRows);

  // AI 정확도 — ai_estimate 가 있는 task 만
  const aiRows = completed
    .filter((t) => Number(t.actual_hours) > 0 && aiByTask[t.id] != null)
    .map((t) => ({ actual: Number(t.actual_hours), est: aiByTask[t.id] }));

  const aiMape = mape(aiRows);
  const aiAccuracyPct = aiMape == null ? null : Math.max(0, (1 - aiMape) * 100);

  // ── 비교 기간 vs 현재 기간 percent 변화 ──
  const deltaPct = (cur, prev) => {
    if (prev == null || prev === 0) return null;
    return ((cur - prev) / prev) * 100;
  };

  const kpis = {
    completed: {
      value: completedCount,
      prev: prevAgg?.completed ?? null,
      delta_pct: prevAgg ? deltaPct(completedCount, prevAgg.completed) : null,
    },
    created: {
      value: createdCount,
      prev: prevAgg?.created ?? null,
      delta_pct: prevAgg ? deltaPct(createdCount, prevAgg.created) : null,
    },
    leadtime_p50_days: { value: p50 == null ? null : Number(p50.toFixed(1)), prev: null, delta_pct: null },
    leadtime_p90_days: { value: p90 == null ? null : Number(p90.toFixed(1)), prev: null, delta_pct: null },
    bias_pct: { value: biasPct == null ? null : Number(biasPct.toFixed(1)), prev: null, delta_pct: null },
    ai_accuracy_pct: { value: aiAccuracyPct == null ? null : Number(aiAccuracyPct.toFixed(1)), prev: null, delta_pct: null },
  };

  // ── Scatter (user_estimate vs actual) ───────
  const scatter = completed
    .filter((t) => Number(t.estimated_hours) > 0 && Number(t.actual_hours) > 0)
    .map((t) => ({
      task_id: t.id,
      title: t.title,
      assignee_id: t.assignee_id,
      assignee_name: t.assignee?.name || null,
      user_estimate: Number(t.estimated_hours),
      actual: Number(t.actual_hours),
      accuracy_pct: accuracy(Number(t.actual_hours), Number(t.estimated_hours)),
    }))
    .slice(0, 500);

  // ── AI MAPE 월별 추이 (최근 6개월) ─────────
  const monthBucket = new Map(); // 'YYYY-MM' → {ai: [], user: []}
  for (const t of completed) {
    if (!t.completed_at) continue;
    const ym = String(t.completed_at).slice(0, 7);
    if (!monthBucket.has(ym)) monthBucket.set(ym, { ai: [], user: [] });
    const bucket = monthBucket.get(ym);
    const actual = Number(t.actual_hours);
    if (actual > 0) {
      if (Number(t.estimated_hours) > 0) bucket.user.push({ actual, est: Number(t.estimated_hours) });
      if (aiByTask[t.id] != null) bucket.ai.push({ actual, est: aiByTask[t.id] });
    }
  }
  const aiTrend = [...monthBucket.entries()]
    .sort()
    .map(([m, b]) => ({
      month: m,
      ai_mape: mape(b.ai),
      user_mape: mape(b.user),
      n_ai: b.ai.length,
      n_user: b.user.length,
    }));

  // ── 상태 깔때기 (현재 기간 생성 전체) ───────
  const funnel = { not_started: 0, in_progress: 0, reviewing: 0, completed: 0, canceled: 0 };
  for (const t of all) {
    if (t.status === 'waiting') funnel.not_started += 1;
    else if (t.status === 'revision_requested') funnel.in_progress += 1;
    else if (funnel[t.status] != null) funnel[t.status] += 1;
  }

  // ── 출처별 분포 ────────────────────────────
  const sources = { manual: 0, internal_request: 0, qtalk_extract: 0 };
  for (const t of all) {
    if (sources[t.source] != null) sources[t.source] += 1;
  }

  // ── 카테고리 파레토 (Top 10) ───────────────
  const catCount = new Map();
  for (const t of all) {
    if (!t.category) continue;
    catCount.set(t.category, (catCount.get(t.category) || 0) + 1);
  }
  const catTotal = [...catCount.values()].reduce((a, b) => a + b, 0);
  const sortedCats = [...catCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  let cum = 0;
  const categoriesPareto = sortedCats.map(([category, count]) => {
    cum += count;
    return {
      category,
      count,
      pct: catTotal ? Number(((count / catTotal) * 100).toFixed(1)) : 0,
      cumulative_pct: catTotal ? Number(((cum / catTotal) * 100).toFixed(1)) : 0,
    };
  });

  // ── 상세 테이블 (정확도·리드타임 포함) ──────
  const table = completed.map((t) => {
    const ue = Number(t.estimated_hours) || null;
    const ah = Number(t.actual_hours) || null;
    const ai = aiByTask[t.id] != null ? aiByTask[t.id] : null;
    const c = new Date(t.created_at).getTime();
    const d = t.completed_at ? new Date(t.completed_at).getTime() : null;
    const lead = d ? Number(((d - c) / 86400000).toFixed(1)) : null;
    const acc = accuracy(ah, ue);
    return {
      task_id: t.id,
      title: t.title,
      assignee: t.assignee?.name || null,
      category: t.category || null,
      user_est: ue,
      ai_est: ai,
      actual: ah,
      accuracy_pct: acc == null ? null : Number(acc.toFixed(1)),
      bias: ue && ah ? Number(((ah - ue) / ah * 100).toFixed(1)) : null,
      leadtime_days: lead,
      status: t.status,
    };
  });

  // ── 인사이트 박스 (3건, 룰 기반) ────────────
  const insights = buildTaskInsights({ kpis, scatter, aiTrend, sources });

  // 진행중 업무 예산초과 조기경고 — 완료 전 이미 추정시간 초과(actual>=estimated).
  //   actual_hours 는 #94 방치세션 캡 적용 후라 신뢰. ratio>=1.0 명확신호만(오탐 방지).
  const inProgressWatch = all
    .filter((t) => t.status === 'in_progress' && Number(t.estimated_hours) > 0 && Number(t.actual_hours) >= Number(t.estimated_hours))
    .map((t) => {
      const est = Number(t.estimated_hours), act = Number(t.actual_hours);
      return { task_id: t.id, title: t.title, assignee_name: t.assignee?.name || null, estimated: est, actual: act, over_pct: Math.round((act / est - 1) * 100) };
    })
    .sort((a, b) => b.over_pct - a.over_pct)
    .slice(0, 15);

  return {
    period: { from: period.from, to: period.to, label: period.label },
    kpis,
    scatter,
    ai_trend: aiTrend,
    funnel,
    sources,
    categories_pareto: categoriesPareto,
    in_progress_watch: inProgressWatch,
    table,
    insights,
  };
}

// 인사이트 박스 룰: 3건 우선순위로 선택
function buildTaskInsights({ kpis, scatter, aiTrend, sources }) {
  const out = [];

  // (1) 전반 정확도 — 직원별 편차
  const byAssignee = new Map();
  for (const s of scatter) {
    if (!s.assignee_name || s.accuracy_pct == null) continue;
    if (!byAssignee.has(s.assignee_name)) byAssignee.set(s.assignee_name, []);
    byAssignee.get(s.assignee_name).push(s.accuracy_pct);
  }
  const avgs = [...byAssignee.entries()]
    .map(([n, arr]) => ({ name: n, avg: arr.reduce((a, b) => a + b, 0) / arr.length, n: arr.length }))
    .filter((x) => x.n >= 3)
    .sort((a, b) => b.avg - a.avg);
  if (avgs.length >= 2) {
    const top = avgs[0];
    const bot = avgs[avgs.length - 1];
    if (top.avg - bot.avg > 30) {
      out.push({
        severity: 'warning',
        title: '공수 정확도 편차 큼',
        value: `${top.name} ${top.avg.toFixed(0)}% · ${bot.name} ${bot.avg.toFixed(0)}%`,
        hint: '카테고리별 강점·약점 분석으로 배정 최적화',
        action_label: 'People 탭에서 보기',
        action_link: '/insights?tab=people',
      });
    }
  }

  // (2) AI 정확도 추이 (월별 MAPE 개선되면 긍정 시그널)
  if (aiTrend.length >= 2) {
    const first = aiTrend[0];
    const last = aiTrend[aiTrend.length - 1];
    if (first.ai_mape != null && last.ai_mape != null && first.ai_mape > last.ai_mape) {
      const fromPct = (first.ai_mape * 100).toFixed(0);
      const toPct = (last.ai_mape * 100).toFixed(0);
      out.push({
        severity: 'info',
        title: 'AI 추정 정확도 향상',
        value: `MAPE ${fromPct}% → ${toPct}%`,
        hint: '신규 업무 견적 시 AI 추정값 신뢰도 ↑',
      });
    }
  }

  // (3) qtalk_extract 출처 task 의 리드타임 — 추후 mapping 필요 (placeholder)
  if (sources.qtalk_extract > 0) {
    out.push({
      severity: 'info',
      title: '대화 추출 업무',
      value: `${sources.qtalk_extract}건 자동 등록`,
      hint: 'Q Talk 메시지에서 자동 추출된 업무',
      action_label: '대화 보기',
      action_link: '/talk',
    });
  }

  // 인사이트 부족할 때 placeholder 보충
  if (out.length === 0) {
    out.push({
      severity: 'info',
      title: '데이터 누적 중',
      value: '30일 이상 누적되면 인사이트가 더 정확해져요',
      hint: '업무를 5건 이상 등록·완료하시면 분석이 시작됩니다',
    });
  }

  return out.slice(0, 3);
}

// ──────────────────────────────────────────────
// Overview 탭 — 사업 전체 맥박
//   매출(수금) / 영업이익 추정 / 가동률 / 실현율 / 활성 프로젝트 / 신규 고객
// ──────────────────────────────────────────────
async function buildOverviewTab(businessId, period) {
  const { Invoice, InvoicePayment, Project, Client, OverheadItem } = require('../models');

  const fromDt = new Date(period.from + ' 00:00:00');
  const toDt = new Date(period.to + ' 23:59:59');
  const home = await getHomeCurrency(businessId);

  // 매출 (수금) — InvoicePayment 합계 (홈 통화만, 외화는 분리)
  const payments = await InvoicePayment.findAll({
    where: { paid_at: { [Op.between]: [fromDt, toDt] } },
    include: [{ model: Invoice, where: { business_id: businessId }, attributes: ['id', 'project_id', 'currency'] }],
    attributes: ['amount', 'refunded_amount'],
  });
  const revByCur = groupByCurrency(payments, (p) => p.Invoice?.currency, netPay);
  const revenue = revByCur[home] || 0;
  const revenueForeign = foreignBreakdown(revByCur, home);

  // 발행액 (issued) — 홈 통화만, 외화는 분리
  const issuedInvoices = await Invoice.findAll({
    where: { business_id: businessId, issued_at: { [Op.between]: [fromDt, toDt] } },
    attributes: ['grand_total', 'paid_amount', 'status', 'currency'],
  });
  const issuedByCur = groupByCurrency(issuedInvoices, (i) => i.currency, (i) => Number(i.grand_total || 0));
  const issued = issuedByCur[home] || 0;
  const issuedForeign = foreignBreakdown(issuedByCur, home);
  const overdue = issuedInvoices.filter((i) => i.status === 'overdue' && (i.currency || 'KRW') === home)
    .reduce((s, i) => s + (Number(i.grand_total || 0) - Number(i.paid_amount || 0)), 0);

  // 고정비 추정 — 월정 OverheadItem 합계 × (기간/30일)
  const overheads = await OverheadItem.findAll({
    where: { business_id: businessId, [Op.or]: [{ ends_at: null }, { ends_at: { [Op.gte]: period.from } }] },
    attributes: ['amount', 'cycle'],
  });
  const monthly = overheads.reduce((s, o) => {
    const a = Number(o.amount || 0);
    if (o.cycle === 'yearly') return s + a / 12;
    if (o.cycle === 'quarterly') return s + a / 3;
    return s + a;
  }, 0);
  const days = Math.max(1, (toDt - fromDt) / 86400000);
  const overheadAlloc = (monthly / 30) * days;

  // 영업이익 = 매출 − 고정비 (단순 모델, 노동비는 hourly_rate 미입력 시 0)
  const profit = revenue - overheadAlloc;

  // 활성 프로젝트 — 전사 대시보드이므로 내부/고객 구분 없이 전체 (수익성 세그먼트는 profit 탭 전용).
  const activeProjects = await Project.count({ where: { business_id: businessId, status: 'active' } });

  // 신규 고객 (기간 내 created) — kind='customer' 만 (vendor/freelancer/other 제외)
  const newClients = await Client.count({
    where: { business_id: businessId, kind: 'customer', created_at: { [Op.between]: [fromDt, toDt] } },
  });

  // 가동률 / 실현율 — Tasks 데이터 재사용 (단순화: 모든 task 의 actual_hours 합계 / 가용시간 합계)
  // 정확한 가용시간은 BusinessMember.daily_work_hours 등 필요 — 간이 추정으로 8 × 5 × N members × 주차
  const { BusinessMember, Task } = require('../models');
  const members = await BusinessMember.findAll({
    where: { business_id: businessId, removed_at: null },
    attributes: ['user_id', 'daily_work_hours', 'weekly_work_days', 'participation_rate'],
  });
  const weeklyHours = members.reduce((s, m) => {
    const dh = Number(m.daily_work_hours || 8);
    const wd = Number(m.weekly_work_days || 5);
    const pr = Number(m.participation_rate || 1);
    return s + dh * wd * pr;
  }, 0);
  const weeks = days / 7;
  const availableHours = weeklyHours * weeks;

  const tasks = await Task.findAll({
    where: {
      business_id: businessId,
      completed_at: { [Op.between]: [fromDt, toDt] },
      status: 'completed',
    },
    attributes: ['actual_hours'],
  });
  const actualHours = tasks.reduce((s, t) => s + Number(t.actual_hours || 0), 0);
  const utilization = availableHours > 0 ? (actualHours / availableHours) * 100 : null;

  // 12개월 매출/이익 추이 — 월별
  const trend = [];
  const today = new Date();
  for (let i = 11; i >= 0; i--) {
    const m = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const mEnd = new Date(today.getFullYear(), today.getMonth() - i + 1, 0);
    const mPays = await InvoicePayment.findAll({
      where: { paid_at: { [Op.between]: [m, mEnd] } },
      include: [{ model: Invoice, where: { business_id: businessId }, attributes: ['id', 'project_id', 'currency'] }],
      attributes: ['amount', 'refunded_amount'],
    });
    const monthRev = mPays.reduce((s, p) => ((p.Invoice?.currency || 'KRW') === home ? s + netPay(p) : s), 0);
    trend.push({
      month: m.toISOString().slice(0, 7),
      revenue: monthRev,
      profit: monthRev - (monthly / 30) * (mEnd.getDate()),
    });
  }

  const insights = [];
  if (overdue > 0) insights.push({
    severity: 'urgent', title: '연체 청구', value: `${overdue.toLocaleString()}원`,
    hint: '미수금 회수 우선', action_label: '청구서 보기', action_link: '/qbill',
  });
  if (utilization != null && utilization > 100) insights.push({
    severity: 'warning', title: '가동률 초과', value: `${utilization.toFixed(0)}%`,
    hint: '초과 근무 누적 위험', action_label: '팀 보기', action_link: '/stats/team',
  });
  if (newClients > 0) insights.push({
    severity: 'info', title: '신규 고객', value: `${newClients}건`,
    hint: '관계 강화 시점', action_label: '고객 보기', action_link: '/business/clients',
  });
  if (insights.length === 0) insights.push({
    severity: 'info', title: '데이터 누적 중', value: '30일 이상 누적 시 더 정확',
    hint: '청구서/업무를 등록하시면 분석이 시작됩니다',
  });

  return {
    period: { from: period.from, to: period.to, label: period.label },
    home_currency: home,
    kpis: {
      revenue: { value: Math.round(revenue), prev: null, delta_pct: null, by_currency: revenueForeign },
      profit: { value: Math.round(profit), prev: null, delta_pct: null },
      utilization_pct: { value: utilization == null ? null : Number(utilization.toFixed(1)), prev: null, delta_pct: null },
      issued: { value: Math.round(issued), prev: null, delta_pct: null, by_currency: issuedForeign },
      active_projects: { value: activeProjects, prev: null, delta_pct: null },
      new_clients: { value: newClients, prev: null, delta_pct: null },
    },
    trend,
    insights: insights.slice(0, 3),
  };
}

// ──────────────────────────────────────────────
// Profit (Projects 수익성) 탭
// ──────────────────────────────────────────────
// segment: 'client'(고객 프로젝트 P&L, 기본) | 'internal'(내부 투자 시간·원가 뷰) | 'all'(둘 다, 단 수익성 KPI 는 고객만)
async function buildProfitTab(businessId, period, segment = 'client') {
  const { Project, Invoice, InvoicePayment, Task, ProjectExpense, OverheadItem } = require('../models');
  const fromDt = new Date(period.from + ' 00:00:00');
  const toDt = new Date(period.to + ' 23:59:59');
  const home = await getHomeCurrency(businessId);

  // 전체 프로젝트 조회 후 kind 로 분리 — internal_investment 요약이 client/기본 뷰에서도
  //   항상 채워지도록(세그먼트로 pre-filter 하면 기본 뷰에서 내부 요약이 0 이 되는 버그).
  const projects = await Project.findAll({
    where: { business_id: businessId },
    attributes: ['id', 'name', 'status', 'client_company', 'kind'],
  });
  if (projects.length === 0) return emptyProfitTab(period, segment);

  const projectIds = projects.map((p) => p.id);

  // 프로젝트별 매출 (수금) — 홈 통화만 합산. 외화 결제가 있는 프로젝트는 has_foreign 로 표시해
  //   revenue 0 으로 조용히 사라지는 오정보 차단 (Fable 필수조건).
  const payments = await InvoicePayment.findAll({
    where: { paid_at: { [Op.between]: [fromDt, toDt] } },
    include: [{
      model: Invoice,
      where: { business_id: businessId, project_id: { [Op.in]: projectIds } },
      attributes: ['id', 'project_id', 'currency'],
    }],
    attributes: ['amount', 'refunded_amount'],
  });
  const revenueByProject = {};
  const foreignProjects = new Set();
  for (const p of payments) {
    const pid = p.Invoice?.project_id;
    if (!pid) continue;
    if ((p.Invoice?.currency || 'KRW') === home) {
      revenueByProject[pid] = (revenueByProject[pid] || 0) + netPay(p);
    } else if (Math.round(netPay(p)) !== 0) {
      foreignProjects.add(pid);
    }
  }

  // 프로젝트별 actual_hours
  const tasks = await Task.findAll({
    where: { business_id: businessId, project_id: { [Op.in]: projectIds }, status: 'completed' },
    attributes: ['project_id', 'actual_hours', 'estimated_hours'],
  });
  const hoursByProject = {};
  const estHoursByProject = {};
  for (const t of tasks) {
    if (!t.project_id) continue;
    hoursByProject[t.project_id] = (hoursByProject[t.project_id] || 0) + Number(t.actual_hours || 0);
    estHoursByProject[t.project_id] = (estHoursByProject[t.project_id] || 0) + Number(t.estimated_hours || 0);
  }

  // 직접비 (ProjectExpense)
  const expenses = await ProjectExpense.findAll({
    where: { project_id: { [Op.in]: projectIds }, incurred_at: { [Op.between]: [period.from, period.to] } },
    attributes: ['project_id', 'amount'],
  });
  const directCostByProject = {};
  for (const e of expenses) {
    directCostByProject[e.project_id] = (directCostByProject[e.project_id] || 0) + Number(e.amount || 0);
  }

  // 행 빌드
  const rows = projects.map((p) => {
    const revenue = revenueByProject[p.id] || 0;
    const hours = hoursByProject[p.id] || 0;
    const estHours = estHoursByProject[p.id] || 0;
    const laborCost = hours * 50000; // 가정: 시간당 5만원 (hourly_rate 컬럼 추후)
    const directCost = directCostByProject[p.id] || 0;
    const totalCost = laborCost + directCost;
    const profit = revenue - totalCost;
    const margin = revenue > 0 ? (profit / revenue) * 100 : null;
    const profitPerHour = hours > 0 ? profit / hours : null;
    return {
      project_id: p.id,
      name: p.name,
      client: p.client_company || '—',
      kind: p.kind,
      status: p.status,
      has_foreign_currency: foreignProjects.has(p.id),
      revenue: Math.round(revenue),
      labor_cost: Math.round(laborCost),
      direct_cost: Math.round(directCost),
      profit: Math.round(profit),
      margin_pct: margin == null ? null : Number(margin.toFixed(1)),
      hours: Number(hours.toFixed(1)),
      est_hours: Number(estHours.toFixed(1)),
      profit_per_hour: profitPerHour == null ? null : Math.round(profitPerHour),
    };
  });

  const clientRows = rows.filter((r) => r.kind === 'client');
  const internalRows = rows.filter((r) => r.kind === 'internal');
  // 수익성 KPI 는 고객 프로젝트만 대상 — 내부 프로젝트(매출0·노동비>0)의 마진음수 오탐 제거.
  const negativeMargin = clientRows.filter((r) => r.profit < 0).length;
  const totalRevenue = clientRows.reduce((s, r) => s + r.revenue, 0);
  const totalProfit = clientRows.reduce((s, r) => s + r.profit, 0);
  const totalHours = clientRows.reduce((s, r) => s + r.hours, 0);
  const avgProfitPerHour = totalHours > 0 ? totalProfit / totalHours : null;
  // 내부 투자 요약 (별도 뷰·항상 계산) — 매출/마진 없이 시간·원가만.
  const internalHours = internalRows.reduce((s, r) => s + r.hours, 0);
  const internalCost = internalRows.reduce((s, r) => s + r.labor_cost + r.direct_cost, 0);
  const internalInvestment = {
    project_count: internalRows.length,
    total_hours: Number(internalHours.toFixed(1)),
    total_cost: Math.round(internalCost),
  };

  // 내부 투자 뷰 — 매출/마진 아닌 시간·원가 중심 응답.
  if (segment === 'internal') {
    const invRows = internalRows.map((r) => ({
      project_id: r.project_id, name: r.name, status: r.status,
      hours: r.hours, est_hours: r.est_hours,
      labor_cost: r.labor_cost, direct_cost: r.direct_cost,
      total_cost: Math.round(r.labor_cost + r.direct_cost),
    })).sort((a, b) => b.total_cost - a.total_cost);
    const invInsights = [];
    if (internalRows.length > 0) invInsights.push({
      severity: 'info', title: '내부 투자 시간',
      value: `${internalInvestment.total_hours}h`,
      hint: `${internalInvestment.project_count}개 내부 프로젝트 · 원가 ${internalInvestment.total_cost.toLocaleString()}원`,
    });
    else invInsights.push({
      severity: 'info', title: '내부 프로젝트 없음',
      value: '자체 투자 업무를 내부 프로젝트로 표시', hint: '프로젝트 설정에서 "내부 프로젝트" 토글',
    });
    return {
      period: { from: period.from, to: period.to, label: period.label },
      segment,
      kpis: {
        internal_projects: { value: internalRows.length, prev: null, delta_pct: null },
        internal_hours: { value: internalInvestment.total_hours, prev: null, delta_pct: null },
        internal_cost: { value: internalInvestment.total_cost, prev: null, delta_pct: null },
      },
      table: invRows,
      internal_investment: internalInvestment,
      insights: invInsights,
    };
  }

  const overrunRows = clientRows.filter((r) => r.est_hours > 0 && r.hours > r.est_hours * 1.5);

  const insights = [];
  if (negativeMargin > 0) insights.push({
    severity: 'urgent', title: '마진 음수 프로젝트',
    value: `${negativeMargin}건`, hint: '즉시 검토 필요',
    action_label: '아래 표 확인', action_link: '/stats/profit',
  });
  if (overrunRows.length > 0) {
    const top = overrunRows[0];
    const ratio = ((top.hours / top.est_hours - 1) * 100).toFixed(0);
    insights.push({
      severity: 'warning', title: '견적 초과', value: `${top.name} +${ratio}%`,
      hint: `${top.est_hours}h → ${top.hours}h`,
    });
  }
  if (avgProfitPerHour != null) insights.push({
    severity: 'info', title: 'Profit per Hour 평균',
    value: `${Math.round(avgProfitPerHour).toLocaleString()}원/h`,
    hint: avgProfitPerHour > 90000 ? '목표 달성' : '단가 인상 검토',
  });
  if (insights.length === 0) insights.push({
    severity: 'info', title: '데이터 누적 중',
    value: '프로젝트 수금·비용 기록 후 표시', hint: '청구서·비용 입력하시면 분석 시작',
  });

  // 수익성 KPI·버블·표는 고객 프로젝트 기준(내부 제외). 'all' 이어도 수익성은 고객만 의미.
  const pnlRows = clientRows;
  const hasForeignPnl = clientRows.some((r) => r.has_foreign_currency);
  return {
    period: { from: period.from, to: period.to, label: period.label },
    segment,
    home_currency: home,
    has_foreign_currency: hasForeignPnl,
    kpis: {
      active_projects: { value: pnlRows.filter((r) => r.status === 'active').length, prev: null, delta_pct: null },
      negative_margin: { value: negativeMargin, prev: null, delta_pct: null },
      avg_profit_per_hour: { value: avgProfitPerHour == null ? null : Math.round(avgProfitPerHour), prev: null, delta_pct: null },
      total_revenue: { value: Math.round(totalRevenue), prev: null, delta_pct: null },
      total_profit: { value: Math.round(totalProfit), prev: null, delta_pct: null },
      total_hours: { value: Number(totalHours.toFixed(1)), prev: null, delta_pct: null },
    },
    bubble: pnlRows.filter((r) => r.hours > 0).map((r) => ({
      project_id: r.project_id, name: r.name,
      hours: r.hours, revenue: r.revenue, profit: r.profit, margin_pct: r.margin_pct,
      has_foreign_currency: r.has_foreign_currency,
    })),
    table: pnlRows.sort((a, b) => b.revenue - a.revenue),
    internal_investment: internalInvestment,
    insights: insights.slice(0, 3),
  };
}
function emptyProfitTab(period, segment = 'client') {
  const emptyInv = { project_count: 0, total_hours: 0, total_cost: 0 };
  if (segment === 'internal') {
    // 내부 뷰는 투자(시간·원가) shape 유지 — 프로젝트 0건이어도 client KPI 로 뒤바뀌지 않게.
    return {
      period, segment, internal_investment: emptyInv,
      kpis: {
        internal_projects: { value: 0 }, internal_hours: { value: 0 }, internal_cost: { value: 0 },
      },
      table: [],
      insights: [{ severity: 'info', title: '내부 프로젝트 없음', value: '자체 투자 업무를 내부 프로젝트로 표시', hint: '프로젝트 설정에서 "내부 프로젝트" 토글' }],
    };
  }
  return {
    period, segment, internal_investment: emptyInv, kpis: {
      active_projects: { value: 0 }, negative_margin: { value: 0 },
      avg_profit_per_hour: { value: null }, total_revenue: { value: 0 },
      total_profit: { value: 0 }, total_hours: { value: 0 },
    },
    bubble: [], table: [],
    insights: [{ severity: 'info', title: '프로젝트 없음', value: '신규 프로젝트 등록 후 분석 시작' }],
  };
}

// ──────────────────────────────────────────────
// Team (직원·생산성) 탭
// ──────────────────────────────────────────────
async function buildTeamTab(businessId, period, segment = 'client') {
  const { BusinessMember, User, Task, Invoice, InvoicePayment, Project } = require('../models');
  const fromDt = new Date(period.from + ' 00:00:00');
  const toDt = new Date(period.to + ' 23:59:59');
  const home = await getHomeCurrency(businessId);

  // 프로젝트 kind 맵 — 매출배분 분모를 고객 프로젝트 시간으로 한정하기 위함.
  const projRows = await Project.findAll({ where: { business_id: businessId }, attributes: ['id', 'kind'] });
  const projKind = new Map(projRows.map((p) => [p.id, p.kind]));
  const isClientTask = (t) => t.project_id != null && projKind.get(t.project_id) === 'client';

  const members = await BusinessMember.findAll({
    where: { business_id: businessId, removed_at: null },
    include: [{ model: User, as: 'user', attributes: ['id', 'name'] }],
    attributes: ['user_id', 'role', 'daily_work_hours', 'weekly_work_days', 'participation_rate'],
  });

  const days = Math.max(1, (toDt - fromDt) / 86400000);

  // 직원별 actual_hours / 정확도 / Bias / 완료 task 수
  const tasks = await Task.findAll({
    where: {
      business_id: businessId,
      completed_at: { [Op.between]: [fromDt, toDt] },
      status: 'completed',
    },
    attributes: ['assignee_id', 'actual_hours', 'estimated_hours', 'completed_at', 'created_at', 'category', 'project_id'],
  });

  // 매출 (수금) — 청구서가 task 와 직접 연결 안 되어 있어, 고객 프로젝트 시간 비중으로 분배.
  //   인당 매출 배분은 홈 통화만 — 외화가 섞이면 revenue_share 가 오염됨(Fable 필수조건).
  const payments = await InvoicePayment.findAll({
    where: { paid_at: { [Op.between]: [fromDt, toDt] } },
    include: [{ model: Invoice, where: { business_id: businessId }, attributes: ['id', 'project_id', 'currency'] }],
    attributes: ['amount', 'refunded_amount'],
  });
  const totalRevenue = payments.reduce((s, p) => ((p.Invoice?.currency || 'KRW') === home ? s + netPay(p) : s), 0);
  const hasForeignRevenue = payments.some((p) => (p.Invoice?.currency || 'KRW') !== home && Math.round(netPay(p)) !== 0);

  const totalActualHours = tasks.reduce((s, t) => s + Number(t.actual_hours || 0), 0);
  // 매출배분 분모 = 고객 프로젝트 시간만 (내부업무 시간이 인당매출을 희석/오배분하던 것 차단)
  const totalClientHours = tasks.filter(isClientTask).reduce((s, t) => s + Number(t.actual_hours || 0), 0);

  const rows = members.map((m) => {
    const memberTasks = tasks.filter((t) => t.assignee_id === m.user_id);
    const actualH = memberTasks.reduce((s, t) => s + Number(t.actual_hours || 0), 0);
    const clientActualH = memberTasks.filter(isClientTask).reduce((s, t) => s + Number(t.actual_hours || 0), 0);

    const dh = Number(m.daily_work_hours || 8);
    const wd = Number(m.weekly_work_days || 5);
    const pr = Number(m.participation_rate || 1);
    const availableH = (dh * wd * pr) * (days / 7);

    const utilization = availableH > 0 ? (actualH / availableH) * 100 : null;

    // 정확도 (task 별 평균)
    const accuracies = memberTasks
      .filter((t) => Number(t.estimated_hours) > 0 && Number(t.actual_hours) > 0)
      .map((t) => accuracy(Number(t.actual_hours), Number(t.estimated_hours)))
      .filter((a) => a != null);
    const avgAccuracy = accuracies.length ? accuracies.reduce((a, b) => a + b, 0) / accuracies.length : null;

    // Bias
    const memberBias = bias(memberTasks
      .filter((t) => Number(t.estimated_hours) > 0 && Number(t.actual_hours) > 0)
      .map((t) => ({ actual: Number(t.actual_hours), est: Number(t.estimated_hours) })));

    // 인당 매출 — 고객 프로젝트 시간 비중으로만 분배 (내부업무만 한 멤버는 매출배분 0)
    const revenueShare = totalClientHours > 0 ? totalRevenue * (clientActualH / totalClientHours) : 0;

    // Effective Rate (고객시간당 매출) — 내부 시간으로 나누면 왜곡되므로 고객 시간 기준
    const effectiveRate = clientActualH > 0 ? revenueShare / clientActualH : null;

    // 평균 리드타임
    const leads = memberTasks
      .filter((t) => t.completed_at && t.created_at)
      .map((t) => (new Date(t.completed_at) - new Date(t.created_at)) / 86400000);
    const avgLead = leads.length ? leads.reduce((a, b) => a + b, 0) / leads.length : null;

    // 카테고리별 강점/약점 — drawer 에 표시
    const catMap = new Map();
    for (const t of memberTasks) {
      const cat = t.category || '(미분류)';
      if (!catMap.has(cat)) catMap.set(cat, { count: 0, hours: 0, accs: [], biasRows: [], leads: [] });
      const b = catMap.get(cat);
      b.count += 1;
      b.hours += Number(t.actual_hours || 0);
      const ah = Number(t.actual_hours || 0);
      const eh = Number(t.estimated_hours || 0);
      if (ah > 0 && eh > 0) {
        const acc = accuracy(ah, eh);
        if (acc != null) b.accs.push(acc);
        b.biasRows.push({ actual: ah, est: eh });
      }
      if (t.completed_at && t.created_at) {
        b.leads.push((new Date(t.completed_at) - new Date(t.created_at)) / 86400000);
      }
    }
    const categories = [...catMap.entries()]
      .map(([name, b]) => {
        const accAvg = b.accs.length ? b.accs.reduce((a, c) => a + c, 0) / b.accs.length : null;
        const catBias = bias(b.biasRows);
        const leadAvg = b.leads.length ? b.leads.reduce((a, c) => a + c, 0) / b.leads.length : null;
        return {
          category: name,
          count: b.count,
          hours: Number(b.hours.toFixed(1)),
          accuracy_pct: accAvg == null ? null : Number(accAvg.toFixed(1)),
          bias_pct: catBias == null ? null : Number(catBias.toFixed(1)),
          avg_leadtime_days: leadAvg == null ? null : Number(leadAvg.toFixed(1)),
        };
      })
      .sort((a, b) => b.count - a.count);

    return {
      user_id: m.user_id,
      name: m.user?.name || `user ${m.user_id}`,
      role: m.role,
      utilization_pct: utilization == null ? null : Number(utilization.toFixed(1)),
      accuracy_pct: avgAccuracy == null ? null : Number(avgAccuracy.toFixed(1)),
      bias_pct: memberBias == null ? null : Number(memberBias.toFixed(1)),
      completed_tasks: memberTasks.length,
      avg_leadtime_days: avgLead == null ? null : Number(avgLead.toFixed(1)),
      revenue_share: Math.round(revenueShare),
      effective_rate: effectiveRate == null ? null : Math.round(effectiveRate),
      actual_hours: Number(actualH.toFixed(1)),
      categories,
    };
  });

  // 인사이트
  const sortedByRev = [...rows].filter((r) => r.revenue_share > 0).sort((a, b) => b.revenue_share - a.revenue_share);
  const overUtil = rows.filter((r) => r.utilization_pct != null && r.utilization_pct > 100);
  const sortedByAcc = [...rows].filter((r) => r.accuracy_pct != null && r.completed_tasks >= 3).sort((a, b) => (b.accuracy_pct || 0) - (a.accuracy_pct || 0));

  const insights = [];
  if (sortedByRev.length > 0) insights.push({
    severity: 'info', title: '인당 매출 1위',
    value: `${sortedByRev[0].name} ${sortedByRev[0].revenue_share.toLocaleString()}원`,
    hint: '시간 비중 가중 분배',
  });
  if (overUtil.length > 0) insights.push({
    severity: 'urgent', title: '가동률 초과 직원',
    value: `${overUtil.map((r) => r.name).join(', ')} (${overUtil[0].utilization_pct}%)`,
    hint: '초과근무 위험 — 업무 재배정 검토',
  });
  if (sortedByAcc.length > 0) insights.push({
    severity: 'info', title: '추정 정확도 1위',
    value: `${sortedByAcc[0].name} ${sortedByAcc[0].accuracy_pct}%`,
    hint: `Bias ${sortedByAcc[0].bias_pct}%`,
  });
  if (insights.length === 0) insights.push({
    severity: 'info', title: '데이터 누적 중', value: '완료 업무가 쌓이면 직원 비교 분석',
  });

  // 가동률 분포 (히스토그램용 카테고리 카운트)
  const utilBuckets = { under60: 0, normal: 0, over90: 0, over100: 0 };
  for (const r of rows) {
    if (r.utilization_pct == null) continue;
    if (r.utilization_pct > 100) utilBuckets.over100 += 1;
    else if (r.utilization_pct > 90) utilBuckets.over90 += 1;
    else if (r.utilization_pct >= 60) utilBuckets.normal += 1;
    else utilBuckets.under60 += 1;
  }

  // Q Mail M4 — FAQ 자동 클러스터링 효과 (이번 기간 등록 수 + 응대 시간 절감 추정)
  //   time_saved = 등록 FAQ 의 누적 반복 질문 수 × 회당 평균 작성 절감 5분 (보수적 추정).
  let faqAccepted = 0; let faqTimeSaved = 0;
  try {
    const { EmailFaqSuggestion } = require('../models');
    const accepted = await EmailFaqSuggestion.findAll({
      where: { business_id: businessId, status: 'accepted', updated_at: { [Op.between]: [fromDt, toDt] } },
      attributes: ['occurrence_count'],
    });
    faqAccepted = accepted.length;
    faqTimeSaved = accepted.reduce((s, f) => s + Number(f.occurrence_count || 0), 0) * 5;
  } catch { /* M4 미적용 워크스페이스 — 0 */ }

  return {
    period: { from: period.from, to: period.to, label: period.label },
    home_currency: home,
    has_foreign_currency: hasForeignRevenue,
    kpis: {
      members: { value: rows.length, prev: null, delta_pct: null },
      avg_utilization: { value: rows.length ? Number((rows.reduce((s, r) => s + (r.utilization_pct || 0), 0) / rows.length).toFixed(1)) : null, prev: null, delta_pct: null },
      top_revenue: { value: sortedByRev[0]?.revenue_share || 0, prev: null, delta_pct: null },
      top_accuracy: { value: sortedByAcc[0]?.accuracy_pct ?? null, prev: null, delta_pct: null },
      over_util_count: { value: overUtil.length, prev: null, delta_pct: null },
      total_completed: { value: rows.reduce((s, r) => s + r.completed_tasks, 0), prev: null, delta_pct: null },
      faq_accepted: { value: faqAccepted, prev: null, delta_pct: null },
      faq_time_saved: { value: faqTimeSaved, prev: null, delta_pct: null },
    },
    util_buckets: utilBuckets,
    table: rows.sort((a, b) => (b.utilization_pct || 0) - (a.utilization_pct || 0)),
    insights: insights.slice(0, 3),
  };
}

// ──────────────────────────────────────────────
// Finance (비용·재무) 탭
// ──────────────────────────────────────────────
async function buildFinanceTab(businessId, period, segment = 'client') {
  const { Invoice, InvoicePayment, OverheadItem, ProjectExpense } = require('../models');
  const fromDt = new Date(period.from + ' 00:00:00');
  const toDt = new Date(period.to + ' 23:59:59');
  // 직접비 프로젝트 kind 필터 — 기본(client) 이면 내부 프로젝트 직접비 제외(매출0인데 원가만 잡혀 마진 왜곡 차단).
  const expenseProjKind = segment === 'client' ? { kind: 'client' }
    : segment === 'internal' ? { kind: 'internal' } : {};

  const home = await getHomeCurrency(businessId);
  const payments = await InvoicePayment.findAll({
    where: { paid_at: { [Op.between]: [fromDt, toDt] } },
    include: [{ model: Invoice, where: { business_id: businessId }, attributes: ['id', 'project_id', 'currency'] }],
    attributes: ['amount', 'refunded_amount', 'paid_at'],
  });
  const revByCur = groupByCurrency(payments, (p) => p.Invoice?.currency, netPay);
  const revenue = revByCur[home] || 0;
  const revenueForeign = foreignBreakdown(revByCur, home);

  // 미수금 (current overdue) — 홈 통화만, 외화는 분리
  const overdueInvoices = await Invoice.findAll({
    where: { business_id: businessId, status: { [Op.in]: ['sent', 'partially_paid', 'overdue'] } },
    attributes: ['grand_total', 'paid_amount', 'status', 'due_date', 'currency'],
  });
  const recByCur = groupByCurrency(overdueInvoices, (i) => i.currency, (i) => Number(i.grand_total || 0) - Number(i.paid_amount || 0));
  const receivable = recByCur[home] || 0;
  const receivableForeign = foreignBreakdown(recByCur, home);

  // 고정비 (월정 기준 기간 분배)
  const overheads = await OverheadItem.findAll({
    where: { business_id: businessId, [Op.or]: [{ ends_at: null }, { ends_at: { [Op.gte]: period.from } }] },
    attributes: ['category', 'name', 'amount', 'cycle'],
  });
  const days = Math.max(1, (toDt - fromDt) / 86400000);
  const overheadAlloc = overheads.reduce((s, o) => {
    const a = Number(o.amount || 0);
    const monthly = o.cycle === 'yearly' ? a / 12 : o.cycle === 'quarterly' ? a / 3 : a;
    return s + (monthly / 30) * days;
  }, 0);

  // 직접비 (프로젝트 kind 세그먼트 반영)
  const directs = await ProjectExpense.findAll({
    include: [{ model: require('../models').Project, where: { business_id: businessId, ...expenseProjKind }, attributes: ['id'] }],
    where: { incurred_at: { [Op.between]: [period.from, period.to] } },
    attributes: ['category', 'amount', 'incurred_at'],
  });
  const directCost = directs.reduce((s, e) => s + Number(e.amount || 0), 0);

  const totalCost = overheadAlloc + directCost;
  const profit = revenue - totalCost;
  const margin = revenue > 0 ? (profit / revenue) * 100 : null;

  // 카테고리별 지출 (overhead category + project expense category 합계)
  const categoryMap = {};
  for (const o of overheads) {
    const a = Number(o.amount || 0);
    const monthly = o.cycle === 'yearly' ? a / 12 : o.cycle === 'quarterly' ? a / 3 : a;
    const alloc = (monthly / 30) * days;
    const k = o.category || 'other';
    categoryMap[k] = (categoryMap[k] || 0) + alloc;
  }
  for (const e of directs) {
    const k = `project_${e.category || 'other'}`;
    categoryMap[k] = (categoryMap[k] || 0) + Number(e.amount || 0);
  }
  const expensesByCategory = Object.entries(categoryMap).map(([category, amount]) => ({
    category, amount: Math.round(amount),
  })).sort((a, b) => b.amount - a.amount);

  const insights = [];
  if (margin != null && margin < 0) insights.push({
    severity: 'urgent', title: '마진 음수', value: `${margin.toFixed(1)}%`,
    hint: '비용 > 매출 — 즉시 검토',
  });
  else if (margin != null && margin < 10) insights.push({
    severity: 'warning', title: '낮은 마진', value: `${margin.toFixed(1)}%`,
    hint: '비용 절감 또는 단가 인상 검토',
  });
  if (receivable > 0) insights.push({
    severity: 'warning', title: '미수금', value: `${receivable.toLocaleString()}원`,
    hint: `${overdueInvoices.length}건 미결제`,
    action_label: '청구서 보기', action_link: '/qbill',
  });
  if (expensesByCategory.length > 0) insights.push({
    severity: 'info', title: '지출 1위',
    value: `${expensesByCategory[0].category} ${expensesByCategory[0].amount.toLocaleString()}원`,
  });
  if (insights.length === 0) insights.push({
    severity: 'info', title: '데이터 누적 중', value: '청구서·비용 등록 후 분석 시작',
  });

  // 12개월 매출·비용·이익 추이 (Overview 매출추이와 상보 — Finance 는 비용 분해 강조)
  const ym = (x) => new Date(x).toISOString().slice(0, 7);
  const monthlyOverhead = overheads.reduce((s, o) => {
    const a = Number(o.amount || 0);
    return s + (o.cycle === 'yearly' ? a / 12 : o.cycle === 'quarterly' ? a / 3 : a);
  }, 0);
  const trendStart = new Date(toDt.getFullYear(), toDt.getMonth() - 11, 1);
  const [trendPays, trendDirects] = await Promise.all([
    InvoicePayment.findAll({
      where: { paid_at: { [Op.gte]: trendStart } },
      include: [{ model: Invoice, where: { business_id: businessId }, attributes: ['currency'] }],
      attributes: ['amount', 'refunded_amount', 'paid_at'],
    }),
    ProjectExpense.findAll({
      include: [{ model: require('../models').Project, where: { business_id: businessId }, attributes: [] }],
      where: { incurred_at: { [Op.gte]: trendStart.toISOString().slice(0, 10) } },
      attributes: ['amount', 'incurred_at'],
    }),
  ]);
  const costTrend = [];
  for (let i = 11; i >= 0; i--) {
    const m = new Date(toDt.getFullYear(), toDt.getMonth() - i, 1);
    const key = m.toISOString().slice(0, 7);
    const rev = trendPays.filter(p => ym(p.paid_at) === key && (p.Invoice?.currency || 'KRW') === home).reduce((s, p) => s + netPay(p), 0);
    const dc = trendDirects.filter(e => ym(e.incurred_at) === key).reduce((s, e) => s + Number(e.amount || 0), 0);
    const cost = monthlyOverhead + dc;
    costTrend.push({ month: key, revenue: Math.round(rev), cost: Math.round(cost), profit: Math.round(rev - cost) });
  }

  return {
    period: { from: period.from, to: period.to, label: period.label },
    home_currency: home,
    cost_trend: costTrend,
    kpis: {
      revenue: { value: Math.round(revenue), prev: null, delta_pct: null, by_currency: revenueForeign },
      total_cost: { value: Math.round(totalCost), prev: null, delta_pct: null },
      profit: { value: Math.round(profit), prev: null, delta_pct: null },
      margin_pct: { value: margin == null ? null : Number(margin.toFixed(1)), prev: null, delta_pct: null },
      receivable: { value: Math.round(receivable), prev: null, delta_pct: null, by_currency: receivableForeign },
      overhead: { value: Math.round(overheadAlloc), prev: null, delta_pct: null },
    },
    expenses_by_category: expensesByCategory,
    insights: insights.slice(0, 3),
  };
}

// ──────────────────────────────────────────────
// Reports 탭 — 시점 고정 PDF 보고서 카드 목록
// ──────────────────────────────────────────────
async function buildReportsTab(businessId) {
  const { Report } = require('../models');
  const reports = await Report.findAll({
    where: { business_id: businessId },
    order: [['created_at', 'DESC']],
    limit: 24,
    attributes: ['id', 'kind', 'period_start', 'period_end', 'created_at', 'pdf_url', 'status', 'share_token', 'title'],
  });

  // 다음 자동 생성 일정 — 매월 1일 새벽
  const nextAuto = new Date();
  nextAuto.setMonth(nextAuto.getMonth() + 1);
  nextAuto.setDate(1);

  return {
    reports: reports.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      period_from: r.period_start,
      period_to: r.period_end,
      created_at: r.created_at,
      // 인증 사용자 다운로드 endpoint (frontend 가 토큰 헤더 + blob 처리)
      pdf_url: r.status === 'ready' ? `/api/stats/${businessId}/reports/${r.id}/pdf` : null,
      // 공유 링크 (인증 불필요) — 프론트가 절대 URL 로 변환
      share_url: r.share_token ? `/api/reports/share/${r.share_token}` : null,
      status: r.status,
    })),
    next_auto_at: nextAuto.toISOString().slice(0, 10),
    auto_kinds: ['monthly', 'quarterly', 'yearly'],
  };
}

module.exports = {
  buildTasksTab,
  buildOverviewTab,
  buildProfitTab,
  buildTeamTab,
  buildFinanceTab,
  buildReportsTab,
  aggregateTaskCounts,
  _internal: { mape, bias, accuracy, percentile },
};
