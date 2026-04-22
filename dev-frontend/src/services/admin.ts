// Platform Admin 전용 API 래퍼 — 플랜 수동 조정 / 체험 연장 / 이력
import { apiFetch } from '../contexts/AuthContext';
import type { PlanCode, PlanDef } from './plan';

export interface AdminBusinessRow {
  id: number;
  name: string;
  slug: string;
  plan: PlanCode;
  subscription_status: string;
  plan_expires_at: string | null;
  trial_ends_at: string | null;
  grace_ends_at: string | null;
  scheduled_plan: PlanCode | null;
  member_count: number;
  created_at: string;
}

export interface AdminUsage {
  members: number;
  clients: number;
  projects: number;
  conversations: number;
  storage_bytes: number;
  file_count: number;
  cue_actions_this_month: number;
  qnote_minutes_this_month: number;
}

export interface AdminBusinessDetail extends AdminBusinessRow {
  timezone: string | null;
  effective_plan: PlanDef;
  usage: AdminUsage;
}

export interface AdminPlanHistoryItem {
  id: number;
  from_plan: PlanCode;
  to_plan: PlanCode;
  reason: string;
  note: string | null;
  changed_by: { id: number; name: string; email: string } | null;
  effective_at: string;
  created_at: string;
}

export async function fetchAdminBusinesses(q = ''): Promise<AdminBusinessRow[]> {
  const url = q ? `/api/admin/businesses?q=${encodeURIComponent(q)}` : '/api/admin/businesses';
  const r = await apiFetch(url);
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'list failed');
  return j.data;
}

export async function fetchAdminBusinessDetail(id: number): Promise<AdminBusinessDetail> {
  const r = await apiFetch(`/api/admin/businesses/${id}`);
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'detail failed');
  return j.data;
}

export async function fetchAdminBusinessHistory(id: number): Promise<AdminPlanHistoryItem[]> {
  const r = await apiFetch(`/api/admin/businesses/${id}/history`);
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'history failed');
  return j.data;
}

export async function adminChangePlan(
  id: number,
  payload: { to_plan: PlanCode; note?: string | null; plan_expires_at?: string | null; scheduled_plan?: PlanCode | null }
): Promise<void> {
  const r = await apiFetch(`/api/admin/businesses/${id}/plan`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'plan change failed');
}

export async function adminUpdateTrial(id: number, trial_ends_at: string | null): Promise<void> {
  const r = await apiFetch(`/api/admin/businesses/${id}/trial`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trial_ends_at })
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'trial update failed');
}

export async function fetchAdminPlanCatalog(): Promise<PlanDef[]> {
  const r = await apiFetch(`/api/admin/plans/catalog`);
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'catalog failed');
  return j.data;
}
