// 문서(포스팅) 서비스 래퍼
import { apiFetch } from '../contexts/AuthContext';

export interface PostRow {
  id: number;
  business_id: number;
  project_id: number | null;
  title: string;
  category: string | null;
  status: 'draft' | 'published';
  visibility: 'internal' | 'public';
  is_pinned: boolean;
  view_count: number;
  author: { id: number; name: string } | null;
  editor: { id: number; name: string } | null;
  project: { id: number; name: string; color: string | null } | null;
  content_preview: string;
  created_at: string;
  updated_at: string;
}

// Tiptap JSON — 간단히 unknown 으로 취급 (JSONContent)
export type TiptapDoc = { type: 'doc'; content: unknown[] } | null;

export interface PostAttachment {
  id: number;
  file_id: number;
  sort_order: number;
  file: {
    id: number;
    file_name: string;
    file_size: number;
    mime_type: string | null;
    storage_provider: 'planq' | 'gdrive';
    external_url: string | null;
    download_url: string;
  } | null;
}

export interface PostDetail extends PostRow {
  content_json: TiptapDoc;
  attachments: PostAttachment[];
}

export interface PostListFilter {
  projectId?: number | null;  // undefined=무시, null='null'(워크스페이스 전역), number=프로젝트
  query?: string;
  category?: string;
  mine?: boolean;
}
export async function fetchPosts(businessId: number, filter: PostListFilter = {}): Promise<PostRow[]> {
  const params = new URLSearchParams({ business_id: String(businessId) });
  if (filter.projectId === null) params.set('project_id', 'null');
  else if (filter.projectId !== undefined) params.set('project_id', String(filter.projectId));
  if (filter.query) params.set('q', filter.query);
  if (filter.category) params.set('category', filter.category);
  if (filter.mine) params.set('mine', '1');
  const r = await apiFetch(`/api/posts?${params}`);
  const j = await r.json();
  if (!j.success) return [];
  return j.data as PostRow[];
}

export interface PostsMeta {
  total: number;
  myCount: number;
  categories: Array<{ name: string; count: number }>;
  projects: Array<{ id: number; name: string; color: string | null; count: number }>;
}
export async function fetchPostsMeta(businessId: number, projectId?: number | null): Promise<PostsMeta> {
  const params = new URLSearchParams({ business_id: String(businessId) });
  if (projectId === null) params.set('project_id', 'null');
  else if (projectId !== undefined) params.set('project_id', String(projectId));
  const r = await apiFetch(`/api/posts/meta?${params}`);
  const j = await r.json();
  if (!j.success) return { total: 0, myCount: 0, categories: [], projects: [] };
  return j.data as PostsMeta;
}

export async function fetchPost(id: number): Promise<PostDetail | null> {
  const r = await apiFetch(`/api/posts/${id}`);
  const j = await r.json();
  if (!j.success) return null;
  return j.data as PostDetail;
}

export async function createPost(payload: {
  business_id: number;
  project_id?: number | null;
  title: string;
  content_json?: TiptapDoc;
  category?: string | null;
  is_pinned?: boolean;
}): Promise<PostDetail> {
  const r = await apiFetch('/api/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'create failed');
  return j.data as PostDetail;
}

export async function updatePost(id: number, patch: Partial<{
  title: string; content_json: TiptapDoc; category: string | null; status: 'draft' | 'published'; is_pinned: boolean;
}>): Promise<PostDetail> {
  const r = await apiFetch(`/api/posts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'update failed');
  return j.data as PostDetail;
}

export async function deletePost(id: number): Promise<boolean> {
  const r = await apiFetch(`/api/posts/${id}`, { method: 'DELETE' });
  const j = await r.json();
  return !!j.success;
}

export async function attachToPost(postId: number, fileIds: number[]): Promise<void> {
  const r = await apiFetch(`/api/posts/${postId}/attachments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_ids: fileIds }),
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'attach failed');
}

export async function detachFromPost(postId: number, attachmentId: number): Promise<boolean> {
  const r = await apiFetch(`/api/posts/${postId}/attachments/${attachmentId}`, { method: 'DELETE' });
  const j = await r.json();
  return !!j.success;
}
