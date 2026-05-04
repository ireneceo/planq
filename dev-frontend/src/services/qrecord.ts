// Q record API 서비스 — 동적 테이블 (Notion DB 패턴)
import { apiFetch } from '../contexts/AuthContext';

export type QRecordColumnType =
  | 'text' | 'longtext' | 'number' | 'date' | 'datetime'
  | 'checkbox' | 'url' | 'email' | 'phone'
  | 'select' | 'multi_select' | 'secret';

export interface QRecordColumn {
  id: string;
  name: string;
  type: QRecordColumnType;
  options?: string[];
  order: number;
}

export interface QRecordSummary {
  id: number;
  business_id: number;
  project_id: number | null;
  name: string;
  category: string | null;
  description: string | null;
  columns: QRecordColumn[];
  read_policy: 'all' | 'owner';
  position: number;
  row_count: number;
  created_at: string;
  updated_at: string;
  Project?: { id: number; name: string } | null;
  creator?: { id: number; name: string } | null;
}

export interface QRecordRow {
  id: number;
  q_record_id: number;
  values: Record<string, unknown>;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface QRecordDetail extends QRecordSummary {
  rows: QRecordRow[];
}

export async function fetchRecords(businessId: number, opts?: { projectId?: number | null; category?: string }): Promise<QRecordSummary[]> {
  const qs = new URLSearchParams({ business_id: String(businessId) });
  if (opts?.projectId != null) qs.set('project_id', String(opts.projectId));
  if (opts?.category) qs.set('category', opts.category);
  const r = await apiFetch(`/api/records?${qs.toString()}`);
  const j = await r.json();
  return (j.data || []) as QRecordSummary[];
}

export async function fetchRecordCategories(businessId: number): Promise<string[]> {
  const r = await apiFetch(`/api/records/categories?business_id=${businessId}`);
  const j = await r.json();
  return (j.data || []) as string[];
}

export async function fetchRecord(id: number): Promise<QRecordDetail | null> {
  const r = await apiFetch(`/api/records/${id}`);
  const j = await r.json();
  if (!j.success) return null;
  return j.data as QRecordDetail;
}

export async function createRecord(payload: {
  business_id: number;
  project_id?: number | null;
  name: string;
  category?: string | null;
  description?: string | null;
  columns?: Partial<QRecordColumn>[];
}): Promise<QRecordSummary> {
  const r = await apiFetch('/api/records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'create failed');
  return j.data as QRecordSummary;
}

export async function updateRecord(id: number, patch: Partial<{
  name: string; category: string | null; description: string | null;
  read_policy: 'all' | 'owner'; columns: QRecordColumn[];
}>): Promise<QRecordSummary> {
  const r = await apiFetch(`/api/records/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'update failed');
  return j.data as QRecordSummary;
}

export async function deleteRecord(id: number): Promise<boolean> {
  const r = await apiFetch(`/api/records/${id}`, { method: 'DELETE' });
  const j = await r.json();
  return !!j.success;
}

export async function createRow(recordId: number, values: Record<string, unknown>): Promise<QRecordRow> {
  const r = await apiFetch(`/api/records/${recordId}/rows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'row create failed');
  return j.data as QRecordRow;
}

export async function updateRow(recordId: number, rowId: number, patch: { values?: Record<string, unknown>; position?: number }): Promise<QRecordRow> {
  const r = await apiFetch(`/api/records/${recordId}/rows/${rowId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'row update failed');
  return j.data as QRecordRow;
}

export async function deleteRow(recordId: number, rowId: number): Promise<boolean> {
  const r = await apiFetch(`/api/records/${recordId}/rows/${rowId}`, { method: 'DELETE' });
  const j = await r.json();
  return !!j.success;
}

export async function revealSecret(recordId: number, rowId: number, columnId: string): Promise<string> {
  const r = await apiFetch(`/api/records/${recordId}/rows/${rowId}/secret/${columnId}`);
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'reveal failed');
  return (j.data?.value as string) || '';
}
