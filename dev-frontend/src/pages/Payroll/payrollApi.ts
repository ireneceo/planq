// 급여·계약 API 호출 모음 — 화면은 이 함수만 쓴다(서버 routes/payroll.js · docs/PAYROLL_DESIGN.md).
//   ★ apiFetch 는 throw 하지 않는다 — 여기서 res.ok/success 를 보고 실패를 던진다(AutoSaveField 가 ! 뱃지를 띄우게).
import { apiFetch, apiUpload } from '../../contexts/AuthContext';

export type ContractKind = 'regular' | 'fixed_term' | 'freelance';
export type ContractStatus = 'draft' | 'active' | 'ended' | 'superseded';
export type IncomeKind = 'employment' | 'business' | 'other';

export interface PayItemLite { id: number; code: string; name: string; name_en: string | null; side: 'earning' | 'deduction'; taxable: boolean }
export interface ContractLine { id: number; pay_item_id: number; amount: number; item: PayItemLite | null }
export interface Contract {
  id: number; person_id: number; kind: ContractKind; start_date: string; end_date: string | null;
  weekly_work_days: number | null; daily_work_hours: number | string | null; currency: string; pay_day: number | null;
  post_id: number | null; signed_at: string | null; status: ContractStatus; note: string | null;
  lines: ContractLine[]; monthly_total: number;
}
export interface PersonSummary {
  id: number; user_id: number | null; display_name: string; employee_no: string | null; email: string | null;
  income_kind: IncomeKind; hired_on: string | null; left_on: string | null; job_title: string | null;
  bank_name: string | null; has_bank_account: boolean; status: 'active' | 'left'; note: string | null;
  current_contract?: { id: number; kind: ContractKind; start_date: string; end_date: string | null; currency: string; signed: boolean; monthly_total: number } | null;
}
export interface PersonDetail extends PersonSummary { contracts: Contract[] }
export interface Candidate { user_id: number; name: string; email: string | null; job_title: string | null }

// ── P2 항목 ─────────────────────────────────────────────
export type ItemCalc = 'fixed' | 'rate' | 'manual' | 'external' | 'unpaid_leave';
export type AppliesTo = 'all' | 'employment' | 'business' | 'other';
export interface PayItem {
  id: number; code: string; name: string; name_en: string | null; side: 'earning' | 'deduction'; applies_to: AppliesTo;
  taxable: boolean; calc: ItemCalc; rate: number | null; rate_base: 'taxable_total' | 'gross_total' | 'item' | null; base_item_id: number | null;
  sign: 'plus' | 'minus'; in_total: boolean; is_settlement: boolean; is_statutory: boolean;
  rounding: 'round' | 'floor' | 'ceil'; rounding_unit: number; aliases: string[]; sort_order: number; is_active: boolean;
  preset_source: string | null; used_count?: number;
}
export interface PresetSummary { key: string; label: { ko: string; en: string }; country: string | null; count: number }
export interface PresetItem extends Partial<PayItem> { code: string; name: string; exists?: boolean }
export interface SuggestedItem { name: string; name_en: string | null; side: 'earning' | 'deduction'; taxable: boolean; calc: ItemCalc; sign: 'plus' | 'minus'; applies_to: AppliesTo; is_statutory: boolean; aliases: string[] }

// ── P2~P4 회차 ──────────────────────────────────────────
export type RunStatus = 'draft' | 'reconciling' | 'confirmed' | 'paid';
export interface Run {
  id: number; period_ym: string; seq: number; kind: 'regular' | 'adjustment'; pay_date: string | null; status: RunStatus;
  headcount: number; gross_total: number | null; deduction_total: number | null; net_total: number | null;
  totals_by_currency: Record<string, { headcount: number; gross_total: number | null; deduction_total: number | null; net_total: number | null }> | null;
  transfer_task_mode: 'per_person' | 'single'; transfer_assignee_id: number | null; adjusts_run_id: number | null;
  confirmed_at: string | null; paid_at: string | null; statement_imported_at: string | null; note: string | null;
}
export type FinalSource = 'draft' | 'statement' | 'manual' | null;
export interface RunLine { id: number; pay_item_id: number; name: string; draft_amount: number | null; statement_amount: number | null; final_amount: number | null; final_source: FinalSource; note: string | null }
export interface RunEntry {
  id: number; person_id: number; contract_id: number | null; user_linked: boolean; income_kind: IncomeKind | null;
  display_name: string; employee_no: string | null; job_title: string | null; department_name: string | null; currency: string;
  unpaid_leave_days: number | null; unpaid_leave_source: 'leave' | 'manual' | null;
  gross_total: number | null; taxable_total: number | null; nontaxable_total: number | null; deduction_total: number | null; net_total: number | null;
  bank_name: string | null; bank_last4: string | null; statement_matched: boolean;
  statement_warnings: { code: string; statement: number; recomputed: number }[];
  transfer_task_id: number | null; transfer_task_status: string | null; payslip_viewed_at: string | null; note: string | null;
  lines: RunLine[];
}
export interface RunItem { id: number; code: string; name: string; name_en: string | null; side: 'earning' | 'deduction'; calc: ItemCalc; taxable: boolean; sign: 'plus' | 'minus'; in_total: boolean; is_statutory: boolean; is_settlement: boolean; sort_order: number }
export interface StatementSummary {
  source: 'xlsx' | 'csv' | 'pdf'; file_name: string; sheet: string | null; imported_at: string; dropped_secret_columns: number;
  columns: { key: string; header: string; role: string; item_id: number | null; decided: boolean }[];
  rows: { idx: number; name: string; employee_no: string | null; person_id: number | null; match: 'emp_no' | 'name' | 'manual' | 'ambiguous' | 'skipped' | null; meta: Record<string, string> }[];
  warnings: { row: number; header: string; code: string }[];
}
export interface RunDetail {
  run: Run; locked: boolean; items: RunItem[]; entries: RunEntry[]; statement: StatementSummary | null;
  history: { from: string | null; to: string; at: string; by: number | null; by_name: string | null; note: string | null }[];
  siblings: { id: number; seq: number; kind: 'regular' | 'adjustment'; status: RunStatus }[];
  open_transfer_tasks: number;
}

// ── P4 본인 명세서·계약 ─────────────────────────────────
export interface MyContract { id: number; kind: ContractKind; status: ContractStatus; start_date: string; end_date: string | null; currency: string; pay_day: number | null; weekly_work_days: number | null; daily_work_hours: number | null; signed: boolean; post_id: number | null; lines: { name: string; name_en: string | null; side: 'earning' | 'deduction'; amount: number }[] }
export interface PayslipSummary { entry_id: number; period_ym: string; seq: number; kind: 'regular' | 'adjustment'; status: RunStatus; pay_date: string | null; currency: string; gross_total: number | null; deduction_total: number | null; net_total: number | null; viewed: boolean }
export interface PayslipLine { name: string; name_en: string | null; amount: number; side: 'earning' | 'deduction'; taxable: boolean; sign: 'plus' | 'minus'; in_total: boolean; source: FinalSource; statutory: boolean }
export interface Payslip {
  run: { id: number; period_ym: string; seq: number; kind: 'regular' | 'adjustment'; status: RunStatus; pay_date: string | null; confirmed_at: string | null };
  entry: { id: number; display_name: string; employee_no: string | null; job_title: string | null; department_name: string | null; currency: string; gross_total: number | null; taxable_total: number | null; nontaxable_total: number | null; deduction_total: number | null; net_total: number | null; unpaid_leave_days: number | null; bank_name: string | null; bank_last4: string | null };
  business: { id: number; name: string };
  earnings: PayslipLine[]; deductions: PayslipLine[];
}

export class PayrollError extends Error {
  code: string;
  data?: unknown;
  constructor(code: string, data?: unknown) { super(code); this.code = code; this.data = data; }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await apiFetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let j: { success?: boolean; data?: T; message?: string } | null = null;
  try { j = await r.json(); } catch { /* 빈 응답 */ }
  if (!r.ok || !j?.success) throw new PayrollError(j?.message || `http_${r.status}`, j?.data);
  return j.data as T;
}

/** 파일 내려받기(PDF·CSV) — 인증 헤더가 필요해 <a href> 로는 못 연다. 받은 바이트를 저장 창으로 넘긴다. */
async function download(path: string, fallbackName: string): Promise<void> {
  const r = await apiFetch(path, { method: 'GET' });
  if (!r.ok) {
    let code = `http_${r.status}`;
    try { const j = await r.json(); code = j?.message || code; } catch { /* 바이너리 */ }
    throw new PayrollError(code);
  }
  const blob = await r.blob();
  const cd = r.headers.get('Content-Disposition') || '';
  const name = (cd.match(/filename="([^"]+)"/) || [])[1] || fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** 대장 올리기 — multipart(공용 apiUpload — 워크스페이스 헤더·토큰 갱신 같은 규칙). */
async function upload<T>(path: string, file: File): Promise<T> {
  const fd = new FormData();
  fd.append('file', file);
  const r = await apiUpload(path, fd);
  let j: { success?: boolean; data?: T; message?: string } | null = null;
  try { j = await r.json(); } catch { /* 빈 응답 */ }
  if (!r.ok || !j?.success) throw new PayrollError(j?.message || `http_${r.status}`, j?.data);
  return j.data as T;
}

const base = (biz: number) => `/api/payroll/${biz}`;
export const payrollApi = {
  people: (biz: number, q?: { status?: string; q?: string }) => {
    const sp = new URLSearchParams();
    if (q?.status) sp.set('status', q.status);
    if (q?.q) sp.set('q', q.q);
    return req<PersonSummary[]>('GET', `${base(biz)}/people${sp.toString() ? `?${sp}` : ''}`);
  },
  person: (biz: number, id: number) => req<PersonDetail>('GET', `${base(biz)}/people/${id}`),
  candidates: (biz: number) => req<Candidate[]>('GET', `${base(biz)}/candidates`),
  createPerson: (biz: number, body: Record<string, unknown>) => req<PersonSummary>('POST', `${base(biz)}/people`, body),
  updatePerson: (biz: number, id: number, body: Record<string, unknown>) => req<PersonSummary>('PUT', `${base(biz)}/people/${id}`, body),
  deletePerson: (biz: number, id: number) => req<{ id: number }>('DELETE', `${base(biz)}/people/${id}`),
  bankAccount: (biz: number, id: number) => req<{ bank_name: string | null; number: string | null; holder: string | null }>('GET', `${base(biz)}/people/${id}/bank-account`),
  createContract: (biz: number, personId: number, body: Record<string, unknown>) => req<Contract>('POST', `${base(biz)}/people/${personId}/contracts`, body),
  updateContract: (biz: number, cid: number, body: Record<string, unknown>) => req<Contract>('PUT', `${base(biz)}/contracts/${cid}`, body),
  activateContract: (biz: number, cid: number) => req<{ contract: Contract; superseded: number[] }>('POST', `${base(biz)}/contracts/${cid}/activate`),
  endContract: (biz: number, cid: number, endDate: string) => req<Contract>('POST', `${base(biz)}/contracts/${cid}/end`, { end_date: endDate }),
  deleteContract: (biz: number, cid: number) => req<{ id: number }>('DELETE', `${base(biz)}/contracts/${cid}`),
  managers: (biz: number) => req<{ manager_user_ids: number[] }>('GET', `${base(biz)}/managers`),
  setManagers: (biz: number, ids: number[]) => req<{ manager_user_ids: number[] }>('PUT', `${base(biz)}/managers`, { manager_user_ids: ids }),
  setModules: (biz: number, modules: { payroll?: boolean; doc_billing_terms?: boolean }) => req<{ modules: { payroll: boolean; doc_billing_terms?: boolean } }>('PUT', `/api/businesses/${biz}/modules`, modules),
  // 항목
  items: (biz: number) => req<PayItem[]>('GET', `${base(biz)}/items`),
  createItem: (biz: number, body: Record<string, unknown>) => req<PayItem>('POST', `${base(biz)}/items`, body),
  updateItem: (biz: number, id: number, body: Record<string, unknown>) => req<PayItem>('PUT', `${base(biz)}/items/${id}`, body),
  deleteItem: (biz: number, id: number) => req<{ id: number }>('DELETE', `${base(biz)}/items/${id}`),
  presets: (biz: number) => req<PresetSummary[]>('GET', `${base(biz)}/item-presets`),
  preset: (biz: number, key: string) => req<{ key: string; label: { ko: string; en: string }; items: PresetItem[] }>('GET', `${base(biz)}/item-presets/${encodeURIComponent(key)}`),
  applyPreset: (biz: number, key: string, codes?: string[]) => req<{ created: PayItem[]; skipped: string[] }>('POST', `${base(biz)}/item-presets/${encodeURIComponent(key)}/apply`, { codes }),
  suggestItems: (biz: number, body: { country: string; employment_kind: string }) => req<{ items: SuggestedItem[]; fallback: boolean }>('POST', `${base(biz)}/items/suggest`, body),
  // 회차
  runs: (biz: number) => req<Run[]>('GET', `${base(biz)}/runs`),
  createRun: (biz: number, body: { period_ym: string; pay_date?: string | null; transfer_task_mode?: string }) => req<{ run: Run; warnings: Record<string, string[]> }>('POST', `${base(biz)}/runs`, body),
  run: (biz: number, id: number) => req<RunDetail>('GET', `${base(biz)}/runs/${id}`),
  buildRun: (biz: number, id: number) => req<{ run: Run; warnings: Record<string, string[]> }>('POST', `${base(biz)}/runs/${id}/build`),
  deleteRun: (biz: number, id: number) => req<{ id: number }>('DELETE', `${base(biz)}/runs/${id}`),
  updateLine: (biz: number, lineId: number, body: { final_amount?: number | string | null; note?: string | null }) => req<{ line_id: number }>('PATCH', `${base(biz)}/lines/${lineId}`, body),
  updateEntry: (biz: number, entryId: number, body: { unpaid_leave_days?: number | string | null; note?: string | null }) => req<{ entry_id: number }>('PATCH', `${base(biz)}/entries/${entryId}`, body),
  removeEntry: (biz: number, entryId: number) => req<{ entry_id: number }>('DELETE', `${base(biz)}/entries/${entryId}`),
  adopt: (biz: number, id: number, body: { mode: 'statement' | 'draft' | 'zero'; entry_id?: number; line_id?: number }) => req<{ changed: number }>('POST', `${base(biz)}/runs/${id}/adopt`, body),
  uploadStatement: (biz: number, id: number, file: File) => upload<StatementSummary>(`${base(biz)}/runs/${id}/statement`, file),
  decideColumn: (biz: number, id: number, body: { key: string; action: 'map' | 'ignore' | 'create'; item_id?: number; side?: 'earning' | 'deduction' }) => req<StatementSummary>('PUT', `${base(biz)}/runs/${id}/statement/columns`, body),
  decideRow: (biz: number, id: number, body: { idx: number; action: 'map' | 'skip' | 'create'; person_id?: number }) => req<StatementSummary>('PUT', `${base(biz)}/runs/${id}/statement/rows`, body),
  confirmRun: (biz: number, id: number, body: { transfer_task_mode?: string; transfer_assignee_id?: number | null }) => req<{ run: Run; tasks_created: number; tasks_ok: boolean; notified: number }>('POST', `${base(biz)}/runs/${id}/confirm`, body),
  transferTasks: (biz: number, id: number) => req<{ created: number[] }>('POST', `${base(biz)}/runs/${id}/transfer-tasks`),
  markPaid: (biz: number, id: number) => req<{ run: Run }>('POST', `${base(biz)}/runs/${id}/paid`),
  createAdjustment: (biz: number, id: number, body: { person_ids?: number[]; pay_date?: string | null; note?: string | null }) => req<{ run: Run }>('POST', `${base(biz)}/runs/${id}/adjustments`, body),
  exportCsv: (biz: number, id: number, lang: string) => download(`${base(biz)}/runs/${id}/export.csv?lang=${lang === 'en' ? 'en' : 'ko'}`, 'payroll.csv'),
  entryPayslipPdf: (biz: number, entryId: number, lang: string) => download(`${base(biz)}/entries/${entryId}/payslip.pdf?lang=${lang === 'en' ? 'en' : 'ko'}`, 'payslip.pdf'),
  // 본인
  myPayslips: (biz: number) => req<PayslipSummary[]>('GET', `${base(biz)}/me/payslips`),
  myPayslip: (biz: number, entryId: number) => req<Payslip>('GET', `${base(biz)}/me/payslips/${entryId}`),
  myContracts: (biz: number) => req<MyContract[]>('GET', `${base(biz)}/me/contracts`),
  myPayslipPdf: (biz: number, entryId: number, lang: string) => download(`${base(biz)}/me/payslips/${entryId}/pdf?lang=${lang === 'en' ? 'en' : 'ko'}`, 'payslip.pdf'),
};

/** 금액 표시 — 통화별 소수 자리(KRW·JPY 0, 그 외 2). 화면마다 포맷을 따로 쓰지 않는다. */
export function formatMoney(n: number | null | undefined, currency = 'KRW', lang = 'ko'): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  const zero = currency === 'KRW' || currency === 'JPY';
  try {
    return new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'ko-KR', { style: 'currency', currency, maximumFractionDigits: zero ? 0 : 2, minimumFractionDigits: zero ? 0 : 2 }).format(Number(n));
  } catch { return String(n); }
}
