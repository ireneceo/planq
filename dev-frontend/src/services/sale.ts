// services/sale.ts — Q sale API 클라이언트 (docs/Q_SALE_DESIGN.md)
//
// ★ 실패는 던진다. `if (j.success)` 로 삼키면 저장이 안 돼도 화면은 바뀐 채로 남아
//   사용자는 값이 슬쩍 되돌아가는 것만 보고 이유를 모른다(AutoSaveField 는 던져야 ! 배지를 띄운다).
// ★ 접근 종류(access_kind)·한도 포함 여부는 **서버가 준 값만** 쓴다 — 화면이 user_id 로 판정하지 않는다.
import { apiFetch } from '../contexts/AuthContext';

export type SaleStage = 'none' | 'inquiry' | 'consulting' | 'proposal' | 'negotiation' | 'won' | 'lost';
export type AccessKind = 'guest' | 'invited' | 'member';
export type SaleSource = 'guest_link' | 'email' | 'phone' | 'referral' | 'web' | 'event' | 'manual' | 'other';
export type LostReason = 'price' | 'timing' | 'competitor' | 'no_response' | 'fit' | 'other';
export type InteractionKind = 'call' | 'meeting' | 'visit' | 'memo' | 'other';

export interface SaleClient {
  id: number;
  display_name: string | null;
  company_name: string | null;
  phone: string | null;
  email: string | null;
  kind: string | null;
  status: string | null;
  access_kind: AccessKind;
  has_guest_link: boolean;
  quota_counted: boolean;
  sales_stage: SaleStage;
  sales_stage_changed_at: string | null;
  sales_source: SaleSource | null;
  lost_reason: LostReason | null;
  lost_note: string | null;
  expected_amount: number | null;
  expected_currency: string | null;
  last_touch_at: string | null;
  assigned_member: { id: number; name: string } | null;
  invited_at: string | null;
  accepted_at: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface StageHistoryRow {
  id: number;
  from: SaleStage | null;
  to: SaleStage;
  origin: 'manual' | 'auto';
  reason: string | null;
  changed_by: { id: number; name: string } | null;
  at: string;
}

export interface SaleClientDetail extends SaleClient {
  stage_history: StageHistoryRow[];
  channels: { conversations: number; email_threads: number; guest_links: number };
  projects: Array<{ id: number; name: string; status: string }>;
}

export interface SaleQuota {
  clients: number;
  clients_max: number | null;     // null = 무제한
  prospects: number;
  prospects_max: number | null;
}

export interface SaleSummary {
  stage_counts: Record<SaleStage, number>;
  in_progress: number;
  this_month: { won: number; lost: number };
  quota: SaleQuota;
}

export type TimelineType = 'chat' | 'email' | 'task' | 'invoice' | 'interaction' | 'stage' | 'guest';

export interface TimelineItem {
  type: TimelineType;
  id: number | string;
  at: string;
  title: string | null;
  preview?: string;
  conversation_id?: number;
  thread_id?: number;
  meta?: Record<string, unknown>;
}

export interface TimelinePage {
  items: TimelineItem[];
  has_more: boolean;
  next_before: string | null;
}

export interface InteractionInput {
  kind: InteractionKind;
  direction?: 'inbound' | 'outbound' | null;
  occurred_at?: string;
  duration_seconds?: number | null;
  title?: string | null;
  body?: string | null;
  project_id?: number | null;
}

const j = async <T = unknown>(r: Response): Promise<T> => {
  const x = await r.json().catch(() => null);
  if (!r.ok || !x?.success) {
    const err = new Error(x?.message || x?.code || `request_failed_${r.status}`) as Error & { status?: number; payload?: unknown };
    err.status = r.status;
    err.payload = x;
    throw err;
  }
  return x.data as T;
};

const qs = (params: Record<string, string | number | undefined | null>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
};

export interface ListParams {
  q?: string;
  stage?: string;        // 'in_progress' | SaleStage
  access?: string;       // AccessKind
  assignee?: string;     // userId | 'none'
  limit?: number;
  page?: number;
}

export async function listSaleClients(businessId: number, params: ListParams = {}): Promise<{ items: SaleClient[]; total: number; hasMore: boolean }> {
  const r = await apiFetch(`/api/sale/${businessId}/clients${qs(params as Record<string, string | number | undefined>)}`);
  const x = await r.json().catch(() => null);
  if (!r.ok || !x?.success) throw new Error(x?.message || `request_failed_${r.status}`);
  return { items: x.data as SaleClient[], total: Number(x.pagination?.total || 0), hasMore: !!x.pagination?.has_more };
}

export const getSaleSummary = (businessId: number) =>
  apiFetch(`/api/sale/${businessId}/summary`).then(j<SaleSummary>);

export const getSaleQuota = (businessId: number) =>
  apiFetch(`/api/sale/${businessId}/quota`).then(j<SaleQuota>);

export const getSaleClient = (businessId: number, clientId: number) =>
  apiFetch(`/api/sale/${businessId}/clients/${clientId}`).then(j<SaleClientDetail>);

export const patchSaleClient = (businessId: number, clientId: number, patch: Record<string, unknown>) =>
  apiFetch(`/api/sale/${businessId}/clients/${clientId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  }).then(j<SaleClient>);

export const setSaleStage = (
  businessId: number, clientId: number,
  body: { to: SaleStage; reason?: string; lost_reason?: LostReason; lost_note?: string },
) => apiFetch(`/api/sale/${businessId}/clients/${clientId}/stage`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then(j<{ changed: boolean; from: SaleStage; to: SaleStage; sales_stage: SaleStage }>);

export const getSaleTimeline = (
  businessId: number, clientId: number,
  opts: { limit?: number; before?: string | null; channels?: TimelineType[] } = {},
) => apiFetch(`/api/sale/${businessId}/clients/${clientId}/timeline${qs({
  limit: opts.limit, before: opts.before || undefined, channels: opts.channels?.join(','),
})}`).then(j<TimelinePage>);

export const createInteraction = (businessId: number, clientId: number, body: InteractionInput) =>
  apiFetch(`/api/sale/${businessId}/clients/${clientId}/interactions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then(j<{ id: number }>);

export const updateInteraction = (businessId: number, clientId: number, id: number, body: Partial<InteractionInput>) =>
  apiFetch(`/api/sale/${businessId}/clients/${clientId}/interactions/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then(j<{ id: number }>);

export const deleteInteraction = (businessId: number, clientId: number, id: number) =>
  apiFetch(`/api/sale/${businessId}/clients/${clientId}/interactions/${id}`, { method: 'DELETE' }).then(j<{ id: number }>);

export const reviewInteraction = (businessId: number, clientId: number, id: number) =>
  apiFetch(`/api/sale/${businessId}/clients/${clientId}/interactions/${id}/review`, { method: 'POST' }).then(j<{ id: number }>);

export type SaveAsClientInput =
  | { from: 'guest_link'; guest_link_id: number }
  | { from: 'email_thread'; email_thread_id: number }
  | { from: 'manual'; display_name?: string; company_name?: string; phone?: string; email?: string; sales_source?: SaleSource };

export const saveAsClient = (businessId: number, input: SaveAsClientInput) =>
  apiFetch(`/api/sale/${businessId}/save-as-client`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }).then(j<{ client: SaleClient; linked_existing: boolean }>);

/** 단계 목록 — 화면 순서의 단일 원천(서버 ENUM 과 같은 순서) */
export const SALE_STAGES: SaleStage[] = ['none', 'inquiry', 'consulting', 'proposal', 'negotiation', 'won', 'lost'];
export const IN_PROGRESS_STAGES: SaleStage[] = ['inquiry', 'consulting', 'proposal', 'negotiation'];
export const LOST_REASONS: LostReason[] = ['price', 'timing', 'competitor', 'no_response', 'fit', 'other'];
export const SALE_SOURCES: SaleSource[] = ['guest_link', 'email', 'phone', 'referral', 'web', 'event', 'manual', 'other'];
export const INTERACTION_KINDS: InteractionKind[] = ['call', 'meeting', 'visit', 'memo', 'other'];
