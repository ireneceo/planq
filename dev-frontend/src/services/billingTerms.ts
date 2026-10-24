// 문서 «청구 조건» — 서명이 끝나면 이대로 청구서 초안이 만들어진다 (2026-10-23, docs/CONTRACT_AUTO_INVOICE_DESIGN.md)
//   서버 routes/post_billing_terms.js · 계산 services/contractBilling(청구서와 같은 함수).
import { apiFetch } from '../contexts/AuthContext';
import type { Currency } from './invoices';

export interface BillingTermsItemInput { description: string; detail?: string | null; quantity: number; unit_price: number; }
export interface BillingTermsInstallmentInput { label: string; percent: number; due_date?: string | null; milestone_ref?: string | null; }

export interface BillingTermsInput {
  client_id: number | null;
  title?: string | null;
  currency: Currency;
  vat_rate: number;
  tax_mode?: 'exclusive' | 'inclusive';   // 금액 기준 (2026-10-24)
  receipt_type: 'none' | 'tax_invoice';
  items: BillingTermsItemInput[];
  installment_mode: 'single' | 'split';
  installments?: BillingTermsInstallmentInput[];
  notes?: string | null;
}

export interface BillingTerms {
  id: number;
  client_id: number | null;
  title: string | null;
  currency: Currency;
  vat_rate: number;
  tax_mode?: 'exclusive' | 'inclusive';   // 금액 기준 (2026-10-24)
  receipt_type: 'none' | 'tax_invoice';
  installment_mode: 'single' | 'split';
  notes: string | null;
  raw_items: BillingTermsItemInput[];
  raw_installments: BillingTermsInstallmentInput[];
  items: { description: string; detail: string | null; quantity: number; unit_price: number; amount: number }[];
  subtotal: number;
  tax_amount: number;
  grand_total: number;
  installments: { label: string; percent: number; amount: number; due_date: string | null; milestone_ref: string | null }[];
  invoice_id: number | null;
  auto_error: string | null;
  auto_attempted_at: string | null;
}

export interface BillingTermsState {
  post_id: number;
  terms: BillingTerms | null;
  invoice: { id: number; invoice_number: string; status: string; grand_total: string | number; currency: Currency } | null;
  /** 만든 초안을 Q bill 에서 지웠다 — 다시 자동으로 만들지 않는다(문서당 1건). 화면은 «청구서 만들기» 로 잇는다 */
  invoice_deleted?: boolean;
  locked: boolean;
  fully_signed: boolean;
  payroll_contract: boolean;
  can_edit: boolean;
  can_create_invoice: boolean;
}

/** 서명 화면(공개)에 보이는 모양 — 고객·메모 없음 */
export interface PublicBillingTerms {
  currency: Currency;
  vat_rate: number;
  tax_mode?: 'exclusive' | 'inclusive';   // 금액 기준 (2026-10-24)
  installment_mode: 'single' | 'split';
  items: { description: string; detail: string | null; quantity: number; unit_price: number; amount: number }[];
  subtotal: number;
  tax_amount: number;
  grand_total: number;
  installments: { label: string; percent: number; amount: number; due_date: string | null; milestone_ref: string | null }[];
}

/** 403(Q bill 권한 없음·고객) = null — 화면은 칸을 그리지 않는다. 그 밖의 실패는 던진다. */
export async function getBillingTerms(postId: number): Promise<BillingTermsState | null> {
  const r = await apiFetch(`/api/posts/${postId}/billing-terms`);
  if (r.status === 403 || r.status === 404) return null;
  const j = await r.json();
  if (!r.ok || j?.success === false) throw new Error(j?.code || j?.message || `HTTP ${r.status}`);
  return j.data as BillingTermsState;
}

async function okState(r: Response): Promise<BillingTermsState> {
  const j = await r.json();
  if (!r.ok || j?.success === false) throw new Error(j?.code || j?.message || `HTTP ${r.status}`);
  return j.data as BillingTermsState;
}

export async function saveBillingTerms(postId: number, input: BillingTermsInput): Promise<BillingTermsState> {
  return okState(await apiFetch(`/api/posts/${postId}/billing-terms`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }));
}

export async function deleteBillingTerms(postId: number): Promise<BillingTermsState> {
  return okState(await apiFetch(`/api/posts/${postId}/billing-terms`, { method: 'DELETE' }));
}

/** 자동 생성이 실패했을 때 지금 다시 */
export async function createInvoiceFromTerms(postId: number): Promise<BillingTermsState> {
  return okState(await apiFetch(`/api/posts/${postId}/billing-terms/create-invoice`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
}
