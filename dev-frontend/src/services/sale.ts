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
  /** 연락처 — 목록은 이메일을 하나로 접지만 상세는 **종류별로** 편다(어떤 주소인지 말할 수 있게) */
  contact?: {
    invite_email: string | null;
    account_email: string | null;
    billing_email: string | null;
    tax_invoice_email: string | null;
    phone: string | null;
    billing_phone: string | null;
    billing_contact_name: string | null;
  };
  /** 등록자·등록 시각 — 단계 이력의 **첫 행**에서 파생한다(새 컬럼 없음). 이력이 없으면 by=null */
  registered_by?: { id: number; name: string } | null;
  registered_at?: string | null;
  /** 사업자 정보 — 없으면 null */
  biz?: {
    name: string | null;
    ceo: string | null;
    tax_id: string | null;
    type: string | null;
    item: string | null;
    address: string | null;
    address_en: string | null;
  } | null;
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

// 'note' — 고객에 연결된 대화방·메일·프로젝트·업무에 달린 **메모를 읽을 때만 모은 것**
//   (서버 services/clientTimeline 의 명시 채널. 저장은 원래 자리에 그대로 있다.)
export type TimelineType = 'chat' | 'email' | 'task' | 'invoice' | 'interaction' | 'stage' | 'guest' | 'note';

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

// ── 상담(고객 미등록 접점) — Irene 2026-09-12 "상세(채팅, 메일, 전화, 등등) > 고객 이렇게 들어가야지"
//   서버는 새 테이블 없이 원본(게스트 링크·메일 스레드·고객 대화방)에서 client_id 가 빈 것만 읽는다.
export type SaleInboxSource = 'guest_link' | 'email' | 'chat' | 'dismissed';

export interface SaleInboxItem {
  /** 'client' = 이미 등록된 **진행 중 상담**(등록해도 상담은 계속된다 — 2026-09-12) */
  source: SaleInboxSource | 'client';
  /** `${source}:${id}` — 목록 key */
  id: string;
  /** 고객으로 저장·원본 열기에 쓰는 원본 참조. 'client' 는 이미 등록된 상담이다 */
  ref: { kind: 'guest_link' | 'email_thread' | 'conversation' | 'client'; id: number; conversation_id?: number };
  /** 등록된 상담의 영업 단계 (미등록이면 없다) */
  stage?: string | null;
  client_id?: number | null;
  phone?: string | null;
  who: string | null;
  email: string | null;
  /** 회사 — 입력값이 없으면 이메일 도메인에서 **추정**한다(estimated). 화면은 둘을 구분해 보여준다 */
  company: { name: string; estimated: boolean } | null;
  title: string | null;
  preview: string | null;
  at: string | null;
  needs_reply: boolean;
  meta: Record<string, unknown>;
  /** 원본 화면 경로 (/talk?conv= · /mail?thread=) */
  open_path: string;
}

export interface SaleInboxCounts {
  total: number; needs_reply: number; guest_link: number; email: number; chat: number;
  /** 보관함 — 사람이 [문의 아님] 이라고 판단한 것 */
  dismissed?: number;
  /** 등록된 진행 중 상담 수 */
  client?: number;
}

export async function listSaleInbox(
  businessId: number,
  params: { source?: SaleInboxSource | ''; q?: string; needsReply?: boolean; limit?: number } = {},
): Promise<{ items: SaleInboxItem[]; counts: SaleInboxCounts }> {
  const sp = new URLSearchParams();
  if (params.source) sp.set('source', params.source);
  if (params.q) sp.set('q', params.q);
  if (params.needsReply) sp.set('needs_reply', 'true');
  if (params.limit) sp.set('limit', String(params.limit));
  const qs = sp.toString();
  const r = await apiFetch(`/api/sale/${businessId}/inbox${qs ? `?${qs}` : ''}`);
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.success) throw new Error(j?.message || `HTTP ${r.status}`);
  return {
    items: (j.data?.items || []) as SaleInboxItem[],
    counts: (j.data?.counts || { total: 0, needs_reply: 0, guest_link: 0, email: 0, chat: 0 }) as SaleInboxCounts,
  };
}

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
  // balanced — 요약 자리(우측 패널)에서만 켠다. 한 채널이 몇 안 되는 자리를 다 먹는 것을 막는다.
  // 전체 목록에는 쓰지 않는다(시간순 자체가 사실이고, 건너뛴 항목 때문에 커서가 거짓이 된다).
  opts: { limit?: number; before?: string | null; channels?: TimelineType[]; balanced?: boolean } = {},
) => apiFetch(`/api/sale/${businessId}/clients/${clientId}/timeline${qs({
  limit: opts.limit, before: opts.before || undefined, channels: opts.channels?.join(','),
  balanced: opts.balanced ? '1' : undefined,
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

// ─── 히스토리 요약 (docs/Q_SALE_DESIGN.md §10) ─────────────────────────────
export interface SummarySentence { text: string; refs: Array<{ type: TimelineType; id: number | string }> }
export interface SummaryJson {
  situation: SummarySentence[];
  needs: SummarySentence[];
  decisions: SummarySentence[];
  open_issues: SummarySentence[];
  next_steps: SummarySentence[];
}
export interface SummaryStatus {
  has_summary: boolean;
  summary: string | null;
  summary_json: SummaryJson | null;
  as_of: string | null;
  updated_at: string | null;
  manual: boolean;
  model: string | null;
  item_count: number | null;
  /** 기준선 뒤에 생긴 접점 수 — 0 이면 "최신" */
  new_items: number;
  stale: boolean;
  /** 갱신을 눌렀는데 LLM 을 안 부른 이유 (up_to_date · manual_summary · no_items …) */
  skipped?: string | null;
}
export const SUMMARY_SECTIONS: Array<keyof SummaryJson> = ['situation', 'needs', 'decisions', 'open_issues', 'next_steps'];

export const getClientSummary = (businessId: number, clientId: number) =>
  apiFetch(`/api/sale/${businessId}/clients/${clientId}/summary`).then(j<SummaryStatus>);

/** 갱신 — 낡지 않았으면 서버가 LLM 을 부르지 않고 skipped:'up_to_date' 로 돌려준다. force = [AI 로 다시] */
export const refreshClientSummary = (businessId: number, clientId: number, force = false) =>
  apiFetch(`/api/sale/${businessId}/clients/${clientId}/summary/refresh`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force }),
  }).then(j<SummaryStatus>);

export const setClientSummaryManual = (businessId: number, clientId: number, summary: string) =>
  apiFetch(`/api/sale/${businessId}/clients/${clientId}/summary`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ summary }),
  }).then(j<SummaryStatus>);

export type SaveAsClientInput =
  | { from: 'guest_link'; guest_link_id: number }
  | { from: 'email_thread'; email_thread_id: number }
  | { from: 'manual'; display_name?: string; company_name?: string; phone?: string; email?: string;
      sales_source?: SaleSource;
      /** 첫 상담 기록 — 전화·방문 내용은 **등록하는 그 순간**에만 손에 있다. 같이 보낸다 */
      interaction?: { kind: InteractionKind; title?: string | null; body?: string | null; direction?: 'inbound' | 'outbound' | null } };

export const saveAsClient = (businessId: number, input: SaveAsClientInput) =>
  apiFetch(`/api/sale/${businessId}/save-as-client`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }).then(j<{ client: SaleClient; linked_existing: boolean }>);

/** 붙여넣은 글에서 문의 정보 뽑기 (AI). **저장하지 않는다** — 폼에 채우고 사람이 확인해 저장한다. */
export interface InquiryExtract {
  display_name: string | null;
  company_name: string | null;
  phone: string | null;
  email: string | null;
  sales_source: SaleSource | null;
  summary: string | null;
  /** 이름·회사·전화·이메일 중 하나라도 뽑혔는가 — 아무것도 없으면 화면이 그렇게 말한다 */
  found: boolean;
}
export const extractInquiry = (businessId: number, text: string) =>
  apiFetch(`/api/sale/${businessId}/inquiry/extract`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
  }).then(j<InquiryExtract>);

/** [문의 아님] — 사람이 메일 분류를 정정한다. 상담에서 내려가고 Q mail 판정도 같이 고쳐진다. */
export const dismissInboxItem = (businessId: number, kind: 'email_thread', id: number) =>
  apiFetch(`/api/sale/${businessId}/inbox/dismiss`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, id }),
  }).then(j<{ id: number; triage: string }>);

/** 보관함에서 되돌리기 — [문의 아님]은 사람의 판단이고 사람은 틀린다. 되돌릴 길이 없으면 삭제나 마찬가지다. */
export const restoreInboxItem = (businessId: number, kind: 'email_thread', id: number) =>
  apiFetch(`/api/sale/${businessId}/inbox/restore`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, id }),
  }).then(j<{ id: number; triage: string }>);

/** 단계 목록 — 화면 순서의 단일 원천(서버 ENUM 과 같은 순서) */
export const SALE_STAGES: SaleStage[] = ['none', 'inquiry', 'consulting', 'proposal', 'negotiation', 'won', 'lost'];
export const IN_PROGRESS_STAGES: SaleStage[] = ['inquiry', 'consulting', 'proposal', 'negotiation'];
export const LOST_REASONS: LostReason[] = ['price', 'timing', 'competitor', 'no_response', 'fit', 'other'];
export const SALE_SOURCES: SaleSource[] = ['guest_link', 'email', 'phone', 'referral', 'web', 'event', 'manual', 'other'];
export const INTERACTION_KINDS: InteractionKind[] = ['call', 'meeting', 'visit', 'memo', 'other'];
