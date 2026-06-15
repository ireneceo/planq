// Q Bill 청구서 API 클라이언트
import { apiFetch } from '../contexts/AuthContext';

// ─── 타입 ───
export type InvoiceStatus = 'draft' | 'sent' | 'partially_paid' | 'paid' | 'overdue' | 'canceled';
export type InstallmentMode = 'single' | 'split';
export type InstallmentStatus = 'pending' | 'sent' | 'paid' | 'overdue' | 'canceled';
export type TaxInvoiceStatus = 'none' | 'pending' | 'issued' | 'failed' | 'canceled';
export type Currency = 'KRW' | 'USD' | 'EUR';

export interface ApiInvoiceItem {
  id: number;
  description: string;
  detail?: string | null;
  quantity: number;
  unit_price: number;
  amount: number;
  sort_order: number;
}

export interface ApiInstallment {
  id: number;
  invoice_id: number;
  installment_no: number;
  label: string;
  percent: number;
  amount: number;
  due_date: string | null;
  status: InstallmentStatus;
  paid_at: string | null;
  paid_amount: number;
  payer_memo: string | null;
  notify_paid_at: string | null;
  notify_payer_name: string | null;
  tax_invoice_no: string | null;
  tax_invoice_at: string | null;
  cash_receipt_no: string | null;
  cash_receipt_at: string | null;
  milestone_ref: string | null;
}

export interface ApiSourcePost {
  id: number;
  category: string | null;
  title: string;
  status: 'draft' | 'published';
  share_token: string | null;
  project_id: number | null;
  shared_at: string | null;
}

export interface ApiClient {
  id: number;
  display_name: string | null;
  company_name: string | null;
  biz_name: string | null;
  biz_tax_id: string | null;
  biz_ceo: string | null;
  biz_address: string | null;
  biz_address_en: string | null;
  biz_type: string | null;
  biz_item: string | null;
  is_business: boolean;
  country: string | null;
  tax_invoice_email: string | null;
  billing_contact_email: string | null;
  invite_email: string | null;
}

export interface ApiInvoice {
  id: number;
  business_id: number;
  client_id: number | null;
  invoice_number: string;
  title: string;
  status: InvoiceStatus;
  installment_mode: InstallmentMode;
  currency: Currency;
  issued_at: string | null;
  due_date: string | null;
  sent_at: string | null;
  paid_at: string | null;
  total_amount: string | number;
  subtotal: string | number | null;
  vat_rate: string | number;
  tax_amount: string | number;
  grand_total: string | number;
  paid_amount: string | number;
  notes: string | null;
  share_token: string | null;
  viewed_at: string | null;
  notify_paid_at: string | null;
  notify_payer_name: string | null;
  meta: { last_reminder_at?: string; reminder_count?: number; last_overdue_notify_stage?: string } | null;
  source_post_id: number | null;
  project_id: number | null;
  bank_snapshot: { bank_name?: string; account_number?: string; account_holder?: string } | null;
  recipient_email: string | null;
  recipient_business_name: string | null;
  recipient_business_number: string | null;
  tax_invoice_status: TaxInvoiceStatus;
  tax_invoice_external_id: string | null;
  tax_invoice_url: string | null;
  tax_invoice_issued_at: string | null;
  // 결제수단 · 증빙 (2026-06-13)
  payment_method?: 'bank_transfer' | 'card' | 'other';
  receipt_type?: 'none' | 'tax_invoice' | 'cash_receipt';
  receipt_profile?: {
    biz_type?: 'business' | 'individual';
    biz_name?: string | null; biz_tax_id?: string | null; biz_ceo?: string | null;
    biz_category?: string | null; biz_item?: string | null; biz_address?: string | null; tax_email?: string | null;
    cr_purpose?: 'income_deduction' | 'expense_proof'; cr_identifier?: string | null;
    requested_by_name?: string | null;
  } | null;
  receipt_requested_at?: string | null;
  cash_receipt_status?: 'none' | 'pending' | 'issued' | 'failed' | 'canceled';
  cash_receipt_no?: string | null;
  cash_receipt_issued_at?: string | null;
  created_by: number;
  created_at: string;
  updated_at: string;
  // Includes
  Client?: ApiClient | null;
  client?: ApiClient | null;
  items?: ApiInvoiceItem[];
  installments?: ApiInstallment[];
  sourcePost?: ApiSourcePost | null;
  creator?: { id: number; name: string } | null;
}

export interface ApiConvFound {
  conversation: { id: number; title: string | null; project_id: number | null; last_message_at: string | null } | null;
  suggest_create: boolean;
}

export interface CreateInvoicePayload {
  title: string;
  client_id?: number | null;
  source_post_id?: number | null;
  project_id?: number | null;
  currency?: Currency;
  vat_rate?: number;
  due_date?: string | null;
  recipient_email?: string | null;
  recipient_business_name?: string | null;
  recipient_business_number?: string | null;
  receipt_type?: 'none' | 'tax_invoice' | 'cash_receipt';
  notes?: string | null;
  installment_mode?: InstallmentMode;
  installments?: { label: string; percent: number; due_date?: string | null; milestone_ref?: string | null }[];
  items: { description: string; detail?: string | null; quantity: number; unit_price: number }[];
}

export interface SendInvoicePayload {
  send_chat?: boolean;
  send_email?: boolean;
  message?: string;
}

export interface SendInvoiceResult {
  invoice: ApiInvoice;
  deliver: {
    chat?: { conversation_id: number; message_id: number } | { error: string } | null;
    email?: { to: string; sent: boolean } | { error: string } | null;
  };
}

// ─── 헬퍼 ───
async function expectOk<T>(r: Response): Promise<T> {
  const json = await r.json();
  if (!r.ok || json?.success === false) {
    throw new Error(json?.message || `HTTP ${r.status}`);
  }
  return json.data as T;
}

// ─── API ───
export async function listInvoices(businessId: number, opts: { status?: InvoiceStatus } = {}): Promise<ApiInvoice[]> {
  const params = new URLSearchParams();
  if (opts.status) params.set('status', opts.status);
  const qs = params.toString() ? `?${params}` : '';
  const r = await apiFetch(`/api/invoices/${businessId}${qs}`);
  return expectOk<ApiInvoice[]>(r);
}

export async function getInvoice(businessId: number, invoiceId: number): Promise<ApiInvoice> {
  const r = await apiFetch(`/api/invoices/${businessId}/${invoiceId}`);
  return expectOk<ApiInvoice>(r);
}

export async function createInvoice(businessId: number, payload: CreateInvoicePayload): Promise<ApiInvoice> {
  const r = await apiFetch(`/api/invoices/${businessId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return expectOk<ApiInvoice>(r);
}

// draft / canceled 상태만 삭제 가능 (백엔드 정책)
export async function deleteInvoice(businessId: number, invoiceId: number): Promise<void> {
  const r = await apiFetch(`/api/invoices/${businessId}/${invoiceId}`, { method: 'DELETE' });
  await expectOk(r);
}

export async function sendInvoice(businessId: number, invoiceId: number, opts: SendInvoicePayload = {}): Promise<SendInvoiceResult> {
  const r = await apiFetch(`/api/invoices/${businessId}/${invoiceId}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
  return expectOk<SendInvoiceResult>(r);
}

export async function markInstallmentPaid(
  businessId: number, invoiceId: number, installmentId: number,
  payload: { paid_at?: string; paid_amount?: number; payer_memo?: string } = {}
): Promise<ApiInvoice> {
  const r = await apiFetch(`/api/invoices/${businessId}/${invoiceId}/installments/${installmentId}/mark-paid`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return expectOk<ApiInvoice>(r);
}

export async function unmarkInstallmentPaid(
  businessId: number, invoiceId: number, installmentId: number
): Promise<ApiInvoice> {
  const r = await apiFetch(`/api/invoices/${businessId}/${invoiceId}/installments/${installmentId}/unmark-paid`, {
    method: 'POST',
  });
  return expectOk<ApiInvoice>(r);
}

export async function markInstallmentTaxInvoice(
  businessId: number, invoiceId: number, installmentId: number,
  payload: { tax_invoice_no: string; issued_at?: string }
): Promise<ApiInstallment> {
  const r = await apiFetch(`/api/invoices/${businessId}/${invoiceId}/installments/${installmentId}/mark-tax-invoice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return expectOk<ApiInstallment>(r);
}

// 회차별 현금영수증 발행 마킹 (분할 결제 — 회차마다 입금 시점 발급)
export async function markInstallmentCashReceipt(
  businessId: number, invoiceId: number, installmentId: number,
  payload: { cash_receipt_no: string; cash_receipt_at?: string }
): Promise<ApiInstallment> {
  const r = await apiFetch(`/api/invoices/${businessId}/${invoiceId}/installments/${installmentId}/mark-cash-receipt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return expectOk<ApiInstallment>(r);
}

// 단건 청구서 증빙 발행 마킹 (분할 아님) — 세금계산서 / 현금영수증
export async function markInvoiceTaxInvoice(
  businessId: number, invoiceId: number,
  payload: { tax_invoice_no: string; tax_invoice_at?: string }
): Promise<ApiInvoice> {
  const r = await apiFetch(`/api/invoices/${businessId}/${invoiceId}/mark-tax-invoice`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  return expectOk<ApiInvoice>(r);
}

export async function markInvoiceCashReceipt(
  businessId: number, invoiceId: number,
  payload: { cash_receipt_no: string; cash_receipt_at?: string }
): Promise<ApiInvoice> {
  const r = await apiFetch(`/api/invoices/${businessId}/${invoiceId}/mark-cash-receipt`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  return expectOk<ApiInvoice>(r);
}

// 증빙 발행 의무 큐 — 백엔드 단일 진실 원천 (services/receiptsDue)
export interface ReceiptDueRow {
  invoice_id: number;
  business_id: number;
  project_id: number | null;
  invoice_number: string;
  currency: Currency;
  kind: 'tax' | 'cash';
  recipient_name: string | null;
  tax_id: string | null;
  receipt_requested_at: string | null;
  installment_id: number | null;
  installment_no: number | null;
  installment_label: string | null;
  amount: number;
  paid_at: string | null;
  status: 'pending' | 'issued';
  issued_no: string | null;
  issued_at: string | null;
  due_at: string | null;
  due_kind: 'legal' | 'recommended';
  urgency: 'overdue' | 'soon' | 'normal' | 'done' | 'correction_pending';
  // 정정(수정세금계산서/취소) 유효상태 — RECEIPT_CORRECTION_DESIGN
  effective?: 'pending' | 'issued' | 'corrected' | 'amended' | 'canceled' | 'correction_pending';
  correction?: { reason: CorrectionReason; corrected_no: string; written_at: string | null; amount_delta: number | null } | null;
}

export type CorrectionReason = 'clerical' | 'amount_change' | 'return' | 'cancel' | 'duplicate' | 'other';

export interface CorrectionPayload {
  kind: 'tax' | 'cash';
  reason: CorrectionReason;
  corrected_no: string;
  written_at?: string;
  amount_delta?: number | null;
  customer_note?: string;
}

export async function listReceiptsDue(businessId: number): Promise<ReceiptDueRow[]> {
  const r = await apiFetch(`/api/invoices/${businessId}/receipts-due`);
  return expectOk<ReceiptDueRow[]>(r);
}

export interface ApiReceiptCorrection {
  id: number;
  invoice_id: number;
  installment_id: number | null;
  kind: 'tax' | 'cash';
  reason: CorrectionReason;
  original_no: string | null;
  corrected_no: string;
  written_at: string | null;
  amount_delta: string | number | null;
  currency: Currency;
  customer_note: string | null;
  created_at: string;
}

export async function listInvoiceCorrections(businessId: number, invoiceId: number): Promise<ApiReceiptCorrection[]> {
  const r = await apiFetch(`/api/invoices/${businessId}/${invoiceId}/corrections`);
  return expectOk<ApiReceiptCorrection[]>(r);
}

// 증빙 수정·취소 마킹 (수정세금계산서 발행 / 현금영수증 취소)
export async function markReceiptCorrection(
  businessId: number, invoiceId: number, installmentId: number | null, payload: CorrectionPayload,
): Promise<void> {
  const path = installmentId
    ? `/api/invoices/${businessId}/${invoiceId}/installments/${installmentId}/corrections`
    : `/api/invoices/${businessId}/${invoiceId}/corrections`;
  const r = await apiFetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  await expectOk(r);
}

// 청구서 PDF 다운로드 (멤버) — 인증 blob fetch. authenticateToken 은 Authorization 헤더만 받아
//   window.open 으로는 401 (헤더 미전달). 그래서 blob 방식 필수.
export async function downloadInvoicePdf(businessId: number, invoiceId: number, filename: string): Promise<void> {
  const r = await apiFetch(`/api/invoices/${businessId}/${invoiceId}/pdf`);
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { const j = await r.json(); msg = j.message || msg; } catch { /* binary */ }
    throw new Error(msg);
  }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename || 'invoice'}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function cancelInstallment(
  businessId: number, invoiceId: number, installmentId: number
): Promise<{ canceled: true }> {
  const r = await apiFetch(`/api/invoices/${businessId}/${invoiceId}/installments/${installmentId}`, {
    method: 'DELETE',
  });
  return expectOk<{ canceled: true }>(r);
}

export async function updateInvoiceStatus(
  businessId: number, invoiceId: number, status: InvoiceStatus
): Promise<ApiInvoice> {
  const r = await apiFetch(`/api/invoices/${businessId}/${invoiceId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  return expectOk<ApiInvoice>(r);
}

export interface SendReminderResult {
  sent: true;
  last_reminder_at: string;
  reminder_count: number;
}

export async function sendInvoiceReminder(
  businessId: number, invoiceId: number, message?: string
): Promise<SendReminderResult> {
  const r = await apiFetch(`/api/invoices/${businessId}/${invoiceId}/send-reminder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message ? { message } : {}),
  });
  return expectOk<SendReminderResult>(r);
}

export async function listSourceCandidates(
  businessId: number, opts: { category?: string; client_id?: number } = {}
): Promise<ApiSourcePost[]> {
  const params = new URLSearchParams();
  if (opts.category) params.set('category', opts.category);
  if (opts.client_id) params.set('client_id', String(opts.client_id));
  const qs = params.toString() ? `?${params}` : '';
  const r = await apiFetch(`/api/invoices/${businessId}/source-candidates${qs}`);
  return expectOk<ApiSourcePost[]>(r);
}

// 청구서 발행용 클라이언트 목록 (사업자 정보 포함)
export interface ApiClientLite {
  id: number;
  user_id: number | null;   // 초대 수락 전(invited)에는 null — 프로젝트 contact_user_id 매칭용
  status?: 'invited' | 'active' | 'archived';
  display_name: string | null;
  company_name: string | null;
  biz_name: string | null;
  biz_tax_id: string | null;
  biz_ceo: string | null;
  biz_address: string | null;
  biz_address_en: string | null;
  is_business: boolean;
  country: string | null;
  tax_invoice_email: string | null;
  billing_contact_email: string | null;
  invite_email: string | null;
}

export async function listClientsForBilling(businessId: number): Promise<ApiClientLite[]> {
  const r = await apiFetch(`/api/clients/${businessId}`);
  const json = await r.json();
  if (!r.ok || json?.success === false) throw new Error(json?.message || `HTTP ${r.status}`);
  return (json.data as ApiClientLite[]) || [];
}

// 워크스페이스 (발신자) 정보
export interface ApiBusinessInfo {
  id: number;
  name: string | null;
  legal_name: string | null;
  tax_id: string | null;
  representative: string | null;
  address: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_name: string | null;
  // 해외 송금용 (외화 청구서 공개 결제 페이지 노출)
  swift_code: string | null;
  bank_name_en: string | null;
  bank_account_name_en: string | null;
  default_due_days: number | null;
  default_vat_rate: string | number | null;
  default_currency: string | null;
  // 정기 청구 기본값 + 연체 정책
  auto_invoice_default_mode?: 'auto' | 'draft_review' | null;
  auto_invoice_default_billing_day?: number | null;
  overdue_grace_days?: number | null;
}

export async function getBusinessInfo(businessId: number): Promise<ApiBusinessInfo> {
  const r = await apiFetch(`/api/businesses/${businessId}`);
  const json = await r.json();
  if (!r.ok || json?.success === false) throw new Error(json?.message || `HTTP ${r.status}`);
  return json.data as ApiBusinessInfo;
}

export interface BillingPatch {
  bank_name?: string | null;
  bank_account_number?: string | null;
  bank_account_name?: string | null;
  swift_code?: string | null;
  bank_name_en?: string | null;
  bank_account_name_en?: string | null;
  default_due_days?: number;
  default_vat_rate?: number;
  default_currency?: string;
  auto_invoice_default_mode?: 'auto' | 'draft_review';
  auto_invoice_default_billing_day?: number;
  overdue_grace_days?: number;
}

export async function updateBusinessBilling(businessId: number, patch: BillingPatch): Promise<ApiBusinessInfo> {
  const r = await apiFetch(`/api/businesses/${businessId}/billing`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const json = await r.json();
  if (!r.ok || json?.success === false) throw new Error(json?.message || `HTTP ${r.status}`);
  return json.data as ApiBusinessInfo;
}

export async function findConversationForClient(
  businessId: number, clientId: number, projectId?: number | null
): Promise<ApiConvFound> {
  const params = new URLSearchParams();
  params.set('client_id', String(clientId));
  if (projectId) params.set('project_id', String(projectId));
  const r = await apiFetch(`/api/invoices/${businessId}/find-conversation?${params}`);
  return expectOk<ApiConvFound>(r);
}

// 색상 헬퍼 (COLOR_GUIDE 토큰)
export function invoiceStatusColor(status: InvoiceStatus): { bg: string; fg: string; dot: string } {
  switch (status) {
    case 'draft':           return { bg: '#F1F5F9', fg: '#475569', dot: '#94A3B8' };
    case 'sent':            return { bg: '#E0F2FE', fg: '#0369A1', dot: '#0EA5E9' };
    case 'partially_paid':  return { bg: '#FEF3C7', fg: '#92400E', dot: '#F59E0B' };
    case 'paid':            return { bg: '#DCFCE7', fg: '#166534', dot: '#22C55E' };
    case 'overdue':         return { bg: '#FEE2E2', fg: '#991B1B', dot: '#DC2626' };
    case 'canceled':        return { bg: '#F1F5F9', fg: '#94A3B8', dot: '#94A3B8' };
    default:                return { bg: '#F1F5F9', fg: '#64748B', dot: '#94A3B8' };
  }
}

export function installmentStatusColor(status: InstallmentStatus): { bg: string; fg: string; dot: string } {
  switch (status) {
    case 'pending': return { bg: '#F1F5F9', fg: '#64748B', dot: '#CBD5E1' };
    case 'sent':    return { bg: '#E0F2FE', fg: '#0369A1', dot: '#0EA5E9' };
    case 'paid':    return { bg: '#DCFCE7', fg: '#166534', dot: '#22C55E' };
    case 'overdue': return { bg: '#FEE2E2', fg: '#991B1B', dot: '#DC2626' };
    case 'canceled':return { bg: '#F1F5F9', fg: '#94A3B8', dot: '#94A3B8' };
    default:        return { bg: '#F1F5F9', fg: '#64748B', dot: '#94A3B8' };
  }
}

export function countByStatus(list: ApiInvoice[]): Record<InvoiceStatus | 'all', number> {
  const acc: Record<string, number> = { all: list.length };
  for (const i of list) acc[i.status] = (acc[i.status] || 0) + 1;
  return acc as Record<InvoiceStatus | 'all', number>;
}

// 헬퍼: 금액 포맷
export function formatMoney(amount: number | string | null | undefined, currency: Currency = 'KRW'): string {
  const n = typeof amount === 'string' ? parseFloat(amount) : (amount || 0);
  if (currency === 'KRW') return `${n.toLocaleString('ko-KR')}원`;
  if (currency === 'USD') return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  return `${currency} ${n.toLocaleString('en-US')}`;
}

// 헬퍼: invoice 누락 사업자 정보 검사
export function missingClientBizFields(client: ApiClient | null | undefined): string[] {
  if (!client || !client.is_business) return [];
  const m: string[] = [];
  if (!client.biz_name) m.push('biz_name');
  if (!client.biz_tax_id) m.push('biz_tax_id');
  if (!client.biz_ceo) m.push('biz_ceo');
  if (!client.biz_address && !client.biz_address_en) m.push('biz_address');
  return m;
}
