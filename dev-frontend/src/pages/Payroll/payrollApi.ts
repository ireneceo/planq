// 급여·계약 API 호출 모음 — 화면은 이 함수만 쓴다(서버 routes/payroll.js · docs/PAYROLL_DESIGN.md).
//   ★ apiFetch 는 throw 하지 않는다 — 여기서 res.ok/success 를 보고 실패를 던진다(AutoSaveField 가 ! 뱃지를 띄우게).
import { apiFetch } from '../../contexts/AuthContext';

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

export class PayrollError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await apiFetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let j: { success?: boolean; data?: T; message?: string } | null = null;
  try { j = await r.json(); } catch { /* 빈 응답 */ }
  if (!r.ok || !j?.success) throw new PayrollError(j?.message || `http_${r.status}`);
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
  setModules: (biz: number, modules: { payroll?: boolean }) => req<{ modules: { payroll: boolean } }>('PUT', `/api/businesses/${biz}/modules`, modules),
};

/** 금액 표시 — 통화별 소수 자리(KRW·JPY 0, 그 외 2). 화면마다 포맷을 따로 쓰지 않는다. */
export function formatMoney(n: number | null | undefined, currency = 'KRW', lang = 'ko'): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  const zero = currency === 'KRW' || currency === 'JPY';
  try {
    return new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'ko-KR', { style: 'currency', currency, maximumFractionDigits: zero ? 0 : 2, minimumFractionDigits: zero ? 0 : 2 }).format(Number(n));
  } catch { return String(n); }
}
