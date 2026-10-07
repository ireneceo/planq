// 표(table) API 서비스 — 동적 테이블 (Notion DB 패턴).
//   ★ 제품에 'Q record' 라는 메뉴는 없다. 이 파일이 다루는 것은 Q docs 문서 안의 **표**다.
//     서버 경로·테이블 이름은 여전히 record 계열이다 — 아래 주석 참조.
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

// ─── #460 설문 — 표 문서의 «응답 받기» 문 (docs/SURVEY_DESIGN.md) ───
export interface SurveySettings {
  title?: string; intro?: string; required?: string[]; hidden?: string[];
  help?: Record<string, string>; closes_at?: string | null; max_responses?: number | null;
}
export interface SurveyView {
  enabled: boolean; token: string | null; path: string | null; settings: SurveySettings;
  response_count: number; hard_cap: number; blocked: 'security_level' | null;
}
export interface SurveyColumnStat {
  id: string; name: string; type: QRecordColumnType; answered: number;
  counts?: Record<string, number>; avg?: number | null; min?: number | null; max?: number | null;
  by_day?: Record<string, number>; recent?: string[];
}
/** 설정 조회 — 켤 권한이 없으면 null(버튼을 숨긴다) */
export async function fetchSurvey(recordId: number): Promise<SurveyView | null> {
  const r = await apiFetch(`/api/records/${recordId}/survey`);
  if (r.status === 403 || r.status === 404) return null;
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'survey_load_failed');
  return j.data as SurveyView;
}
/** 켜기·끄기·설정 저장 — 실패는 던진다(AutoSaveField 가 ! 뱃지로 보여 준다) */
export async function saveSurvey(recordId: number, body: { enabled?: boolean; settings?: SurveySettings }): Promise<SurveyView> {
  const r = await apiFetch(`/api/records/${recordId}/survey`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'survey_save_failed');
  return j.data as SurveyView;
}
export async function fetchSurveyStats(recordId: number): Promise<{ total: number; survey_count: number; columns: SurveyColumnStat[] }> {
  const r = await apiFetch(`/api/records/${recordId}/survey-stats`);
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'survey_stats_failed');
  return j.data;
}
