// services/sale.ts — Q sale API 클라이언트 (docs/Q_SALE_DESIGN.md)
//
// ★ 실패는 던진다. `if (j.success)` 로 삼키면 저장이 안 돼도 화면은 바뀐 채로 남아
//   사용자는 값이 슬쩍 되돌아가는 것만 보고 이유를 모른다(AutoSaveField 는 던져야 ! 배지를 띄운다).
// ★ 접근 종류(access_kind)·한도 포함 여부는 **서버가 준 값만** 쓴다 — 화면이 user_id 로 판정하지 않는다.
import { apiFetch, apiUpload } from '../contexts/AuthContext';

export type SaleStage = 'none' | 'inquiry' | 'consulting' | 'proposal' | 'negotiation' | 'won' | 'lost';
export type { AccessKind } from '../utils/clientLabel';
import type { AccessKind } from '../utils/clientLabel';
export type SaleSource = 'guest_link' | 'email' | 'phone' | 'referral' | 'web' | 'event' | 'manual' | 'other';
export type LostReason = 'price' | 'timing' | 'competitor' | 'no_response' | 'fit' | 'other';
export type InteractionKind = 'call' | 'meeting' | 'visit' | 'memo' | 'other';

export interface SaleClient {
  id: number;
  display_name: string | null;
  company_name: string | null;
  phone: string | null;
  /** 명함 칸 — 대표 담당자(이 고객 행의 사람)의 직함·부서 */
  job_title?: string | null;
  department?: string | null;
  email: string | null;
  kind: string | null;
  status: string | null;
  access_kind: AccessKind;
  has_guest_link: boolean;
  /** 초대해 같은 행을 올릴 수 있는가 · 받는 주소를 고칠 수 있는가 — 서버 services/clientAccess 판정 */
  can_invite?: boolean;
  email_editable?: boolean;
  quota_counted: boolean;
  /** 연결 프로젝트 수 — 상세와 같은 술어(client_id 또는 계정 contact_user_id) */
  project_count?: number;
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

export interface ClientBilling {
  is_business: boolean;
  biz_name: string | null;
  biz_tax_id: string | null;
  biz_ceo: string | null;
  biz_type: string | null;
  biz_item: string | null;
  biz_address: string | null;
  tax_invoice_email: string | null;
  billing_contact_name: string | null;
  billing_contact_email: string | null;
  billing_contact_phone: string | null;
}

export interface SaleClientDetail extends SaleClient {
  stage_history: StageHistoryRow[];
  channels: { conversations: number; email_threads: number; guest_links: number };
  /** link_id = project_clients 행 id. 연결을 **푸는** 문이 고객 id 가 아니라 이 행 id 를 받는다
   *  (DELETE /api/projects/:id/clients/:linkId — 이름이 :clientId 라 헷갈리지만 where 는 id 로 찾는다). */
  projects: Array<{ id: number; name: string; status: string; link_id?: number }>;
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
  /** 다가오는 «다음 연락» 일정(target_client_ids 에 이 고객) — 없으면 null (0-J) */
  next_contact?: { id: number; title: string; start_at: string } | null;
  /** 사업자·증빙 — 패널에서 고친다(저장은 PUT /api/clients/:biz/:id). 2026-10-16 설정 > 고객 을 합치며 옮겼다 */
  billing?: ClientBilling;
  /** 내부 메모 · 초대 재발송 횟수 */
  notes?: string | null;
  reinvite_count?: number;
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
  /** Q note 세션에서 저장할 때만. 서버가 **소유를 확인한 뒤** source_kind='qnote' 로 박는다
   *  (화면이 출처를 고르지 않는다 — services/qnoteOwnership.js). */
  qnote_session_id?: number | null;
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
  /** Q mail 에서 [확인완료] 한 건 — 목록에는 남되 «답할 차례» 는 아니다(#Q sale 2026-09-17). */
  handled?: boolean;
  meta: Record<string, unknown>;
  /** 상담 기록(메모) 건수 — 리스트의 [메모] 가 몇 건인지 보여준다 */
  note_count?: number;
  /** 원본 화면 경로 (/talk?conv= · /mail?thread=) */
  open_path: string;
}

export interface SaleInboxCounts {
  total: number; needs_reply: number; guest_link: number; email: number; chat: number;
  /** 보관함 — 사람이 [문의 아님] 이라고 판단한 것 */
  dismissed?: number;
  /** 후보 — 자동 유입 기준(관계)에 안 걸린 메일. 버리지 않고 여기 모아 사람이 올린다 (2026-09-16) */
  /** 등록된 진행 중 상담 수 */
  client?: number;
  /** #449 — 수동 모드에서 자동 기준에만 드는 메일 수(Q mail 「문의 후보」). 자동 모드면 0 */
  auto_candidates?: number;
  /** #449 — 메일 유입 모드 */
  intake_mode?: 'manual' | 'auto';
}

/** #449 — Q sales 메일 유입 모드 저장(owner). 읽기는 customer-entry GET 의 `sales_intake`. */
export interface SalesIntake {
  mail: 'manual' | 'auto';
  /** 끈 자동 기준(replied·personal) — 2026-10-15 */
  off: string[];
  /** 사람이 등록한 «늘 상담 / 상담 아님» 주소·도메인 */
  domains: { always: string[]; never: string[] };
}
export interface SaleCriterion { id: string; lockable?: boolean; list?: 'always' | 'never' }
export const saveSalesIntake = (businessId: number, mail: 'manual' | 'auto') =>
  apiFetch(`/api/businesses/${businessId}/sales-intake`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mail }),
  }).then(j<{ sales_intake: SalesIntake }>);
/** 기준 끄기·주소 목록 부분 저장(owner) — 보낸 칸만 바뀐다. */
export const patchSalesIntake = (businessId: number, patch: Partial<Pick<SalesIntake, 'off' | 'domains'>>) =>
  apiFetch(`/api/businesses/${businessId}/sales-intake`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  }).then(j<{ sales_intake: SalesIntake }>);

export async function listSaleInbox(
  businessId: number,
  params: { source?: SaleInboxSource | ''; q?: string; needsReply?: boolean; limit?: number;
    /** 단계 한 개로 좁힌다 — 미등록 접점은 단계가 없어 이때 빠진다(서버에서) */
    stage?: SaleStage | '';
    /** 종료(성사·불발)까지 보여줄지. 기본은 가린다(체크된 상태) */
    includeClosed?: boolean;
    /** 고객 목록과 **같은 축** — 접근 종류 · 담당자 (2026-09-14) */
    access?: string; assignee?: string } = {},
): Promise<{ items: SaleInboxItem[]; counts: SaleInboxCounts }> {
  const sp = new URLSearchParams();
  if (params.source) sp.set('source', params.source);
  if (params.q) sp.set('q', params.q);
  if (params.needsReply) sp.set('needs_reply', 'true');
  if (params.stage) sp.set('stage', params.stage);
  if (params.includeClosed) sp.set('include_closed', 'true');
  if (params.access) sp.set('access', params.access);
  if (params.assignee) sp.set('assignee', params.assignee);
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
  status?: string;       // 빈 값 = 전부 · active = 보관 안 한 것 · archived = 보관만
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
  body: { to: SaleStage; reason?: string; lost_reason?: LostReason; lost_note?: string;
    /** 어느 문의에서 바꿨는가 — 상담 목록에서 바꾸면 그 행을 싣는다(히스토리에 남는다) */
    source_ref?: { kind: string; id: number; title?: string | null } },
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
      /** #449 D5 — 웹폼 문의를 본문으로 등록할 때 그 메일 스레드를 새 고객에 붙인다 */
      email_thread_id?: number;
      /** 첫 상담 기록 — 전화·방문 내용은 **등록하는 그 순간**에만 손에 있다. 같이 보낸다 */
      // 응대 내역 — 공용 칸(InteractionFields)이 적는 것을 **그대로** 보낸다.
      //   칸이 생겼는데 안 보내면 사용자가 적은 것이 조용히 사라진다.
      interaction?: {
        kind: InteractionKind; title?: string | null; body?: string | null;
        direction?: 'inbound' | 'outbound' | null;
        occurred_at?: string; duration_minutes?: number;
      } };

export const saveAsClient = (businessId: number, input: SaveAsClientInput) =>
  apiFetch(`/api/sale/${businessId}/save-as-client`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }).then(j<{ client: SaleClient; linked_existing: boolean }>);

/** #449 D5 — 웹폼 문의의 마지막 수신 본문(등록 폼에 미리 채운다). */
export const getWebformText = (businessId: number, emailThreadId: number) =>
  apiFetch(`/api/sale/${businessId}/inbox/webform-text`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email_thread_id: emailThreadId }),
  }).then(j<{ text: string; subject: string | null; email_thread_id: number }>);

/** 웹폼 행 → 문의 추가(Cue 바)로 본문을 넘기는 신호. 바가 받아 채우고 정리(추출)까지 돌린다. */
export const SALE_PREFILL_EVENT = 'sale:prefill-inquiry';
export interface SalePrefillDetail { text: string; emailThreadId: number }

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
export const dismissInboxItem = (businessId: number, kind: 'email_thread' | 'conversation', id: number) =>
  apiFetch(`/api/sale/${businessId}/inbox/dismiss`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, id }),
  }).then(j<{ id: number; triage: string }>);

/** [상담으로 보내기] — 기계가 놓친 것을 사람이 올린다 (2026-09-16).
 *
 *  ★ 자동 유입 기준을 **관계가 증명된 것만**으로 좁힌 대가를 갚는 문이다(services/saleMailCriteria).
 *    좁힌 기준과 이 문은 한 벌이라, 한쪽만 있으면 안 된다 — 기준만 좁히면 놓친 문의를 살릴 길이 없고,
 *    문만 있으면 목록이 계속 홍보메일로 덮인다.
 *  @param kind 'email_thread' = 메일 목록·상세에서 / 'conversation' = 채팅에서
 *  @param messageId 채팅에서 올릴 때 **어느 말 때문에** 올렸는지 (원장에 남는다)
 */
export const promoteInboxItem = (
  businessId: number, kind: 'email_thread' | 'conversation', id: number, messageId?: number,
) =>
  apiFetch(`/api/sale/${businessId}/inbox/promote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, id, ...(messageId ? { message_id: messageId } : {}) }),
  }).then(j<{ id: number; kind: string }>);

/** [상담으로 보내기] 실패 사유 → i18n 키(qsale `promoteError.*`). 서버 코드가 아니면 일반 사유. (#449 D1)
 *  ★ 여태 두 화면 모두 실패를 `catch {}` 로 삼켜 400 이 «아무 일도 안 일어남» 이었다. */
export const promoteErrorKey = (e: unknown): string => {
  const code = String((e as { payload?: { message?: string; code?: string } })?.payload?.message
    || (e as { payload?: { code?: string } })?.payload?.code || '');
  return ['already_client', 'thread_is_spam', 'not_customer_chat'].includes(code) ? code : 'generic';
};

/** 보관함에서 되돌리기 — [문의 아님]은 사람의 판단이고 사람은 틀린다. 되돌릴 길이 없으면 삭제나 마찬가지다. */
export const restoreInboxItem = (businessId: number, kind: 'email_thread', id: number) =>
  apiFetch(`/api/sale/${businessId}/inbox/restore`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, id }),
  }).then(j<{ id: number; triage: string }>);

/** 보관함에서 **영구히 빼기** — 다시는 상담·보관함에 나타나지 않는다.
 *  ★ 메일 자체는 지우지 않는다(Q mail 에 그대로 있다). 지우는 것은 상담 목록에서의 자리다. */
/** 상담 메일 한 스레드의 이력 전부(보냄/받음) — 우측 패널 «상담 내용» 탭. 모양은 히스토리 메일 행과 같다. */
export interface InboxThreadMessage extends TimelineItem { body: string }
export const getInboxThreadMessages = async (businessId: number, threadId: number) =>
  jx<{ thread_id: number; subject: string | null; items: InboxThreadMessage[]; has_more: boolean }>(
    await apiFetch(`/api/sale/${businessId}/inbox/thread/${threadId}/messages`));

export const purgeInboxItem = (businessId: number, kind: 'email_thread', id: number) =>
  apiFetch(`/api/sale/${businessId}/inbox/purge`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, id }),
  }).then(j<{ id: number }>);

/** 묶인 한 줄 안의 스레드(최신순) — 서버 services/saleMailBundle 이 행에 실어 보낸다 */
export interface InboxThreadSummary {
  id: number; title: string | null; at: string | null; direction: string | null; handled: boolean; needs_reply: boolean;
}
/** 상담 한 줄이 가리키는 메일 스레드 전부 (2026-10-23 — 미등록 메일은 사람(주소) 한 줄로 묶인다).
 *  ✕·되돌리기·영구 빼기는 줄 단위라 이 목록 전부에 기존 문을 부른다(새 일괄 문 없음). */
export const inboxThreadIdsOf = (it: SaleInboxItem): number[] => {
  const ids = (it.meta as { thread_ids?: number[] } | undefined)?.thread_ids;
  return it.ref.kind === 'email_thread' && Array.isArray(ids) && ids.length ? ids : [it.ref.id];
};
export async function forEachInboxThread(it: SaleInboxItem, fn: (threadId: number) => Promise<unknown>): Promise<void> {
  let failed = 0;
  for (const id of inboxThreadIdsOf(it)) { try { await fn(id); } catch { failed += 1; } }
  if (failed) throw new Error(`thread_action_failed:${failed}`);   // 삼키지 않는다 — 부르는 쪽이 실패 문구를 띄운다
}

// ─── 상담 메모 = 댓글 (공개범위 그대로) ────────────────────────────────────
//   Irene 2026-09-14: *"메모라는 액션버튼은 그대로 메모를 남기는 역할만 … 댓글처럼 …
//   어떤 문의를 기준으로 저장된건지 남기게."*
//   저장소는 `project_notes` 한 곳이다(채팅방·메일 메모와 같은 표·같은 공개범위).
export type ConsultRefKind = 'email_thread' | 'conversation' | 'client';
export interface SaleNote {
  id: number;
  body: string;
  visibility: 'personal' | 'internal' | 'shared';
  author_user_id: number;
  author_name: string | null;
  created_at: string;
}

export const listConsultNotes = (businessId: number, kind: ConsultRefKind, id: number) =>
  apiFetch(`/api/sale/${businessId}/consults/${kind}/${id}/notes`).then(j<SaleNote[]>);

export const addConsultNote = (
  businessId: number, kind: ConsultRefKind, id: number,
  body: string, visibility: 'internal' | 'personal',
) =>
  apiFetch(`/api/sale/${businessId}/consults/${kind}/${id}/notes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, visibility }),
  }).then(j<SaleNote>);

export const deleteConsultNote = (businessId: number, kind: ConsultRefKind, id: number, noteId: number) =>
  apiFetch(`/api/sale/${businessId}/consults/${kind}/${id}/notes/${noteId}`, { method: 'DELETE' })
    .then(j<{ id: number }>);

/** 단계 목록 — 화면 순서의 단일 원천(서버 ENUM 과 같은 순서) */
export const SALE_STAGES: SaleStage[] = ['none', 'inquiry', 'consulting', 'proposal', 'negotiation', 'won', 'lost'];
export const IN_PROGRESS_STAGES: SaleStage[] = ['inquiry', 'consulting', 'proposal', 'negotiation'];
export const LOST_REASONS: LostReason[] = ['price', 'timing', 'competitor', 'no_response', 'fit', 'other'];
export const SALE_SOURCES: SaleSource[] = ['guest_link', 'email', 'phone', 'referral', 'web', 'event', 'manual', 'other'];
export const INTERACTION_KINDS: InteractionKind[] = ['call', 'meeting', 'visit', 'memo', 'other'];

/**
 * 고객 관리 칸 저장 — 사업자·증빙 · 메모 · 유형 · 계정 없는 고객의 이메일/전화.
 *   저장 문은 PUT /api/clients/:biz/:id 하나다(감사·실시간 방송이 거기 있다). 실패는 던진다 — AutoSaveField 가 ! 를 띄운다.
 */
export async function putClientFields(businessId: number, clientId: number, patch: Record<string, unknown>): Promise<void> {
  const res = await apiFetch(`/api/clients/${businessId}/${clientId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) throw new Error(body?.message || 'save_failed');
}

// ─── 고객 담당자 · 받은 명함 → 고객 (docs/NAME_CARD_V3_STRATEGY.md 9절) ───────────────
export interface ClientContact {
  id: number;
  client_id: number;
  name: string;
  name_en: string | null;
  job_title: string | null;
  department: string | null;
  email: string | null;
  mobile: string | null;
  phone: string | null;
  fax: string | null;
  address: string | null;
  memo: string | null;
  photo_file_id: number | null;
  source: 'manual' | 'name_card' | 'photo' | 'mail' | 'chat';
  sort_order: number;
}
export type ContactField = 'name' | 'name_en' | 'job_title' | 'department' | 'email' | 'mobile' | 'phone' | 'fax' | 'address' | 'memo';

/** 실패는 서버 코드(message)를 던진다 — 화면이 i18n 으로 바꾼다 */
async function jx<T>(r: Response): Promise<T> {
  const body = await r.json().catch(() => null);
  if (!r.ok || !body?.success) throw new Error(body?.message || 'save_failed');
  return body.data as T;
}
const jsonInit = (method: string, data?: unknown): RequestInit => ({
  method, headers: { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data),
});

export const listClientContacts = async (businessId: number, clientId: number) =>
  jx<ClientContact[]>(await apiFetch(`/api/sale/${businessId}/clients/${clientId}/contacts`));
export const createClientContact = async (businessId: number, clientId: number, input: Partial<Record<ContactField, string | null>>) =>
  jx<ClientContact>(await apiFetch(`/api/sale/${businessId}/clients/${clientId}/contacts`, jsonInit('POST', input)));
export const patchClientContact = async (businessId: number, clientId: number, id: number, patch: Partial<Record<ContactField, string | null>>) =>
  jx<ClientContact>(await apiFetch(`/api/sale/${businessId}/clients/${clientId}/contacts/${id}`, jsonInit('PATCH', patch)));
export const deleteClientContact = async (businessId: number, clientId: number, id: number) =>
  jx<{ id: number }>(await apiFetch(`/api/sale/${businessId}/clients/${clientId}/contacts/${id}`, { method: 'DELETE' }));
export const makeContactBilling = async (businessId: number, clientId: number, id: number) =>
  jx<Record<string, string | null>>(await apiFetch(`/api/sale/${businessId}/clients/${clientId}/contacts/${id}/make-billing`, { method: 'POST' }));

/** 받은 명함 → 고객: 들이기 전 판정 */
export interface CardIntake {
  values: {
    name: string | null; name_en: string | null; job_title: string | null; department: string | null; company: string | null;
    email: string | null; mobile: string | null; phone: string | null; fax: string | null; address: string | null;
  };
  /** 이 워크스페이스 멤버의 명함 — 고객으로 넣지 않는다 */
  colleague: boolean;
  /** 이메일·전화가 같은 기존 고객 */
  match: { id: number; name: string | null; suggested_role: 'primary' | 'extra' } | null;
}
export const getCardIntake = async (businessId: number, savedCardId: number) =>
  jx<CardIntake>(await apiFetch(`/api/sale/${businessId}/card-intake/${savedCardId}`));
export const attachCardToClient = async (businessId: number, clientId: number, savedCardId: number) =>
  jx<{ role: 'primary' | 'extra' }>(await apiFetch(`/api/sale/${businessId}/clients/${clientId}/attach-card`, jsonInit('POST', { saved_card_id: savedCardId })));

// ─── 메일 서명 읽기 (2026-10-22) — 메일 «고객으로 저장» 이 연 고객 추가 폼을 채운다(저장 없음)
export interface MailSignatureRead {
  values: CardIntake['values'];
  found: boolean;
  match: { id: number; name: string | null } | null;
}
export const readMailSignature = async (businessId: number, threadId: number, email: string, name?: string | null) =>
  jx<MailSignatureRead>(await apiFetch(`/api/sale/${businessId}/mail-signature-read`,
    jsonInit('POST', { email_thread_id: threadId, email, name: name || null })));

// ─── 명함 사진 읽기 (docs/NAME_CARD_V3_STRATEGY.md 9절 결정 3) ───────────────
export interface CardPhotoRead {
  values: CardIntake['values'] & { website: string | null };
  found: boolean;
  match: CardIntake['match'];
}
export async function readCardPhoto(businessId: number, file: File): Promise<CardPhotoRead> {
  const fd = new FormData();
  fd.append('file', file);
  return jx<CardPhotoRead>(await apiUpload(`/api/sale/${businessId}/card-read`, fd));
}
export async function saveCardPhoto(businessId: number, clientId: number, file: File, contactId?: number | null): Promise<{ file_id: number }> {
  const fd = new FormData();
  fd.append('file', file);
  if (contactId) fd.append('contact_id', String(contactId));
  return jx<{ file_id: number }>(await apiUpload(`/api/sale/${businessId}/clients/${clientId}/card-photo`, fd));
}
/** 사진에서 읽고 사람이 확인한 값을 기존 고객에 붙인다(대표 칸이 비면 채우고, 아니면 담당자 추가) */
export const attachValuesToClient = async (businessId: number, clientId: number, values: Partial<CardIntake['values']>) =>
  jx<{ role: 'primary' | 'extra'; contact?: ClientContact }>(await apiFetch(`/api/sale/${businessId}/clients/${clientId}/attach-card`, jsonInit('POST', { values })));
