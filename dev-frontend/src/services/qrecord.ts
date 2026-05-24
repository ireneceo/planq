// Q record API 서비스 — 동적 테이블 (Notion DB 패턴)
import { apiFetch } from '../contexts/AuthContext';

export type QRecordColumnType =
  | 'text' | 'longtext' | 'number' | 'date' | 'datetime'
  | 'checkbox' | 'url' | 'email' | 'phone'
  | 'select' | 'multi_select' | 'secret'
  | 'attach'   // 파일/문서 첨부 — 셀 값 = { kind: 'file'|'post', id: number, label?: string }[]
  | 'row_sum' | 'row_avg' | 'row_min' | 'row_max';  // 행 기준 자동 계산 — 같은 행의 모든 number 컬럼 합산/평균/최소/최대

export type QRecordAggregate = 'none' | 'count' | 'sum' | 'avg' | 'min' | 'max' | 'empty' | 'filled';

export interface QRecordColumn {
  id: string;
  name: string;
  type: QRecordColumnType;
  options?: string[];
  order: number;
  aggregate?: QRecordAggregate;  // 컬럼 footer 집계 — none 또는 미설정 시 표시 X
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

// 사이클 N+55 — auto-paginate. records 백엔드 default 200 / max 500. 5 page 자동 누적.
export async function fetchRecords(businessId: number, opts?: { projectId?: number | null; category?: string }): Promise<QRecordSummary[]> {
  const baseParams = new URLSearchParams({ business_id: String(businessId) });
  if (opts?.projectId != null) baseParams.set('project_id', String(opts.projectId));
  if (opts?.category) baseParams.set('category', opts.category);
  const collected: QRecordSummary[] = [];
  const MAX_PAGES = 5;
  const LIMIT = 500;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const p = new URLSearchParams(baseParams);
    p.set('page', String(page));
    p.set('limit', String(LIMIT));
    const r = await apiFetch(`/api/records?${p}`);
    const j = await r.json();
    if (!j.success) break;
    collected.push(...((j.data || []) as QRecordSummary[]));
    if (!j.pagination || !j.pagination.has_more) break;
  }
  return collected;
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
