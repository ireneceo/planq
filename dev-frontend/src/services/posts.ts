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

export async function fetchPosts(businessId: number, projectId?: number | null, query?: string): Promise<PostRow[]> {
  const params = new URLSearchParams({ business_id: String(businessId) });
  if (projectId === null) params.set('project_id', 'null');
  else if (projectId !== undefined) params.set('project_id', String(projectId));
  if (query) params.set('q', query);
  const r = await apiFetch(`/api/posts?${params}`);
  const j = await r.json();
  if (!j.success) return [];
  return j.data as PostRow[];
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
