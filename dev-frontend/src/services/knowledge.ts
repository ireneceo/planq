// Q knowledge — KbDocument CRUD + 카테고리·스코프 필터.
import { apiFetch } from '../contexts/AuthContext';

// N+64 — 자유 카테고리 (string). 옛 ENUM 6개는 backward-compat 라벨.
export type KbCategory = string;
export const LEGACY_KB_CATEGORIES = ['policy', 'manual', 'incident', 'faq', 'about', 'pricing'] as const;
export type KbScope = 'private' | 'workspace' | 'project' | 'client';
// N+64 — 통합 visibility (PlanQ VISIBILITY_VOCABULARY.md L1-L4)
export type KbVlevel = 'L1' | 'L2' | 'L3' | 'L4';

export interface KbDocumentRow {
  id: number;
  title: string;
  source_type: string;
  category: KbCategory;
  categories?: KbCategory[] | null;  // 멀티 카테고리 (2026-05-04~). 없으면 [category] 로 fallback.
  scope: KbScope;
  project_id: number | null;
  client_id: number | null;
  status: 'pending' | 'indexing' | 'ready' | 'failed';
  chunk_count: number;
  // 사이클 P3
  tags: string[] | null;
  attached_file_ids: number[] | null;
  attached_post_ids: number[] | null;
  // Q info — 사용자 정의 항목 + 권한
  custom_columns?: Array<{ id: string; name: string; type: string; show_in_list?: boolean; options?: string[] }> | null;
  custom_values?: Record<string, unknown> | null;
  read_policy?: 'all' | 'owner';
  client_ids?: number[] | null;
  // N+64 — 통합 visibility
  vlevel?: KbVlevel | null;
  target_member_ids?: number[] | null;
  security_level?: 'general' | 'internal' | 'confidential';  // D4 #62
  share_token?: string | null;
  // 상세 GET 응답에만 포함되는 필드들
  body?: string | null;
  attached_files?: Array<{ id: number; file_name: string; file_size: number; mime_type: string | null; storage_provider: string; external_url: string | null }>;
  attached_posts?: Array<{ id: number; title: string; project_id: number | null; category: string | null }>;
  updated_at: string;
  created_at: string;
}

export interface KbListFilter {
  category?: KbCategory;          // legacy 단일 (호환)
  categories?: KbCategory[];      // 멀티 — 한 자료가 매칭하는 카테고리 중 하나라도 포함되면 매칭
  scope?: KbScope;
  project_id?: number;
  client_id?: number;
  q?: string;
  tag?: string;
}

async function handle<T>(res: Response): Promise<T> {
  const j = await res.json();
  if (!res.ok || !j.success) throw new Error(j.message || `HTTP ${res.status}`);
  return j.data as T;
}

// N+30 — 개인 보관함 KB list. 본인 uploaded_by + scope='private' (PERSONAL_VAULT_DESIGN.md §2)
// backend GET /api/personal-vault/:bizId/kb-documents (N+9) — 응답을 KbDocumentRow shape 어댑트
export async function fetchPersonalKb(businessId: number): Promise<KbDocumentRow[]> {
  const res = await apiFetch(`/api/personal-vault/${businessId}/kb-documents`);
  const j = await res.json();
  if (!j.success) return [];
  return (j.data || []) as KbDocumentRow[];
}

export async function listKnowledge(businessId: number, filter: KbListFilter = {}): Promise<KbDocumentRow[]> {
  const sp = new URLSearchParams();
  if (filter.category) sp.set('category', filter.category);
  if (filter.categories && filter.categories.length > 0) sp.set('categories', filter.categories.join(','));
  if (filter.scope) sp.set('scope', filter.scope);
  if (filter.project_id) sp.set('project_id', String(filter.project_id));
  if (filter.client_id) sp.set('client_id', String(filter.client_id));
  if (filter.q) sp.set('q', filter.q);
  if (filter.tag) sp.set('tag', filter.tag);
  const qs = sp.toString();
  const res = await apiFetch(`/api/businesses/${businessId}/kb/documents${qs ? `?${qs}` : ''}`);
  return handle<KbDocumentRow[]>(res);
}

export interface KbCreateInput {
  title: string;
  body?: string;
  category?: KbCategory;          // legacy 단일 (호환)
  categories?: KbCategory[];      // 멀티 — 우선
  scope: KbScope;
  project_id?: number | null;
  client_id?: number | null;
  // 사이클 P3 — 단일 폼 첨부 통합
  attached_file_ids?: number[];
  attached_post_ids?: number[];
  // Q info — 사용자 정의 항목 + 권한
  custom_columns?: Array<{ id: string; name: string; type: string; show_in_list?: boolean; options?: string[] }>;
  custom_values?: Record<string, unknown>;
  read_policy?: 'all' | 'owner';
  client_ids?: number[];
  // N+64 — 통합 visibility (서버가 vlevel 우선 처리, 없으면 scope fallback)
  vlevel?: KbVlevel;
  target_member_ids?: number[];
}

export async function createKnowledge(businessId: number, input: KbCreateInput): Promise<KbDocumentRow> {
  const res = await apiFetch(`/api/businesses/${businessId}/kb/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return handle<KbDocumentRow>(res);
}

// 인라인 편집 — 부분 수정 (custom_values 등)
export async function updateKnowledge(businessId: number, docId: number, patch: Partial<{
  title: string; body: string; category: KbCategory; categories: KbCategory[]; scope: KbScope;
  project_id: number | null; client_id: number | null;
  custom_columns: Array<{ id: string; name: string; type: string; show_in_list?: boolean; options?: string[] }>;
  custom_values: Record<string, unknown>;
  read_policy: 'all' | 'owner';
  client_ids: number[];
  tags: string[];
  attached_file_ids: number[];
  attached_post_ids: number[];
  // N+64 — 통합 visibility
  vlevel: KbVlevel;
  target_member_ids: number[];
}>): Promise<KbDocumentRow> {
  const r = await apiFetch(`/api/businesses/${businessId}/kb/documents/${docId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'update failed');
  return j.data as KbDocumentRow;
}

export async function deleteKnowledge(businessId: number, docId: number): Promise<void> {
  const res = await apiFetch(`/api/businesses/${businessId}/kb/documents/${docId}`, { method: 'DELETE' });
  await handle(res);
}

// D4 #62 — 자료 보안등급 변경. 일반 외로 상향 시 외부 공유 링크 무효화.
export async function updateKbSecurityLevel(
  docId: number,
  level: 'general' | 'internal' | 'confidential',
): Promise<{ id: number; security_level: 'general' | 'internal' | 'confidential'; revoked_share: boolean }> {
  const res = await apiFetch(`/api/kb-documents/${docId}/security-level`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level }),
  });
  return handle(res);
}

// N+93 — 다건/카테고리 공유 번들 (#6)
export async function createKbShareBundle(
  businessId: number,
  payload: { kind: 'selection' | 'category'; doc_ids?: number[]; category?: string; title?: string },
): Promise<{ id: number; share_token: string; share_url: string; count: number | null }> {
  const res = await apiFetch(`/api/businesses/${businessId}/kb/share-bundle`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const j = await res.json();
  if (!j.success) throw new Error(j.message || 'bundle_failed');
  return j.data;
}

// 사이클 P1 — 파일 직접 업로드 (multipart)
export interface KbUploadInput {
  file: File;
  title?: string;
  category: KbCategory;
  scope: KbScope;
  project_id?: number | null;
  client_id?: number | null;
}
export async function uploadKnowledgeFile(businessId: number, input: KbUploadInput): Promise<KbDocumentRow> {
  const fd = new FormData();
  fd.append('file', input.file, input.file.name);
  if (input.title) fd.append('title', input.title);
  fd.append('category', input.category);
  fd.append('scope', input.scope);
  if (input.project_id) fd.append('project_id', String(input.project_id));
  if (input.client_id) fd.append('client_id', String(input.client_id));
  const res = await apiFetch(`/api/businesses/${businessId}/kb/documents/upload`, {
    method: 'POST',
    body: fd,
  });
  return handle<KbDocumentRow>(res);
}

// 사이클 P1 — 기존 워크스페이스 파일 → Knowledge import
export interface KbImportFromFileInput {
  file_id: number;
  title?: string;
  category: KbCategory;
  scope: KbScope;
  project_id?: number | null;
  client_id?: number | null;
}
export async function importKnowledgeFromFile(businessId: number, input: KbImportFromFileInput): Promise<KbDocumentRow> {
  const res = await apiFetch(`/api/businesses/${businessId}/kb/documents/import-from-file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return handle<KbDocumentRow>(res);
}

// 사이클 P1 — 기존 Q docs 포스트 → Knowledge import
export interface KbImportFromPostInput {
  post_id: number;
  category: KbCategory;
  scope: KbScope;
  project_id?: number | null;
  client_id?: number | null;
}
export async function importKnowledgeFromPost(businessId: number, input: KbImportFromPostInput): Promise<KbDocumentRow> {
  const res = await apiFetch(`/api/businesses/${businessId}/kb/documents/import-from-post`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return handle<KbDocumentRow>(res);
}

// ─── KbCategory — N+64 (자유 추가/편집 + 중복 감지 마스터) ────────
export interface KbCategoryRow {
  id: number;
  name: string;
  sort_order: number;
}
export interface KbCategoryListResp {
  master: KbCategoryRow[];
  orphan: string[];   // 마스터에 없지만 KbDocument 안에서 사용 중인 자유 카테고리
}
export async function listKbCategories(businessId: number): Promise<KbCategoryListResp> {
  const res = await apiFetch(`/api/businesses/${businessId}/kb/categories`);
  return handle<KbCategoryListResp>(res);
}
export async function createKbCategory(businessId: number, name: string): Promise<{ id: number; name: string; sort_order: number; created: boolean }> {
  const res = await apiFetch(`/api/businesses/${businessId}/kb/categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return handle(res);
}
export async function renameKbCategory(businessId: number, id: number, name: string): Promise<KbCategoryRow> {
  const res = await apiFetch(`/api/businesses/${businessId}/kb/categories/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return handle<KbCategoryRow>(res);
}
export async function deleteKbCategory(businessId: number, id: number): Promise<void> {
  const res = await apiFetch(`/api/businesses/${businessId}/kb/categories/${id}`, { method: 'DELETE' });
  await handle(res);
}
