// Q knowledge — KbDocument CRUD + 카테고리·스코프 필터.
import { apiFetch } from '../contexts/AuthContext';

export type KbCategory = 'policy' | 'manual' | 'incident' | 'faq' | 'about' | 'pricing';
export type KbScope = 'workspace' | 'project' | 'client';

export interface KbDocumentRow {
  id: number;
  title: string;
  source_type: string;
  category: KbCategory;
  scope: KbScope;
  project_id: number | null;
  client_id: number | null;
  status: 'pending' | 'indexing' | 'ready' | 'failed';
  chunk_count: number;
  // 사이클 P3
  tags: string[] | null;
  attached_file_ids: number[] | null;
  attached_post_ids: number[] | null;
  updated_at: string;
  created_at: string;
}

export interface KbListFilter {
  category?: KbCategory;
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

export async function listKnowledge(businessId: number, filter: KbListFilter = {}): Promise<KbDocumentRow[]> {
  const sp = new URLSearchParams();
  if (filter.category) sp.set('category', filter.category);
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
  category: KbCategory;
  scope: KbScope;
  project_id?: number | null;
  client_id?: number | null;
  // 사이클 P3 — 단일 폼 첨부 통합
  attached_file_ids?: number[];
  attached_post_ids?: number[];
}

export async function createKnowledge(businessId: number, input: KbCreateInput): Promise<KbDocumentRow> {
  const res = await apiFetch(`/api/businesses/${businessId}/kb/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return handle<KbDocumentRow>(res);
}

export async function deleteKnowledge(businessId: number, docId: number): Promise<void> {
  const res = await apiFetch(`/api/businesses/${businessId}/kb/documents/${docId}`, { method: 'DELETE' });
  await handle(res);
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
