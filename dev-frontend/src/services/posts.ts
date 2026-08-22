// 문서(포스팅) 서비스 래퍼
import { apiFetch } from '../contexts/AuthContext';
import { downloadBlob } from '../utils/download';

export interface PostRow {
  id: number;
  business_id: number;
  project_id: number | null;
  conversation_id: number | null;
  title: string;
  category: string | null;
  status: 'draft' | 'published';
  visibility: 'internal' | 'public';
  // N+67 — 통합 visibility (L1-L4). 옛 internal/public 와 hook 양방향 동기.
  vlevel?: 'L1' | 'L2' | 'L3' | 'L4' | null;
  security_level?: 'general' | 'internal' | 'confidential';  // D4 #62
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
  // 양방향 링크: 자료정리(brief) post 가 만든 후속 문서면 parent_post_id 가짐
  parent_post_id: number | null;
  // brief_meta 는 category='brief' 인 post 만. 일반 post 는 null
  brief_meta: unknown;
  // 문서 종류 — doc(기본) | table(표) | brief(자료정리) | template
  kind?: 'doc' | 'table' | 'brief' | 'template';
  // kind='table' 일 때 연결된 q_record id
  q_record_id?: number | null;
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
  // kind='table' 일 때 백엔드가 같이 보내주는 QRecord 메타
  qrecord?: {
    id: number;
    columns: Array<{ id: string; name: string; type: string; options?: string[]; order: number }>;
  };
  // 다른 post (문서/표) 연결
  linked_post_ids?: number[];
  linked_posts?: Array<{ id: number; title: string; kind: 'doc' | 'table' | 'brief' | 'template' }>;
}

export interface PostListFilter {
  projectId?: number | null;  // undefined=무시, null='null'(워크스페이스 전역), number=프로젝트
  query?: string;
  category?: string;
  mine?: boolean;
}
// 사이클 N+55 — auto-paginate. N+50 백엔드 cap (posts default 200 / max 500,
// personal-vault default 200 / max 500) 적용 시 1 page 부족할 수 있음. 5 page 자동 누적.
const POSTS_AUTO_LIMIT = 500; // posts 백엔드 max
const POSTS_AUTO_MAX_PAGES = 5;
async function fetchPostsAllPages(buildUrl: (page: number, limit: number) => string): Promise<PostRow[]> {
  const collected: PostRow[] = [];
  for (let page = 1; page <= POSTS_AUTO_MAX_PAGES; page++) {
    const r = await apiFetch(buildUrl(page, POSTS_AUTO_LIMIT));
    const j = await r.json();
    if (!j.success) break;
    collected.push(...(j.data || []) as PostRow[]);
    if (!j.pagination || !j.pagination.has_more) break;
  }
  return collected;
}

// N+30 — 개인 보관함 Post list. 본인 author + vlevel=L1 + project_id=null
// backend GET /api/personal-vault/:bizId/posts (N+9) 응답을 PostRow shape 어댑트.
// N+55 — auto-paginate.
export async function fetchPersonalPosts(businessId: number): Promise<PostRow[]> {
  return fetchPostsAllPages((page, limit) =>
    `/api/personal-vault/${businessId}/posts?page=${page}&limit=${limit}`
  );
}

export async function fetchPosts(businessId: number, filter: PostListFilter = {}): Promise<PostRow[]> {
  const baseParams = new URLSearchParams({ business_id: String(businessId) });
  if (filter.projectId === null) baseParams.set('project_id', 'null');
  else if (filter.projectId !== undefined) baseParams.set('project_id', String(filter.projectId));
  if (filter.query) baseParams.set('q', filter.query);
  if (filter.category) baseParams.set('category', filter.category);
  if (filter.mine) baseParams.set('mine', '1');
  // N+55 — auto-paginate (workspace posts 2000+ 누적 가능)
  return fetchPostsAllPages((page, limit) => {
    const p = new URLSearchParams(baseParams);
    p.set('page', String(page));
    p.set('limit', String(limit));
    return `/api/posts?${p}`;
  });
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

// 포스트(Q docs 글) PDF 다운로드 — 서버 렌더 브랜드 PDF (window.print 대체). 인증 blob fetch.
export async function downloadPostPdf(id: number, title: string): Promise<void> {
  const r = await apiFetch(`/api/posts/${id}/pdf`);
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { const j = await r.json(); msg = j.message || msg; } catch { /* binary */ }
    throw new Error(msg);
  }
  const blob = await r.blob();
  await downloadBlob(blob, `${title || 'document'}.pdf`);
}

/** #225 — 워드(.docx) 내려받기. PDF 와 같은 접근 검사를 서버가 한다. */
export async function downloadPostDocx(id: number, title: string): Promise<void> {
  const r = await apiFetch(`/api/posts/${id}/docx`);
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { const j = await r.json(); msg = j.message || msg; } catch { /* binary */ }
    throw new Error(msg);
  }
  const blob = await r.blob();
  await downloadBlob(blob, `${title || 'document'}.docx`);
}

export async function createPost(payload: {
  business_id: number;
  project_id?: number | null;
  conversation_id?: number | null;
  title: string;
  content_json?: TiptapDoc;
  category?: string | null;
  is_pinned?: boolean;
  vlevel?: 'L1' | 'L2' | 'L3' | 'L4';
  // #252 — 자동저장이 만드는 임시저장 글. 서버가 vlevel 을 L1 으로 강제하고
  //   broadcast·감사·거래 stage 를 발화시키지 않는다(타이핑 중이므로).
  status?: 'draft' | 'published';
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

/** 다른 사람이 먼저 저장해 내 편집 기준이 낡았을 때 (#252 낙관적 잠금 409). */
export class StaleEditError extends Error {
  currentUpdatedAt: string | null;
  /** 마지막으로 저장한 사람이 **나** 인가. 내 저장으로 서버가 앞서 나간 것이면 충돌이 아니라
   *  내 기준이 낡은 것이다 — 호출측이 기준을 갱신하고 한 번 재시도하면 된다. */
  byMe: boolean;
  constructor(message: string, currentUpdatedAt: string | null, byMe = false) {
    super(message);
    this.name = 'StaleEditError';
    this.currentUpdatedAt = currentUpdatedAt;
    this.byMe = byMe;
  }
}

export async function updatePost(id: number, patch: Partial<{
  title: string; content_json: TiptapDoc; category: string | null; status: 'draft' | 'published'; is_pinned: boolean;
  project_id: number | null; conversation_id: number | null;
  linked_post_ids: number[];
  vlevel: 'L1' | 'L2' | 'L3' | 'L4';
  // #252 — 편집 시작 시점의 updated_at. 서버 것과 어긋나면 409 (남의 저장을 덮지 않는다).
  base_updated_at: string | null;
  // 자동저장 표시 — 서버가 감사 로그·거래 stage 를 건너뛴다.
  autosave: boolean;
}>): Promise<PostDetail> {
  const r = await apiFetch(`/api/posts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  // ★ apiFetch 는 throw 하지 않는다 — 상태 코드를 직접 봐야 실패가 침묵하지 않는다.
  if (r.status === 409) {
    // 문구는 서버 메시지를 그대로 쓴다. 서비스 레이어엔 t() 가 없어 여기서 문자열을 만들면
    //   하드코딩이 되고 영어 사용자에게도 한국어가 나간다 — 비면 호출측(UI)이 t() 로 채운다.
    let msg = '';
    let cur: string | null = null;
    let byMe = false;
    try {
      const j = await r.json();
      msg = j.message || '';
      cur = j.data?.current_updated_at ?? null;
      byMe = !!j.data?.by_me;
    } catch { /* non-json */ }
    throw new StaleEditError(msg, cur, byMe);
  }
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'update failed');
  return j.data as PostDetail;
}

// N+67 — Post visibility 변경 (L1-L4 통일)
export async function updatePostVisibility(
  postId: number,
  body: { level: 'L1' | 'L2' | 'L3' | 'L4'; project_id?: number }
): Promise<{ id: number; vlevel: string; project_id: number | null; share_token?: string | null }> {
  const r = await apiFetch(`/api/posts/${postId}/visibility`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'visibility_change_failed');
  return j.data;
}

// D4 #62 — 문서 보안등급 변경. 일반 외로 상향 시 외부 공유 링크 무효화.
export async function updatePostSecurityLevel(
  postId: number,
  level: 'general' | 'internal' | 'confidential',
): Promise<{ id: number; security_level: 'general' | 'internal' | 'confidential'; revoked_share: boolean }> {
  const r = await apiFetch(`/api/posts/${postId}/security-level`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level }),
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'security_level_change_failed');
  return j.data;
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

// ─── Brief (자료정리) ───
export interface BriefMeta {
  view_kind: 'time' | 'file';
  sources: Array<{ source: string; file_id: number | null }>;
  timeline_count: number;
  by_file_count: number;
  recommended_next_kind: string;
  recommended_next_reason: string;
  summary: string;
  timeline: Array<{ when: string; title: string; content: string; source: string }>;
  by_file: Array<{ source: string; summary: string; key_points: string[] }>;
  generated_at: string;
}
export interface BriefResult {
  post_id: number;
  title: string;
  brief_meta: BriefMeta;
  recommended_next_kind: string;
  recommended_next_reason: string;
}
// 텍스트 블록 + 파일 ID 들로 자료정리 post 생성. 한도 초과 시 throw 'cue_limit_exceeded'.
export async function createBrief(payload: {
  business_id: number;
  project_id?: number | null;
  conversation_id?: number | null;
  title: string;
  text_blocks?: string[];
  attached_file_ids?: number[];
  attached_post_ids?: number[];
}): Promise<BriefResult> {
  const r = await apiFetch('/api/posts/brief', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = await r.json();
  if (r.status === 429) {
    const e = new Error('cue_limit_exceeded') as Error & { usage?: { remaining: number; limit: number } };
    e.usage = j.usage;
    throw e;
  }
  if (!j.success) throw new Error(j.message || 'brief failed');
  return j.data as BriefResult;
}

// 자료정리에서 파생된 후속 문서 생성 (manual / ai)
export async function createFollowUp(parentId: number, payload: {
  mode: 'manual' | 'ai';
  kind: string;
  title?: string;
}): Promise<PostDetail> {
  const r = await apiFetch(`/api/posts/${parentId}/follow-up`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = await r.json();
  if (r.status === 429) {
    const e = new Error('cue_limit_exceeded') as Error & { usage?: { remaining: number; limit: number } };
    e.usage = j.usage;
    throw e;
  }
  if (!j.success) throw new Error(j.message || 'follow-up failed');
  return j.data as PostDetail;
}

// 자료정리에서 파생된 후속 문서 list
export interface FollowUpChild {
  id: number;
  title: string;
  category: string | null;
  created_at: string;
  author: { id: number; name: string } | null;
}
export async function fetchPostChildren(parentId: number): Promise<FollowUpChild[]> {
  const r = await apiFetch(`/api/posts/${parentId}/children`);
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'fetch children failed');
  return j.data as FollowUpChild[];
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
  /** #239 — 'confirm' 이면 확인 요청(OTP 없음), 미지정/'sign' 이면 기존 서명 요청 */
  kind?: 'sign' | 'confirm';
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
