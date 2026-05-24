// 프로젝트 파일 허브 서비스
// Phase 2 — 실 API 연결 완료

import { apiFetch } from '../contexts/AuthContext';

export type FileSource = 'direct' | 'chat' | 'task' | 'meeting' | 'post';
export type StorageProvider = 'planq' | 'gdrive';

export interface ProjectContext {
  id: number;
  name: string;
  color?: string | null;
}

export interface ProjectFile {
  id: string;              // 'direct-12' / 'chat-45' / 'task-7' / 'meeting-3'
  source: FileSource;
  file_name: string;
  file_size: number;
  mime_type: string | null;
  uploader_id: number | null;
  uploader_name: string;
  uploaded_at: string;
  download_url: string;
  preview_url?: string;
  context?: { kind: 'conversation' | 'task' | 'meeting'; id: number; label: string };
  project_context?: ProjectContext | null;  // 워크스페이스 모드에서만 의미 있음
  folder_id: number | null;
  deletable: boolean;
  storage_provider: StorageProvider;
  external_id?: string | null;          // Drive 파일 id (외부 저장소)
  external_url?: string | null;         // Drive webViewLink
}

export interface FileFolder {
  id: number;
  name: string;
  parent_id: number | null;
  sort_order: number;
}

export interface StorageStatus {
  provider: StorageProvider;
  bytes_used: number;
  bytes_quota: number;
  file_count: number;
  plan: 'free' | 'basic' | 'pro';
}

export interface UploadResult {
  success: boolean;
  file?: ProjectFile;
  message?: string;
}

// ─── id 접두어 파서 ───
function parseFileId(composite: string): { source: FileSource; id: number } | null {
  const m = composite.match(/^(direct|chat|task|meeting)-(\d+)$/);
  if (!m) return null;
  return { source: m[1] as FileSource, id: Number(m[2]) };
}

// ─── API 래퍼 ───

// 사이클 N+55 — auto-paginate 헬퍼.
// N+50 백엔드 pagination cap (default 500 / max 1000) 에 맞춰 frontend 가 자동 누적.
// has_more=true 면 다음 page fetch — 최대 5 페이지 = 5000 항목 cap (무한 루프 방지).
// UI 변경 X — 사용자에게는 단일 array 로 보임 (1000+ 워크스페이스에서도 정상).
const AUTO_PAGINATE_MAX_PAGES = 5;
const AUTO_PAGINATE_LIMIT = 1000; // 백엔드 max 와 일치

async function fetchAllPages<T>(buildUrl: (page: number, limit: number) => string): Promise<T[]> {
  const collected: T[] = [];
  for (let page = 1; page <= AUTO_PAGINATE_MAX_PAGES; page++) {
    const r = await apiFetch(buildUrl(page, AUTO_PAGINATE_LIMIT));
    const j = await r.json();
    if (!j.success) break;
    const data = (j.data || []) as T[];
    collected.push(...data);
    const pag = j.pagination;
    // pagination 메타 없는 옛 응답 — 첫 페이지로 끝
    if (!pag) break;
    if (!pag.has_more) break;
  }
  return collected;
}

export async function fetchProjectFiles(projectId: number): Promise<ProjectFile[]> {
  // /api/projects/:id/files — pagination 미적용 라우트 (project 단위 작음). single fetch.
  const r = await apiFetch(`/api/projects/${projectId}/files`);
  const j = await r.json();
  if (!j.success) return [];
  return (j.data || []) as ProjectFile[];
}

export async function fetchWorkspaceFiles(businessId: number): Promise<ProjectFile[]> {
  // /api/projects/workspace/:bizId/all-files — N+50 pagination (default 500 / max 1000).
  // auto-paginate 로 5000 항목까지 자동 누적.
  return fetchAllPages<ProjectFile>((page, limit) =>
    `/api/projects/workspace/${businessId}/all-files?page=${page}&limit=${limit}`
  );
}

// N+30 — 개인 보관함 (Personal Vault) 파일 list
// 본인 업로드 + visibility=L1 + project_id=null 만 (PERSONAL_VAULT_DESIGN.md §2)
// backend GET /api/personal-vault/:bizId/files 응답 형식을 ProjectFile shape 로 어댑트.
// 사이클 N+55 — pagination auto-paginate.
export async function fetchPersonalFiles(businessId: number): Promise<ProjectFile[]> {
  const raw = await fetchAllPages<{
    id: number; file_name: string; mime_type: string; file_size: number; created_at: string;
  }>((page, limit) => `/api/personal-vault/${businessId}/files?page=${page}&limit=${limit}`);
  return raw.map(f => ({
    id: `direct-${f.id}`,
    source: 'direct' as FileSource,
    file_name: f.file_name,
    file_size: Number(f.file_size),
    mime_type: f.mime_type,
    uploader_id: 0,        // 본인 자산이라 서버에서 표시 안 함
    uploader_name: '나',
    uploaded_at: f.created_at,
    download_url: `/api/files/${businessId}/${f.id}/download`,
    folder_id: null,
    deletable: true,        // 본인 자산이므로 항상 삭제 가능
    storage_provider: 'planq' as StorageProvider,
    project_context: null,  // personal vault — 프로젝트 컨텍스트 없음
  }));
}

export async function fetchFolders(projectId: number): Promise<FileFolder[]> {
  const r = await apiFetch(`/api/folders/projects/${projectId}`);
  const j = await r.json();
  if (!j.success) return [];
  return (j.data || []) as FileFolder[];
}

export async function createFolder(projectId: number, name: string, parentId: number | null): Promise<FileFolder> {
  const r = await apiFetch(`/api/folders/projects/${projectId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parent_id: parentId })
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'create folder failed');
  return j.data as FileFolder;
}

export async function renameFolder(folderId: number, name: string): Promise<boolean> {
  const r = await apiFetch(`/api/folders/${folderId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  const j = await r.json();
  return !!j.success;
}

export async function deleteFolder(folderId: number): Promise<boolean> {
  const r = await apiFetch(`/api/folders/${folderId}`, { method: 'DELETE' });
  const j = await r.json();
  return !!j.success;
}

export async function reorderFolder(folderId: number, direction: 'up' | 'down'): Promise<boolean> {
  const r = await apiFetch(`/api/folders/${folderId}/reorder`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ direction })
  });
  const j = await r.json();
  return !!j.success;
}

export async function moveFile(businessId: number, fileId: string, folderId: number | null): Promise<boolean> {
  const parsed = parseFileId(fileId);
  if (!parsed || parsed.source !== 'direct') return false;
  const r = await apiFetch(`/api/files/${businessId}/${parsed.id}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder_id: folderId })
  });
  const j = await r.json();
  return !!j.success;
}

export async function uploadProjectFile(
  businessId: number,
  projectId: number,
  file: File,
  options?: { folderId?: number | null; onProgress?: (pct: number) => void }
): Promise<UploadResult> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('project_id', String(projectId));
  if (options?.folderId != null) fd.append('folder_id', String(options.folderId));

  const r = await apiFetch(`/api/files/${businessId}`, { method: 'POST', body: fd });
  const j = await r.json();
  if (!j.success || !j.data) return { success: false, message: j.message };

  const f = j.data;
  return {
    success: true,
    file: {
      id: `direct-${f.id}`,
      source: 'direct',
      file_name: f.file_name,
      file_size: Number(f.file_size),
      mime_type: f.mime_type,
      uploader_id: f.uploader_id,
      uploader_name: '나',
      uploaded_at: f.created_at || new Date().toISOString(),
      download_url: `/api/files/${businessId}/${f.id}/download`,
      preview_url: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
      folder_id: f.folder_id,
      deletable: true,
      storage_provider: (f.storage_provider || 'planq') as StorageProvider,
    }
  };
}

// "내 파일" — 프로젝트에 배정하지 않은 개인 업로드 (project_id 없음)
// opts.conversationId / opts.projectId — 채팅/프로젝트 컨텍스트가 있으면 전달.
//   • Drive 연동 시 conversation_id 만 있어도 Drive 의 "Conversations" 폴더로 라우팅 → 자체 스토리지 쿼터/사이즈 한도 모두 우회.
export async function uploadMyFile(
  businessId: number,
  file: File,
  opts?: { conversationId?: number | null; projectId?: number | null }
): Promise<UploadResult> {
  const fd = new FormData();
  fd.append('file', file);
  if (opts?.conversationId) fd.append('conversation_id', String(opts.conversationId));
  if (opts?.projectId) fd.append('project_id', String(opts.projectId));
  const r = await apiFetch(`/api/files/${businessId}`, { method: 'POST', body: fd });
  const j = await r.json();
  if (!j.success || !j.data) return { success: false, message: j.message };
  const f = j.data;
  return {
    success: true,
    file: {
      id: `direct-${f.id}`,
      source: 'direct',
      file_name: f.file_name,
      file_size: Number(f.file_size),
      mime_type: f.mime_type,
      uploader_id: f.uploader_id,
      uploader_name: '나',
      uploaded_at: f.created_at || new Date().toISOString(),
      download_url: `/api/files/${businessId}/${f.id}/download`,
      preview_url: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
      folder_id: f.folder_id,
      deletable: true,
      storage_provider: (f.storage_provider || 'planq') as StorageProvider,
    }
  };
}

export async function deleteProjectFile(businessId: number, fileId: string): Promise<boolean> {
  const parsed = parseFileId(fileId);
  if (!parsed || parsed.source !== 'direct') return false;
  const r = await apiFetch(`/api/files/${businessId}/${parsed.id}`, { method: 'DELETE' });
  const j = await r.json();
  return !!j.success;
}

export async function bulkDeleteFiles(businessId: number, fileIds: string[]): Promise<number> {
  const numericIds = fileIds
    .map(parseFileId)
    .filter((p): p is { source: FileSource; id: number } => !!p && p.source === 'direct')
    .map(p => p.id);
  if (numericIds.length === 0) return 0;
  const r = await apiFetch(`/api/files/${businessId}/bulk-delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_ids: numericIds })
  });
  const j = await r.json();
  return j.success ? (j.data?.deleted ?? numericIds.length) : 0;
}

// ─── 공유 링크 + 대량 다운로드 ───

export interface ShareLinkResult {
  share_token: string;
  share_url: string;
  expires_at: string;
  expires_days: number;
}

export async function createShareLink(
  businessId: number,
  fileId: string,
  expiresDays: 7 | 14 | 30 | 90 = 30,
): Promise<ShareLinkResult | null> {
  const parsed = parseFileId(fileId);
  if (!parsed || parsed.source !== 'direct') return null;
  const r = await apiFetch(`/api/files/${businessId}/${parsed.id}/share-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expires_days: expiresDays }),
  });
  const j = await r.json();
  if (!j.success) return null;
  return j.data as ShareLinkResult;
}

export async function revokeShareLink(businessId: number, fileId: string): Promise<boolean> {
  const parsed = parseFileId(fileId);
  if (!parsed || parsed.source !== 'direct') return false;
  const r = await apiFetch(`/api/files/${businessId}/${parsed.id}/share-link`, { method: 'DELETE' });
  const j = await r.json();
  return !!j.success;
}

// 다중 파일 ZIP 다운로드 — 브라우저에서 직접 blob 처리.
// composite ID (`direct-X`, `chat-X`, `task-X`) 를 그대로 백엔드로 전달 → 백엔드가 source 별 테이블에서 찾음.
// gdrive 등 외부 파일·meeting/post 는 백엔드에서 제외.
export async function bulkDownloadZip(businessId: number, fileIds: string[]): Promise<{ ok: boolean; skipped: number; message?: string }> {
  // 지원 source 만 필터 (direct/chat/task) — meeting/post 는 후속
  const supportedIds = fileIds.filter(id => /^(direct|chat|task)-\d+$/.test(id));
  const skipped = fileIds.length - supportedIds.length;
  if (supportedIds.length === 0) return { ok: false, skipped, message: 'no_supported_files' };

  const r = await apiFetch(`/api/files/${businessId}/bulk-download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: supportedIds }),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    return { ok: false, skipped, message: j.message || `http_${r.status}` };
  }
  const blob = await r.blob();
  const today = new Date().toISOString().slice(0, 10);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `planq-files-${today}.zip`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
  return { ok: true, skipped };
}

export async function fetchStorageStatus(businessId: number): Promise<StorageStatus> {
  const r = await apiFetch(`/api/files/${businessId}/storage`);
  const j = await r.json();
  if (!j.success) {
    return { provider: 'planq', bytes_used: 0, bytes_quota: 0, file_count: 0, plan: 'free' };
  }
  return j.data as StorageStatus;
}

// ─── Helpers (UI 전용) ───

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function extOf(name: string): string {
  const m = name.match(/\.([A-Za-z0-9]+)$/);
  return m ? m[1].toLowerCase() : '';
}

// 브라우저가 직접 렌더 가능한 이미지 확장자만 — heic/heif/raw/tiff 등은 미리보기 X, 파일 카드로.
// 사이클 N+23: HEIC(iPhone 기본) 업로드 시 깨진 이미지 아이콘 노출 회귀 차단.
const RENDERABLE_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico']);
const NON_RENDERABLE_IMAGE_MIMES = new Set([
  'image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence',
  'image/tiff', 'image/x-tiff',
  'image/x-canon-cr2', 'image/x-canon-cr3', 'image/x-nikon-nef', 'image/x-sony-arw', 'image/x-adobe-dng',
]);

export function isImage(mime: string | null, name: string): boolean {
  const m = (mime || '').toLowerCase();
  if (NON_RENDERABLE_IMAGE_MIMES.has(m)) return false;
  if (m.startsWith('image/')) return true;
  const ext = extOf(name);
  if (['heic', 'heif', 'tiff', 'tif', 'raw', 'cr2', 'cr3', 'nef', 'arw', 'dng'].includes(ext)) return false;
  return RENDERABLE_IMAGE_EXTS.has(ext);
}
