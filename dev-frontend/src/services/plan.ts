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
  // 사이클 N+20 — action_type 별 breakdown.
  // 키 예시: 'brief', 'docs_generate', 'kb_embed', 'ai_estimate', 'task_summarize', 'qnote_answer', 'post_draft'
  cue_actions_by_type?: Record<string, number>;
  qnote_minutes_this_month: number;
}

export interface QnoteEstimate {
  estimated_minutes: number;
  current_minutes: number;
  limit_minutes: number | null;
  remaining_minutes: number | null;
  will_exceed: boolean;
  file_size_bytes: number;
}

// 사이클 N+20 — Q Note 업로드 전 토큰 예상 (분 단위)
export async function estimateQnoteUpload(businessId: number, fileSizeBytes: number): Promise<QnoteEstimate> {
  const { apiFetch } = await import('../contexts/AuthContext');
  const res = await apiFetch(`/api/plan/${businessId}/qnote/estimate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_size_bytes: fileSizeBytes }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.message || 'estimate failed');
  return json.data;
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

// P-2 자체 결제 흐름
export interface SubscriptionInfo {
  id: number;
  plan_code: PlanCode;
  cycle: BillingCycle;
  status: 'pending' | 'active' | 'past_due' | 'grace' | 'demoted' | 'canceled' | 'replaced';
  current_period_end: string | null;
  next_billing_at: string | null;
  grace_ends_at: string | null;
}

export interface PendingPayment {
  id: number;
  subscription_id: number;
  method: 'bank_transfer' | 'card' | 'portone' | 'manual_adjust';
  amount: number | string;
  currency: Currency;
  cycle: BillingCycle;
  created_at: string;
  // 고객이 입금 통보를 누른 시각 (있으면 "입금 확인 대기중")
  notify_paid_at?: string | null;
}

export interface PaymentRecord {
  id: number;
  subscription_id: number;
  amount: number | string;
  currency: Currency;
  cycle: BillingCycle;
  status: 'pending' | 'paid' | 'failed' | 'refunded' | 'canceled';
  paid_at: string | null;
  period_start: string | null;
  period_end: string | null;
  payer_name: string | null;
  method: string;
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
  subscription: SubscriptionInfo | null;
  pending_payment: PendingPayment | null;
  recent_payments: PaymentRecord[];
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

// ─── P-2 자체 결제 ───

// 결제 요청 — 신규 Subscription + pending Payment 생성
export async function checkout(
  businessId: number,
  planCode: Exclude<PlanCode, 'free' | 'enterprise'>,
  cycle: BillingCycle,
  currency: Currency = 'KRW'
): Promise<{ subscription_id: number; payment_id: number; amount: number; currency: Currency } | null> {
  const r = await apiFetch(`/api/plan/${businessId}/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan_code: planCode, cycle, currency }),
  });
  const j = await r.json();
  return j.success ? j.data : null;
}

// 입금 통보 (owner) — 자체 결제 트랙. owner 는 통보만, 실제 활성화는 platform_admin.
// 사업자 정보 입력 시 세금계산서 발행 정보를 함께 stash (관리자 확인 시 발행).
export interface TaxInvoiceInput {
  biz_no: string;       // 사업자등록번호 (예: 123-45-67890)
  biz_name: string;     // 상호
  ceo_name: string;     // 대표자
  address?: string;     // 주소
  email: string;        // 세금계산서 수신 이메일
}
export async function notifyPaymentPaid(
  businessId: number,
  paymentId: number,
  payerName?: string,
  payerMemo?: string,
  taxInvoice?: TaxInvoiceInput | null
): Promise<boolean> {
  const r = await apiFetch(`/api/plan/${businessId}/payments/${paymentId}/notify-paid`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payer_name: payerName, payer_memo: payerMemo, tax_invoice: taxInvoice || undefined }),
  });
  const j = await r.json();
  return !!j.success;
}

// 영수증 PDF URL
export function receiptPdfUrl(businessId: number, paymentId: number): string {
  return `/api/plan/${businessId}/payments/${paymentId}/receipt.pdf`;
}

// ─── Helpers ───

export function formatPrice(value: number | null, currency: Currency): string {
  if (value === null || value === undefined) return '문의';
  if (currency === 'KRW') return `${value.toLocaleString()}원`;
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

// ─── Add-on (추가 슬롯) ───
export type AddonField = 'addon_members' | 'addon_clients' | 'addon_qnote_minutes' | 'addon_cue_actions' | 'addon_storage_bytes';
export interface AddonItem {
  code: string;
  name_ko: string;
  name_en: string;
  price_monthly: { KRW: number; USD: number };
  unit: number;
  field: AddonField;
}
export interface AddonStatus {
  plan_code: PlanCode;
  catalog: AddonItem[];
  current: Record<AddonField, number>;
  effective: Record<string, number | null>;
}

export async function fetchAddons(businessId: number): Promise<AddonStatus> {
  const r = await apiFetch(`/api/plan/${businessId}/addons`);
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'fetch addons failed');
  return j.data as AddonStatus;
}

export async function requestAddon(businessId: number, addonCode: string, quantity: number): Promise<{
  received: boolean; addon_code: string; quantity: number; total_units: number; total_krw: number; next_step: string;
}> {
  const r = await apiFetch(`/api/plan/${businessId}/addons/request`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ addon_code: addonCode, quantity }),
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'request addon failed');
  return j.data;
}
