// 주간 보고 (Weekly Review) API client

import { apiFetch } from '../contexts/AuthContext';

// ─── Types ───
export interface WeeklyReviewSummary {
  total: number;
  completed: number;
  incomplete: number;
  estimated_total: number;
  actual_total: number;
  utilization_pct: number;
  capacity_hours: number;
}

export interface WeeklyReviewTask {
  id: number;
  title: string;
  status: string;
  estimated_hours: number;
  actual_hours: number;
  progress_percent: number;
  due_date: string | null;
  start_date: string | null;
  project_id: number | null;
  project_name: string | null;
  priority_order: number | null;
}

export interface BurndownPoint {
  date: string;
  estimated_cumulative: number;
  actual_cumulative: number;
}

export interface WeeklyReviewSnapshot {
  schema_version?: number;
  tasks: WeeklyReviewTask[];
  summary: WeeklyReviewSummary;
  burndown: BurndownPoint[];
  // 사이클 N+18 — 개인본 확장 (optional, 이전 버전 snapshot 호환)
  projects?: Array<{
    project_id: number; name: string; status: string;
    progress_percent: number; progress_delta?: number;
    completed_tasks: number; total_tasks: number; overdue_count: number; open_issues: number;
    end_date: string | null; d_day: number | null;
  }>;
  issues?: Array<{ id: number; title: string; severity: string; project_id: number | null; project_name: string | null; opened_at: string; days_open: number }>;
  risks?: Array<{ kind: string; severity: string; task_id: number; title: string; project_name: string | null; assignee_name: string; detail: string }>;
  blockers?: Array<{ task_id: number; title: string; assignee_name: string; project_name: string | null; blocked_status: string; blocked_since: string; days_blocked: number; reason_snippet: string | null }>;
  next_week_focus?: Array<{ task_id: number; title: string; due_date: string; days_until: number; assignee_name: string; project_name: string | null; priority_order: number | null }>;
  key_completions?: Array<{ task_id: number; title: string; project_name: string | null; estimated_hours: number }>;
}

export interface WeeklyReview {
  id: number;
  user_id: number;
  business_id: number;
  week_start: string;
  week_end: string;
  finalized_at: string;
  finalized_by: 'manual' | 'auto';
  snapshot_data: WeeklyReviewSnapshot;
  retro_note: string | null;
  created_at: string;
}

export interface WeeklyReviewListItem {
  id: number;
  user_id?: number;
  user_name?: string | null;
  week_start: string;
  week_end: string;
  finalized_at: string;
  finalized_by: 'manual' | 'auto';
  retro_note: string | null;
  summary: WeeklyReviewSummary | null;
  created_at: string;
}

export interface WeeklyReviewSettings {
  auto_enabled: boolean;
}

// ─── API 함수 ───

// 수동 박제
export async function createWeeklyReview(params: {
  business_id: number;
  week_start?: string;
  retro_note?: string;
  overwrite?: boolean;
}): Promise<WeeklyReview> {
  const qs = params.overwrite ? '?overwrite=true' : '';
  const res = await apiFetch(`/api/weekly-reviews${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      business_id: params.business_id,
      week_start: params.week_start,
      retro_note: params.retro_note,
    }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.message || 'Failed to create weekly review');
  return json.data;
}

// 누적 결산 목록 — user_id='all' 이면 워크스페이스 전체 (owner 만)
export async function listWeeklyReviews(params: {
  business_id: number;
  user_id?: number | 'all';
  limit?: number;
  before?: string;
}): Promise<WeeklyReviewListItem[]> {
  const sp = new URLSearchParams();
  sp.set('business_id', String(params.business_id));
  if (params.user_id !== undefined && params.user_id !== null) sp.set('user_id', String(params.user_id));
  if (params.limit) sp.set('limit', String(params.limit));
  if (params.before) sp.set('before', params.before);

  const res = await apiFetch(`/api/weekly-reviews?${sp.toString()}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.message || 'Failed to list weekly reviews');
  return json.data;
}

// 가장 최근 결산
export async function getLatestWeeklyReview(businessId: number): Promise<WeeklyReview | null> {
  const res = await apiFetch(`/api/weekly-reviews/latest?business_id=${businessId}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.message || 'Failed to get latest');
  return json.data;
}

// 풀 view
export async function getWeeklyReview(id: number): Promise<WeeklyReview> {
  const res = await apiFetch(`/api/weekly-reviews/${id}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.message || 'Failed to get weekly review');
  return json.data;
}

// retro_note 수정
export async function updateWeeklyReviewNote(id: number, retro_note: string | null): Promise<WeeklyReview> {
  const res = await apiFetch(`/api/weekly-reviews/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ retro_note }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.message || 'Failed to update');
  return json.data;
}

// 삭제
export async function deleteWeeklyReview(id: number): Promise<void> {
  const res = await apiFetch(`/api/weekly-reviews/${id}`, { method: 'DELETE' });
  const json = await res.json();
  if (!json.success) throw new Error(json.message || 'Failed to delete');
}

// 설정 조회
export async function getWeeklyReviewSettings(businessId: number): Promise<WeeklyReviewSettings> {
  const res = await apiFetch(`/api/weekly-reviews/settings?business_id=${businessId}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.message || 'Failed to get settings');
  return json.data;
}

// 설정 변경
export async function updateWeeklyReviewSettings(params: {
  business_id: number;
  auto_enabled: boolean;
}): Promise<WeeklyReviewSettings> {
  const res = await apiFetch('/api/weekly-reviews/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.message || 'Failed to update settings');
  return json.data;
}

// ─── Preview 빌드 (서버 호출 없이 현재 주 예상) ───
// POST / 전에 모달에서 보여줄 preview용 — 서버 API 추가 시 교체
export async function previewCurrentWeek(_businessId: number): Promise<WeeklyReviewSnapshot | null> {
  // 서버에 preview 엔드포인트가 없으므로 null 반환
  // 실제 저장 시 서버에서 빌드
  return null;
}

// ═════════════════════════════════════════════════════════════
// 워크스페이스 통합 주간 보고서 (사이클 N+18)
// ═════════════════════════════════════════════════════════════

export type Severity = 'high' | 'medium' | 'low';
export type RiskKind = 'overdue' | 'stalled' | 'due_soon_low_progress';
export type BlockerStatus = 'waiting' | 'revision_requested';
export type Health = 'green' | 'yellow' | 'red';
export type MemberLoadStatus = 'underloaded' | 'normal' | 'overloaded';

export interface KpiTile { value: number; delta: number | null; }
export interface WorkspaceKpi {
  completed_tasks: KpiTile;
  active_projects: KpiTile;
  avg_utilization_pct: KpiTile;
  open_issues: KpiTile;
  overdue_tasks: KpiTile;
}
export interface HighlightItem {
  task_id: number; title: string; project_name: string | null; assignee_name: string; estimated_hours: number;
}
export interface RiskItem {
  kind: RiskKind; severity: Severity;
  task_id: number; title: string; project_name: string | null; assignee_name: string; detail: string;
}
export interface BlockerItem {
  task_id: number; title: string; assignee_name: string; project_name: string | null;
  blocked_status: BlockerStatus; blocked_since: string; days_blocked: number; reason_snippet: string | null;
}
export interface IssueItem {
  id: number; title: string; severity: Severity;
  project_id: number | null; project_name: string | null; opened_at: string; days_open: number;
}
export interface NextWeekItem {
  task_id: number; title: string; due_date: string; days_until: number;
  assignee_name: string; project_name: string | null; priority_order: number | null;
}
export interface PortfolioItem {
  project_id: number; name: string; status: string;
  progress_percent: number; progress_delta: number;
  completed_tasks: number; total_tasks: number; overdue_count: number; open_issues: number;
  end_date: string | null; d_day: number | null; health: Health;
}
export interface MemberUtilization {
  user_id: number; name: string;
  capacity_hours: number; actual_hours: number; utilization_pct: number;
  completed_tasks: number; overdue_tasks: number; status: MemberLoadStatus;
}
export interface TeamHighlight {
  user_id: number; name: string;
  top_completion: { task_id: number; title: string } | null;
  retro_excerpt: string | null;
}
export type DecisionKind = 'revision_blocked' | 'overdue_no_reviewer' | 'unassigned_due_soon';
export interface DecisionRequired {
  kind: DecisionKind; task_id: number; title: string; project_name: string | null;
  days_pending: number; suggested_action: string;
}

export interface WorkspaceSnapshot {
  schema_version: 1;
  generated_at: string;
  period: { week_start: string; week_end: string };
  kpi: WorkspaceKpi;
  highlights: HighlightItem[];
  risks: RiskItem[];
  blockers: BlockerItem[];
  issues: IssueItem[];
  next_week_focus: NextWeekItem[];
  portfolio: PortfolioItem[];
  member_utilization: MemberUtilization[];
  team_highlights: TeamHighlight[];
  decisions_required: DecisionRequired[];
}

export interface WorkspaceWeeklyReport {
  id: number; business_id: number;
  week_start: string; week_end: string;
  finalized_at: string; finalized_by: 'manual' | 'auto';
  finalized_by_user_id: number | null;
  snapshot_data: WorkspaceSnapshot;
  executive_summary: string | null;
  retro_note: string | null;
  created_at: string;
}

export interface WorkspaceWeeklyReportListItem {
  id: number;
  week_start: string; week_end: string;
  finalized_at: string; finalized_by: 'manual' | 'auto';
  finalizer_name: string | null;
  executive_summary: string | null;
  retro_note: string | null;
  kpi: WorkspaceKpi | null;
  created_at: string;
}

export async function createWorkspaceWeeklyReport(business_id: number, week_start?: string): Promise<WorkspaceWeeklyReport> {
  const res = await apiFetch('/api/weekly-reviews/workspace', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ business_id, week_start }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.message || 'Failed to create workspace weekly report');
  return json.data;
}
export async function listWorkspaceWeeklyReports(params: { business_id: number; limit?: number; before?: string }): Promise<WorkspaceWeeklyReportListItem[]> {
  const sp = new URLSearchParams();
  sp.set('business_id', String(params.business_id));
  if (params.limit) sp.set('limit', String(params.limit));
  if (params.before) sp.set('before', params.before);
  const res = await apiFetch(`/api/weekly-reviews/workspace?${sp.toString()}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.message || 'Failed to list workspace weekly reports');
  return json.data;
}
export async function getWorkspaceWeeklyReport(id: number): Promise<WorkspaceWeeklyReport> {
  const res = await apiFetch(`/api/weekly-reviews/workspace/${id}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.message || 'Failed to get workspace weekly report');
  return json.data;
}
export async function updateWorkspaceWeeklyReport(id: number, patch: { executive_summary?: string | null; retro_note?: string | null }): Promise<WorkspaceWeeklyReport> {
  const res = await apiFetch(`/api/weekly-reviews/workspace/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.message || 'Failed to update workspace weekly report');
  return json.data;
}
export async function deleteWorkspaceWeeklyReport(id: number): Promise<void> {
  const res = await apiFetch(`/api/weekly-reviews/workspace/${id}`, { method: 'DELETE' });
  const json = await res.json();
  if (!json.success) throw new Error(json.message || 'Failed to delete');
}
