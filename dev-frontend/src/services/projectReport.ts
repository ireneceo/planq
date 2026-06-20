// 프로젝트 보고서뷰 (#64) — Live 파생 상태 보고서 API 클라이언트.
import { apiFetch } from '../contexts/AuthContext';

export interface ReportTaskBrief { id: number; title: string; status: string; due_date: string | null; assignee_name: string | null; workstream_id: number | null; }
export interface ReportWorkstream { id: number; title: string; color: string | null; order_index: number; status: string; rollup: { total: number; completed: number; in_progress: number; overdue: number; progress_pct: number }; }
export interface ProjectReport {
  project: { id: number; name: string; status: string; start_date: string | null; end_date: string | null; owner_user_id: number };
  period: { week_start: string; week_end: string };
  kpi: { progress_percent: number; progress_delta: number; completed_tasks: number; total_tasks: number; overdue_count: number; open_issues: number; d_day: number | null; health: 'green' | 'yellow' | 'red'; this_week_completed: number };
  strategy: { context: string | null; key_question: string | null; goal: string | null; governing_thought: string | null; approach: string | null };
  success_metrics: { id?: string; label: string; target: string; current: string; unit: string }[];
  workstreams: ReportWorkstream[];
  highlights: ReportTaskBrief[];
  risks: ReportTaskBrief[];
  next_week: ReportTaskBrief[];
  stages: { id: number; kind: string; label: string; status: string }[];
  issues: { id: number; body: string; created_at: string }[];
  deliverables: { kind: 'post' | 'document'; id: number; title: string; category: string | null; created_at: string; link: string }[];
  team: { user_id: number; name: string; dept: string | null; active: number; completed: number }[];
}

export interface ProjectLite { id: number; name: string; status: string; }

async function jsonOf(r: Response) { const j = await r.json(); if (!j.success) throw new Error(j.message || 'failed'); return j.data; }

export async function getProjectReport(projectId: number, weekStart?: string): Promise<ProjectReport> {
  const q = weekStart ? `?week_start=${weekStart}` : '';
  return jsonOf(await apiFetch(`/api/projects/${projectId}/report${q}`));
}

export async function listActiveProjects(businessId: number): Promise<ProjectLite[]> {
  const r = await apiFetch(`/api/projects?business_id=${businessId}&status=active`);
  const j = await r.json();
  return j.success && Array.isArray(j.data) ? j.data.map((p: { id: number; name: string; status: string }) => ({ id: p.id, name: p.name, status: p.status })) : [];
}

export const HEALTH_META: Record<string, { bg: string; fg: string; label: string }> = {
  green: { bg: '#DCFCE7', fg: '#15803D', label: 'green' },
  yellow: { bg: '#FEF9C3', fg: '#A16207', label: 'yellow' },
  red: { bg: '#FEE2E2', fg: '#B91C1C', label: 'red' },
};
