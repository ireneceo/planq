// 책임 기반 단위 보고서 (R2) — report_units API 클라이언트.
//   자동초안 find-or-create → 책임자 수정(narrative/overrides) → 확정/되돌리기.
import { apiFetch } from '../contexts/AuthContext';

export type ReportScope = 'project' | 'member';
export type ReportPeriodType = 'weekly' | 'monthly';
export type ReportStatus = 'draft' | 'confirmed';

export interface TaskBrief { id: number; title: string; status: string; due_date: string | null; assignee_name: string | null; progress_percent: number; project_name?: string | null; workstream_id?: number | null; }
export interface WorkstreamBrief { id: number; title: string; color: string | null; total: number; progress_percent: number; }
export interface IssueBrief { id: number; body: string; }
export interface DeliverableBrief { kind: 'post' | 'document'; id: number; title: string; link: string; }
export interface ReportSnapshot {
  scope: ReportScope;
  period?: { type: ReportPeriodType; start: string; end: string };
  subject?: { id?: number; user_id?: number; name?: string; status?: string; department?: string | null; start_date?: string | null; end_date?: string | null; owner_user_id?: number };
  strategy?: { context: string | null; key_question: string | null; goal: string | null; governing_thought: string | null; approach: string | null };
  kpi?: Record<string, number>;
  workstreams?: WorkstreamBrief[];
  highlights?: TaskBrief[];
  in_progress?: TaskBrief[];
  risks?: TaskBrief[];
  blockers?: TaskBrief[];
  issues?: IssueBrief[];
  deliverables?: DeliverableBrief[];
  next?: TaskBrief[];
  team?: { user_id: number; name: string; active: number; completed: number }[];
  stakeholders?: { id: number; name: string }[];
}
export interface ReportUnitData {
  id: number;
  scope: ReportScope;
  ref_id: number;
  period_type: ReportPeriodType;
  period_start: string;
  status: ReportStatus;
  confirmed_by: number | null;
  confirmed_at: string | null;
  finalized_by: 'manual' | 'auto' | null;
  narrative: string;
  has_overrides: boolean;
  can_edit: boolean;
  snapshot: ReportSnapshot;
}

async function jsonOf(r: Response) { const j = await r.json(); if (!j.success) throw new Error(j.message || 'failed'); return j.data; }

export async function getReportUnit(businessId: number, q: { scope: ReportScope; ref_id: number; period_type: ReportPeriodType; period_start: string }): Promise<ReportUnitData> {
  const qs = `scope=${q.scope}&ref_id=${q.ref_id}&period_type=${q.period_type}&period_start=${q.period_start}`;
  return jsonOf(await apiFetch(`/api/reports/${businessId}/unit?${qs}`));
}
export async function patchReportUnit(businessId: number, id: number, patch: { narrative?: string; edited_overrides?: Record<string, unknown> }): Promise<ReportUnitData> {
  return jsonOf(await apiFetch(`/api/reports/${businessId}/unit/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }));
}
// #85 — SCR(상황·문제·해결) 경영진 요약 AI 초안 생성
export async function generateReportNarrative(businessId: number, id: number, lang: 'ko' | 'en'): Promise<{ headline: string; situation: string; complication: string; resolution: string; narrative: string }> {
  return jsonOf(await apiFetch(`/api/reports/${businessId}/unit/${id}/generate-narrative`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang }) }));
}
export async function confirmReportUnit(businessId: number, id: number): Promise<ReportUnitData> {
  return jsonOf(await apiFetch(`/api/reports/${businessId}/unit/${id}/confirm`, { method: 'POST' }));
}
export async function reopenReportUnit(businessId: number, id: number): Promise<ReportUnitData> {
  return jsonOf(await apiFetch(`/api/reports/${businessId}/unit/${id}/reopen`, { method: 'POST' }));
}

// ── 통합 롤업 (재설계) — 프로젝트별/개인별 "내용까지" + 확정상태 ──
export interface IntegratedUnitView {
  scope: ReportScope; ref_id: number; name: string;
  unit_status: ReportStatus; confirmed: boolean;
  finalized_by: 'manual' | 'auto' | null; confirmed_at: string | null;
  narrative: string;
  department?: string | null;  // member 만
  snap: ReportSnapshot;
}
export interface IntegratedRollup {
  period: { type: ReportPeriodType; start: string };
  summary: {
    projects_total: number; projects_confirmed: number;
    members_total: number; members_confirmed: number;
    completed_in_period: number; in_progress: number; open_issues: number; overdue: number; deliverables: number;
    all_confirmed: boolean;
  };
  projects: IntegratedUnitView[];
  members: IntegratedUnitView[];
  integrated: { id: number | null; status: ReportStatus; confirmed_by: number | null; confirmed_at: string | null; finalized_by: 'manual' | 'auto' | null };
  settings: { integrated_confirm: boolean; monthly_finalize: boolean };
  executive_summary: string;
}
export interface IntegratedPeriodItem {
  period_type: ReportPeriodType; period_start: string; status: ReportStatus; confirmed_at: string | null; finalized_by: 'manual' | 'auto' | null;
}
export async function getIntegratedPeriods(businessId: number, weeks = 8, months = 6): Promise<{ weekly: IntegratedPeriodItem[]; monthly: IntegratedPeriodItem[] }> {
  return jsonOf(await apiFetch(`/api/reports/${businessId}/integrated/periods?weeks=${weeks}&months=${months}`));
}

export async function getIntegrated(businessId: number, periodType: ReportPeriodType, periodStart: string): Promise<IntegratedRollup> {
  return jsonOf(await apiFetch(`/api/reports/${businessId}/integrated?period_type=${periodType}&period_start=${periodStart}`));
}
// 통합보고서 공개 공유 링크 발급/재사용 (owner/admin)
export async function shareIntegrated(businessId: number, periodType: ReportPeriodType, periodStart: string, dim: 'project' | 'member'): Promise<{ token: string; share_url: string }> {
  return jsonOf(await apiFetch(`/api/reports/${businessId}/integrated/share`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period_type: periodType, period_start: periodStart, dim }) }));
}
export async function confirmIntegrated(businessId: number, periodType: ReportPeriodType, periodStart: string, executiveSummary?: string): Promise<{ id: number; status: ReportStatus }> {
  return jsonOf(await apiFetch(`/api/reports/${businessId}/integrated/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period_type: periodType, period_start: periodStart, executive_summary: executiveSummary }) }));
}
export async function reopenIntegrated(businessId: number, periodType: ReportPeriodType, periodStart: string): Promise<{ id: number; status: ReportStatus }> {
  return jsonOf(await apiFetch(`/api/reports/${businessId}/integrated/reopen`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period_type: periodType, period_start: periodStart }) }));
}
export async function updateReportSettings(businessId: number, patch: { report_integrated_confirm?: boolean; monthly_finalize_enabled?: boolean }): Promise<{ report_integrated_confirm: boolean; monthly_finalize_enabled: boolean }> {
  return jsonOf(await apiFetch(`/api/businesses/${businessId}/report-settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }));
}

// 기간 헬퍼 — 주간(월요일) / 월간(1일). ws 로컬 기준 근사(백엔드가 주간은 monday 로 정규화).
export function periodStartOf(type: ReportPeriodType, base = new Date()): string {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  if (type === 'monthly') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  const dow = (d.getDay() + 6) % 7; // 월=0
  d.setDate(d.getDate() - dow);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function shiftPeriod(type: ReportPeriodType, periodStart: string, dir: -1 | 1): string {
  const [y, m, day] = periodStart.split('-').map(Number);
  if (type === 'monthly') { const d = new Date(y, m - 1 + dir, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; }
  const d = new Date(y, m - 1, day + dir * 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
