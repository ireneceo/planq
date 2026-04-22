// 플랜 서비스 래퍼
import { apiFetch } from '../contexts/AuthContext';

export type PlanCode = 'free' | 'starter' | 'basic' | 'pro' | 'enterprise';
export type BillingCycle = 'monthly' | 'yearly';
export type Currency = 'KRW' | 'USD';
export type PlanChangeReason = 'upgrade' | 'downgrade' | 'trial_start' | 'trial_end' | 'expire' | 'admin_adjust' | 'payment_failed' | 'refund';

export interface PlanDef {
  code: PlanCode;
  name: string;
  name_ko: string;
  price_monthly: { KRW: number | null; USD: number | null };
  price_yearly:  { KRW: number | null; USD: number | null };
  target: string;
  target_ko: string;
  limits: {
    members_max: number | null;
    clients_max: number | null;
    projects_max: number | null;
    conversations_max: number | null;
    storage_bytes: number | null;
    file_size_max_bytes: number | null;
    cue_actions_monthly: number | null;
    qnote_minutes_monthly: number | null;
    trash_retention_days: number | null;
    audit_log_retention_days: number | null;
  };
  features: {
    external_cloud: boolean;
    data_export: boolean;
    api_access: boolean;
    sso: boolean;
    priority_support: boolean;
  };
  support: string;
  sla: string | null;
}

export interface PlanUsage {
  members: number;
  clients: number;
  projects: number;
  conversations: number;
  storage_bytes: number;
  file_count: number;
  cue_actions_this_month: number;
  qnote_minutes_this_month: number;
}

export interface PlanHistoryItem {
  id: number;
  from_plan: PlanCode | null;
  to_plan: PlanCode;
  reason: PlanChangeReason;
  changed_by: string | null;
  note: string | null;
  effective_at: string;
}

export interface PlanStatus {
  plan: PlanDef;
  active: boolean;
  in_trial: boolean;
  in_grace: boolean;
  trial_ends_at: string | null;
  grace_ends_at: string | null;
  plan_expires_at: string | null;
  scheduled_plan: PlanCode | null;
  subscription_status: string | null;
  usage: PlanUsage;
  history: PlanHistoryItem[];
}

export async function fetchCatalog(): Promise<PlanDef[]> {
  const r = await apiFetch('/api/plan/catalog');
  const j = await r.json();
  return j.success ? (j.data as PlanDef[]) : [];
}

export async function fetchStatus(businessId: number): Promise<PlanStatus | null> {
  const r = await apiFetch(`/api/plan/${businessId}/status`);
  const j = await r.json();
  return j.success ? (j.data as PlanStatus) : null;
}

export async function startTrial(businessId: number, planCode: Exclude<PlanCode, 'free' | 'enterprise'>): Promise<boolean> {
  const r = await apiFetch(`/api/plan/${businessId}/start-trial`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan_code: planCode }),
  });
  const j = await r.json();
  return !!j.success;
}

export async function changePlan(
  businessId: number,
  toPlan: PlanCode,
  billingCycle: BillingCycle = 'monthly'
): Promise<{ upgraded?: boolean; scheduled?: boolean; scheduled_plan?: PlanCode; effective_at?: string } | null> {
  const r = await apiFetch(`/api/plan/${businessId}/change`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to_plan: toPlan, billing_cycle: billingCycle }),
  });
  const j = await r.json();
  return j.success ? j.data : null;
}

export async function cancelScheduledChange(businessId: number): Promise<boolean> {
  const r = await apiFetch(`/api/plan/${businessId}/cancel-schedule`, { method: 'POST' });
  const j = await r.json();
  return !!j.success;
}

// ─── Helpers ───

export function formatPrice(value: number | null, currency: Currency): string {
  if (value === null || value === undefined) return '문의';
  if (currency === 'KRW') return `₩${value.toLocaleString()}`;
  return `$${value}`;
}

export function formatLimit(value: number | null): string {
  if (value === null || value === undefined) return '∞';
  return value.toLocaleString();
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return '∞';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatMinutes(min: number | null): string {
  if (min === null || min === undefined) return '∞';
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  const rem = min % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

// 사용률 색상 구간
export function usageColor(ratio: number): 'ok' | 'warn' | 'crit' {
  if (ratio >= 0.95) return 'crit';
  if (ratio >= 0.80) return 'warn';
  return 'ok';
}
