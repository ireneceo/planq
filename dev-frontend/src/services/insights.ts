// Insights 통계 페이지 데이터 fetch.
// 백엔드: /api/stats/:businessId/*
import { apiFetch } from '../contexts/AuthContext';

export type RangePreset = '7d' | '30d' | '90d' | 'month' | 'prev-month' | 'quarter';

export interface KpiValue {
  value: number | null;
  prev: number | null;
  delta_pct: number | null;
}

export interface ScatterPoint {
  task_id: number;
  title: string;
  assignee_id: number | null;
  assignee_name: string | null;
  user_estimate: number;
  actual: number;
  accuracy_pct: number | null;
}

export interface AiTrendPoint {
  month: string;        // 'YYYY-MM'
  ai_mape: number | null;
  user_mape: number | null;
  n_ai: number;
  n_user: number;
}

export interface InsightCard {
  severity: 'info' | 'warning' | 'urgent';
  title: string;
  value: string;
  hint?: string;
  action_label?: string;
  action_link?: string;
}

export interface TaskTableRow {
  task_id: number;
  title: string;
  assignee: string | null;
  category: string | null;
  user_est: number | null;
  ai_est: number | null;
  actual: number | null;
  accuracy_pct: number | null;
  bias: number | null;
  leadtime_days: number | null;
  status: string;
}

export interface TasksTabData {
  period: { from: string; to: string; label: string };
  kpis: {
    completed: KpiValue;
    created: KpiValue;
    leadtime_p50_days: KpiValue;
    leadtime_p90_days: KpiValue;
    bias_pct: KpiValue;
    ai_accuracy_pct: KpiValue;
  };
  scatter: ScatterPoint[];
  ai_trend: AiTrendPoint[];
  funnel: { not_started: number; in_progress: number; reviewing: number; completed: number; canceled: number };
  sources: { manual: number; internal_request: number; qtalk_extract: number };
  categories_pareto: { category: string; count: number; pct: number; cumulative_pct: number }[];
  table: TaskTableRow[];
  insights: InsightCard[];
}

export interface TasksFilter { assignee_id?: number | null; category?: string | null; source?: string | null }
export async function fetchTasksTab(businessId: number, range: RangePreset = '30d', compare = true, filter?: TasksFilter): Promise<TasksTabData> {
  const sp = new URLSearchParams();
  sp.set('range', range);
  if (compare) sp.set('compare', 'prev');
  if (filter?.assignee_id) sp.set('assignee_id', String(filter.assignee_id));
  if (filter?.category) sp.set('category', filter.category);
  if (filter?.source) sp.set('source', filter.source);
  const r = await apiFetch(`/api/stats/${businessId}/tasks?${sp.toString()}`);
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'fetch failed');
  return j.data as TasksTabData;
}

// 다른 5 탭 — 응답이 작아서 임의 타입으로 받음 (탭별 컴포넌트가 필드 직접 참조)
export async function fetchTab<T = unknown>(businessId: number, tab: 'overview'|'profit'|'team'|'finance'|'reports', range: RangePreset = '30d'): Promise<T> {
  const sp = new URLSearchParams();
  sp.set('range', range);
  const r = await apiFetch(`/api/stats/${businessId}/${tab}?${sp.toString()}`);
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'fetch failed');
  return j.data as T;
}

// ── 통합 보고서 (대화형) — /api/reports/* (owner/admin 전용) ──
export interface ReportPeriod {
  period_type: 'weekly' | 'monthly';
  period_start: string;
  status: string;
  confirmed_at: string | null;
  finalized_by: number | null;
}
export interface ReportPeriodsData { weekly: ReportPeriod[]; monthly: ReportPeriod[] }

export interface RollupKpi { [k: string]: number }
export interface RollupView {
  ref_id: number; name: string; department?: string | null; confirmed: boolean;
  snap?: { kpi?: RollupKpi };
}
export interface IntegratedRollup {
  period: { type: string; start: string };
  summary: {
    projects_total: number; projects_confirmed: number;
    members_total: number; members_confirmed: number;
    completed_in_period: number; in_progress: number; open_issues: number;
    overdue: number; deliverables: number; all_confirmed: boolean;
  };
  projects: RollupView[];
  members: RollupView[];
  integrated: { id: number | null; status: string; confirmed_at: string | null };
  executive_summary: string;
}

export async function getReportPeriods(businessId: number): Promise<ReportPeriodsData> {
  const r = await apiFetch(`/api/reports/${businessId}/integrated/periods`);
  const j = await r.json();
  if (!j.success) throw new Error(j.message || String(r.status));
  return j.data as ReportPeriodsData;
}
export async function getIntegratedReport(businessId: number, periodType: string, periodStart: string): Promise<IntegratedRollup> {
  const sp = new URLSearchParams({ period_type: periodType, period_start: periodStart });
  const r = await apiFetch(`/api/reports/${businessId}/integrated?${sp.toString()}`);
  const j = await r.json();
  if (!j.success) throw new Error(j.message || String(r.status));
  return j.data as IntegratedRollup;
}

// 보고서 즉시 생성 — kind: monthly/quarterly/yearly/adhoc
export async function generateReport(
  businessId: number,
  kind: 'monthly' | 'quarterly' | 'yearly' | 'adhoc',
  customPeriod?: { from: string; to: string },
): Promise<{
  id: number; kind: string; title: string;
  period_from: string; period_to: string; created_at: string; status: string;
  pdf_url: string | null; share_url: string | null;
}> {
  const body: Record<string, string> = { kind };
  if (customPeriod) { body.from = customPeriod.from; body.to = customPeriod.to; }
  const r = await apiFetch(`/api/stats/${businessId}/reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'generate failed');
  return j.data;
}
