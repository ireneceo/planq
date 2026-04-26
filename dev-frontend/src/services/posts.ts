// 문서(포스팅) 서비스 래퍼
import { apiFetch } from '../contexts/AuthContext';

export interface PostRow {
  id: number;
  business_id: number;
  project_id: number | null;
  conversation_id: number | null;
  title: string;
  category: string | null;
  status: 'draft' | 'published';
  visibility: 'internal' | 'public';
  is_pinned: boolean;
  view_count: number;
  author: { id: number; name: string } | null;
  editor: { id: number; name: string } | null;
  project: { id: number; name: string; color: string | null } | null;
  conversation: { id: number; title: string | null } | null;
  share_token: string | null;
  share_url: string | null;
  shared_at: string | null;
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
  conversation_id?: number | null;
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
  project_id: number | null; conversation_id: number | null;
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

// ─── 카테고리 마스터 (빈 카테고리 등록) ───
export async function createCategory(businessId: number, name: string, projectId: number | null = null): Promise<{ id: number; name: string; created: boolean }> {
  const r = await apiFetch('/api/posts/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ business_id: businessId, project_id: projectId, name }),
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'category create failed');
  return j.data;
}

export async function deleteCategory(categoryId: number): Promise<boolean> {
  const r = await apiFetch(`/api/posts/categories/${categoryId}`, { method: 'DELETE' });
  const j = await r.json();
  return !!j.success;
}

// ─── 공유 ───
export interface PostShareInfo { share_token: string; share_url: string; shared_at: string | null; }
export async function sharePost(postId: number): Promise<PostShareInfo> {
  const r = await apiFetch(`/api/posts/${postId}/share`, { method: 'POST' });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'share failed');
  return j.data as PostShareInfo;
}
export async function revokePostShare(postId: number): Promise<boolean> {
  const r = await apiFetch(`/api/posts/${postId}/share`, { method: 'DELETE' });
  const j = await r.json();
  return !!j.success;
}
export async function emailPostShare(postId: number, payload: { to: string | string[]; message?: string }): Promise<{ share_url: string; results: Array<{ to: string; sent: boolean }> }> {
  const r = await apiFetch(`/api/posts/${postId}/share/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'email failed');
  return j.data;
}
export async function sharePostToChat(postId: number, payload: { conversation_id: number; message?: string }): Promise<{ message: { id: number }; share_url: string }> {
  const r = await apiFetch(`/api/posts/${postId}/share-to-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'share-to-chat failed');
  return j.data;
}

// ─── 서명 받기 (Phase A) ───
export type SignatureStatus = 'pending' | 'sent' | 'viewed' | 'signed' | 'rejected' | 'expired' | 'canceled';

export interface SignatureRequest {
  id: number;
  entity_type: 'post' | 'document';
  entity_id: number;
  business_id: number;
  requester_user_id: number;
  signer_email: string;
  signer_name: string | null;
  token: string;
  sign_url: string;
  status: SignatureStatus;
  viewed_at: string | null;
  otp_verified: boolean;
  signed_at: string | null;
  signed_ip: string | null;
  signature_image_b64: string | null;
  rejected_at: string | null;
  rejected_reason: string | null;
  note: string | null;
  expires_at: string;
  reminder_count: number;
  last_reminder_at: string | null;
  created_at: string;
}

export async function requestSignatures(postId: number, payload: {
  signers: Array<{ email: string; name?: string }>;
  note?: string;
  expires_in_days?: number;
  send_chat?: boolean;
  conversation_id?: number;
}): Promise<{ signatures: SignatureRequest[]; chat_message_id: number | null }> {
  const r = await apiFetch(`/api/posts/${postId}/signatures`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'signature request failed');
  return j.data;
}

export async function listSignatures(postId: number): Promise<SignatureRequest[]> {
  const r = await apiFetch(`/api/posts/${postId}/signatures`);
  const j = await r.json();
  if (!j.success) return [];
  return j.data as SignatureRequest[];
}

export async function cancelSignature(id: number): Promise<boolean> {
  const r = await apiFetch(`/api/signatures/${id}`, { method: 'DELETE' });
  const j = await r.json();
  return !!j.success;
}

export async function remindSignature(id: number): Promise<{ sent: boolean; reminder_count: number }> {
  const r = await apiFetch(`/api/signatures/${id}/reminder`, { method: 'POST' });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'reminder failed');
  return j.data;
}
