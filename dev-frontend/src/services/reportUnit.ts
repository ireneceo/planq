// 책임 기반 단위 보고서 (R2) — report_units API 클라이언트.
//   자동초안 find-or-create → 책임자 수정(narrative/overrides) → 확정/되돌리기.
import { apiFetch } from '../contexts/AuthContext';

export type ReportScope = 'project' | 'department';
export type ReportPeriodType = 'weekly' | 'monthly';
export type ReportStatus = 'draft' | 'confirmed';

export interface TaskBrief { id: number; title: string; status: string; due_date: string | null; assignee_name: string | null; workstream_id: number | null; }
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
  // snapshot 은 scope 에 따라 형태가 다름 (project: kpi·highlights·risks·next·team / department: kpi·members·highlights·risks)
  snapshot: {
    scope: ReportScope;
    period?: { type: ReportPeriodType; start: string; end: string };
    subject?: Record<string, unknown>;
    kpi?: Record<string, number>;
    highlights?: TaskBrief[];
    risks?: TaskBrief[];
    next?: TaskBrief[];
    team?: { user_id: number; name: string; active: number; completed: number }[];
    members?: { user_id: number; name: string; active: number; completed: number; overdue: number; completed_in_period: number }[];
    headline?: string;
    [k: string]: unknown;
  };
}

async function jsonOf(r: Response) { const j = await r.json(); if (!j.success) throw new Error(j.message || 'failed'); return j.data; }

export async function getReportUnit(businessId: number, q: { scope: ReportScope; ref_id: number; period_type: ReportPeriodType; period_start: string }): Promise<ReportUnitData> {
  const qs = `scope=${q.scope}&ref_id=${q.ref_id}&period_type=${q.period_type}&period_start=${q.period_start}`;
  return jsonOf(await apiFetch(`/api/reports/${businessId}/unit?${qs}`));
}
export async function patchReportUnit(businessId: number, id: number, patch: { narrative?: string; edited_overrides?: Record<string, unknown> }): Promise<ReportUnitData> {
  return jsonOf(await apiFetch(`/api/reports/${businessId}/unit/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }));
}
export async function confirmReportUnit(businessId: number, id: number): Promise<ReportUnitData> {
  return jsonOf(await apiFetch(`/api/reports/${businessId}/unit/${id}/confirm`, { method: 'POST' }));
}
export async function reopenReportUnit(businessId: number, id: number): Promise<ReportUnitData> {
  return jsonOf(await apiFetch(`/api/reports/${businessId}/unit/${id}/reopen`, { method: 'POST' }));
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
