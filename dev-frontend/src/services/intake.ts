// 접수 양식 응답 → [사건 만들기] (2026-11-26 · 설계 docs/INTAKE_AUTO_CASE_DESIGN.md §6)
//   서버 routes/intake_cases.js · 판정 services/intakeCase 한 곳. 실패는 던진다(화면이 이유를 보여 준다).
import { apiFetch } from '../contexts/AuthContext';

export interface IntakeClientBrief { id: number; name: string | null }
export interface IntakeCaseView {
  id: number; status: 'running' | 'done' | 'error'; step: 'claimed' | 'project_done' | 'tasks_done'; error: string | null;
  stale?: boolean;   // 만드는 중으로 5분 넘게 멈춤 — 다시 만들 수 있다
  project_id: number | null; project_name: string | null; client_id: number | null;
  client_choice: 'linked' | 'created' | 'recipient' | 'none' | null; task_count: number; created_at: string;
}
export interface IntakePreview {
  enabled: boolean;
  template: { id: number; name: string; item_count: number } | null;
  project_name: string;
  contact: { name: string | null; email: string | null; phone: string | null; company: string | null };
  can_touch_clients: boolean;
  recipient_client: IntakeClientBrief | null;
  email_match: IntakeClientBrief | null;
  phone_match: IntakeClientBrief | null;
  case: IntakeCaseView | null;
}

export class IntakeApiError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}

async function read<T>(r: Response): Promise<T> {
  let j: { success?: boolean; data?: T; message?: string; code?: string } = {};
  try { j = await r.json(); } catch { /* 본문 없음 */ }
  if (!r.ok || !j.success) throw new IntakeApiError(j.code || j.message || `http_${r.status}`);
  return j.data as T;
}

export async function fetchIntakePreview(rowId: number): Promise<IntakePreview> {
  return read<IntakePreview>(await apiFetch(`/api/intake/rows/${rowId}`));
}

export async function createIntakeCase(rowId: number, body: { client_choice: 'link' | 'new' | 'none'; client_id?: number }): Promise<{ replayed: boolean; case: IntakeCaseView }> {
  return read(await apiFetch(`/api/intake/rows/${rowId}/case`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
}

export async function fetchIntakeCases(recordId: number, rowIds: number[]): Promise<{ enabled: boolean; cases: Record<string, IntakeCaseView>; orphans?: IntakeCaseView[] }> {
  return read(await apiFetch(`/api/intake/records/${recordId}/cases?row_ids=${rowIds.slice(0, 500).join(',')}`));
}

export interface TemplateOption { id: number; name: string; is_system: boolean }
export async function fetchTemplateOptions(businessId: number): Promise<TemplateOption[]> {
  const rows = await read<Array<{ id: number; name: string; is_system: boolean }>>(await apiFetch(`/api/task-templates?business_id=${businessId}`));
  return rows.map((t) => ({ id: t.id, name: t.name, is_system: !!t.is_system }));
}
