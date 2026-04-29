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
  updated_at: string;
  created_at: string;
}

export interface KbListFilter {
  category?: KbCategory;
  scope?: KbScope;
  project_id?: number;
  client_id?: number;
  q?: string;
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
  const qs = sp.toString();
  const res = await apiFetch(`/api/businesses/${businessId}/kb/documents${qs ? `?${qs}` : ''}`);
  return handle<KbDocumentRow[]>(res);
}

export interface KbCreateInput {
  title: string;
  body: string;
  category: KbCategory;
  scope: KbScope;
  project_id?: number | null;
  client_id?: number | null;
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
