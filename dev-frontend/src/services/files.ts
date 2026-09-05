// 프로젝트 파일 허브 서비스
// Phase 2 — 실 API 연결 완료

import { apiFetch, apiUpload } from '../contexts/AuthContext';
import type { UploadProgress } from '../contexts/AuthContext';
import { downloadBlob } from '../utils/download';

export type FileSource = 'direct' | 'chat' | 'task' | 'meeting' | 'post';
export type StorageProvider = 'planq' | 'gdrive';

export interface ProjectContext {
  id: number;
  name: string;
  color?: string | null;
}

/**
 * 이 파일을 **새 탭에서 원본 그대로** 열 수 있는가.
 *
 *   서버의 `services/fileServing.js` `isSafeInline()` 을 그대로 비춘 술어다 —
 *   액티브 콘텐츠(html·svg·xml·js…)는 서버가 언제나 `attachment` 로 내보내므로
 *   새 탭을 열어 봐야 다운로드가 시작될 뿐이다(2026-09-02 `.html` 렌더 사고로 만든 게이트).
 *   ★ 서버 쪽을 고치면 여기도 같이 고친다. 두 술어가 갈라지면 "열기" 가 거짓말이 된다.
 */
export function canOpenInNewTab(f: Pick<ProjectFile, 'mime_type' | 'file_name' | 'storage_provider' | 'external_url'>): boolean {
  // 외부 클라우드 원본은 그쪽 뷰어로 연다.
  if (f.storage_provider === 'gdrive' && f.external_url) return true;
  const ext = (f.file_name.split('.').pop() || '').toLowerCase();
  if (['html', 'htm', 'xhtml', 'shtml', 'svg', 'svgz', 'xml', 'js', 'mjs', 'mhtml', 'mht', 'eml', 'htc', 'xsl', 'xslt'].includes(ext)) return false;
  const m = (f.mime_type || '').toLowerCase().split(';')[0].trim();
  if (['text/html', 'image/svg+xml', 'application/xhtml+xml', 'text/xml', 'application/xml', 'text/javascript', 'application/javascript', 'message/rfc822'].includes(m)) return false;
  return m.startsWith('image/') || m.startsWith('video/') || m.startsWith('audio/')
    || m === 'application/pdf' || m === 'text/plain';
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
  project_context?: ProjectContext | null;
  folder_id: number | null;
  deletable: boolean;
  storage_provider: StorageProvider;
  external_id?: string | null;
  external_url?: string | null;
  // #379 — Drive 사본이 지워져 미러가 끊긴 상태(원본은 PlanQ 에 그대로 있다)
  gdrive_mirror_id?: string | null;
  gdrive_unmirrored?: boolean;
  // N+67 — visibility 필드 (source='direct' 일 때만 변경 가능)
  visibility?: 'L1' | 'L2' | 'L3' | 'L4' | null;
  security_level?: 'general' | 'internal' | 'confidential';  // D4 #62
  project_id?: number | null;
  // 검색용 메타 — 파일명만으로 못 찾는 자료(영상·스캔본)를 위해
  description?: string | null;
  tags?: string[] | null;
}

/** 파일 메타(이름·설명·태그) 편집. 권한은 삭제와 같은 술어(본인 업로드·오너·PM). */
export async function updateFileMeta(
  businessId: number,
  fileId: string,
  patch: { file_name?: string; description?: string | null; tags?: string[] },
): Promise<{ file_name: string; description: string | null; tags: string[] } | null> {
  const parsed = parseFileId(fileId);
  if (!parsed || parsed.source !== 'direct') return null;
  const r = await apiFetch(`/api/files/${businessId}/${parsed.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  if (!j?.success || !j?.data) return null;
  return { file_name: j.data.file_name, description: j.data.description ?? null, tags: j.data.tags || [] };
}

// N+67 — File visibility 변경 API
export async function updateFileVisibility(
  businessId: number,
  fileId: number,
  body: { level: 'L1' | 'L2' | 'L3' | 'L4'; project_id?: number }
): Promise<{ id: number; visibility: string; project_id: number | null }> {
  const r = await apiFetch(`/api/files/${businessId}/${fileId}/visibility`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'visibility_change_failed');
  return j.data;
}

// D4 #62 — 파일 보안등급 변경 (general/internal/confidential). 일반 외로 상향 시 외부 공유 링크 무효화.
export type FileSecurityLevel = 'general' | 'internal' | 'confidential';
export async function updateFileSecurityLevel(
  businessId: number,
  fileId: number,
  level: FileSecurityLevel,
): Promise<{ id: number; security_level: FileSecurityLevel; revoked_share: boolean }> {
  const r = await apiFetch(`/api/files/${businessId}/${fileId}/security-level`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level }),
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'security_level_change_failed');
  return j.data;
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
// 'direct-12' 같은 합성 id 에서 숫자 id 를 꺼낸다.
//   ★ 호출부에서 Number(id) 로 때우면 안 된다 — 'direct-12' 는 NaN 이 되고, 그 NaN 이 URL 에
//     그대로 실려 존재하지 않는 경로를 때린다(운영 #390: 공유 링크가 아예 안 만들어지던 정체).
export function parseFileId(composite: string): { source: FileSource; id: number } | null {
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
    if (!j.success) {
      // ★ 첫 페이지부터 실패한 것은 "결과가 없음" 이 아니라 **못 불러온 것**이다.
      //   여태는 빈 배열을 돌려줘서 화면이 "아직 파일이 없어요" 를 띄웠고,
      //   사용자는 파일이 사라진 것으로 읽었다(500 재현으로 실측).
      //   2페이지 이후 실패는 부분 성공이라 있는 만큼 돌려준다(종전 동작 유지).
      if (page === 1) throw new Error(j.message || `HTTP ${r.status}`);
      break;
    }
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
    preview_url?: string;
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
    preview_url: f.preview_url,   // 이미지 썸네일 — 어댑터가 버리면 카드가 빈 채로 렌더된다
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

// ─── 워크스페이스 폴더 (프로젝트에 속하지 않는 파일) — Irene 2026-08-31 ────────
//   운영 파일의 95% 가 프로젝트 없는 파일인데 여태 폴더를 만들 길이 없었다.
//   이름 변경·삭제·순서는 id 기반 공용 라우트를 그대로 쓴다(아래).
export async function fetchWorkspaceFolders(businessId: number): Promise<FileFolder[]> {
  const r = await apiFetch(`/api/folders/workspace/${businessId}`);
  if (!r.ok) return [];
  const j = await r.json();
  return j.success ? ((j.data || []) as FileFolder[]) : [];
}

export async function createWorkspaceFolder(businessId: number, name: string, parentId: number | null): Promise<FileFolder> {
  const r = await apiFetch(`/api/folders/workspace/${businessId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parent_id: parentId }),
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

// 업로드 응답 안전 파싱.
//   nginx 의 413(Request Entity Too Large)은 **HTML 페이지**로 온다 — r.json() 이 SyntaxError 를 던진다.
//   호출부(문서 저장 등)가 그 예외를 삼키지 못하면 "파일 하나 때문에 글 저장 전체가 실패" 로 번진다.
//   실제 신고(#365): Q docs 에 영상을 첨부하면 문서 저장이 안 됐다.
//
//   message 는 **코드**만 돌려준다 (사용자 문구는 화면에서 t() 로 만든다).
// ★ 영상 등 큰 파일 정책 (Irene 확정 2026-08-24)
//   "영상은 Drive 에만 업로드되는 걸로 안내하고, 기준 이상은 Drive 를 연결해야 한다고 안내하고,
//    연결되어 있으면 Drive 에만 올리면 되지 않아?"
//
//   자체 스토리지 경로는 앞단 nginx `client_max_body_size` 와 플랜 파일당 한도에 걸린다.
//   그 한도를 넘는 파일은 **외부 클라우드(Drive)로만** 올릴 수 있다 — 백엔드 plan.can('upload_file')
//   이 이미 `ctx.external` 이면 플랜 한도·쿼터를 건너뛰고 5GB 까지 허용한다.
//   여기서 올리기 **전에** 걸러 사용자에게 이유와 다음 행동을 말한다.
//   (여태는 nginx 가 413 HTML 을 돌려주고 화면은 아무 말도 못 해 "그냥 안 됨" 으로 보였다.)
export const SELF_STORAGE_MAX_BYTES = 50 * 1024 * 1024;   // nginx client_max_body_size 와 같은 축

/** 자체 스토리지로 올릴 수 없는 크기인가 — 넘으면 Drive 연결이 필요하다. */
export function needsDriveForSize(bytes: number): boolean {
  return Number(bytes || 0) > SELF_STORAGE_MAX_BYTES;
}

async function readUploadResponse(r: Response): Promise<{ ok: true; data: any } | { ok: false; message: string }> {
  let j: any = null;
  try {
    j = await r.json();
  } catch {
    // JSON 이 아니다 = 프록시/서버가 낸 오류 페이지 (대표적으로 nginx 413)
    return { ok: false, message: r.status === 413 ? 'file_size_exceeded' : `upload_failed_${r.status}` };
  }
  if (!r.ok || !j?.success || !j?.data) {
    return { ok: false, message: j?.message || `upload_failed_${r.status}` };
  }
  return { ok: true, data: j.data };
}

/** 업로드 진행률·취소 옵션 — 두 업로드 경로 공통 */
export interface UploadHooks {
  onProgress?: (p: UploadProgress) => void;
  signal?: AbortSignal;
}

export async function uploadProjectFile(
  businessId: number,
  projectId: number,
  file: File,
  options?: { folderId?: number | null } & UploadHooks
): Promise<UploadResult> {
  if (needsDriveForSize(file.size)) return { success: false, message: 'needs_drive_for_large_file' };
  const fd = new FormData();
  fd.append('file', file);
  fd.append('project_id', String(projectId));
  if (options?.folderId != null) fd.append('folder_id', String(options.folderId));

  const r = await apiUpload(`/api/files/${businessId}`, fd,
    { onProgress: options?.onProgress, signal: options?.signal });
  const parsed = await readUploadResponse(r);
  if (!parsed.ok) return { success: false, message: parsed.message };

  const f = parsed.data;
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
  opts?: { conversationId?: number | null; projectId?: number | null } & UploadHooks
): Promise<UploadResult> {
  if (needsDriveForSize(file.size)) return { success: false, message: 'needs_drive_for_large_file' };
  const fd = new FormData();
  fd.append('file', file);
  if (opts?.conversationId) fd.append('conversation_id', String(opts.conversationId));
  if (opts?.projectId) fd.append('project_id', String(opts.projectId));
  const r = await apiUpload(`/api/files/${businessId}`, fd,
    { onProgress: opts?.onProgress, signal: opts?.signal });
  const parsed = await readUploadResponse(r);
  if (!parsed.ok) return { success: false, message: parsed.message };
  const f = parsed.data;
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

// ─── 휴지통 ─────────────────────────────────────────────────────
//
// 지운 파일을 되돌리는 경로. 여태 삭제는 되돌릴 방법이 없었다(복구 라우트도 화면도 0건).
// 서버가 행마다 `restorable` 을 정직하게 실어 준다 — 눌러도 안 되는 버튼을 만들지 않기 위해.

export interface TrashedFile {
  id: number;
  file_name: string;
  file_size: number;
  mime_type: string | null;
  deleted_at: string;
  /** 되돌릴 수 있는가. 서버가 바이트 실존까지 보고 판정한 값이다. */
  restorable: boolean;
  /** 이 시각이 지나면 자동으로 비워진다 */
  purge_after: string | null;
  deleter?: { id: number; name: string } | null;
  uploader?: { id: number; name: string } | null;
  project_id?: number | null;
}

export interface TrashPage {
  items: TrashedFile[];
  total: number;
  /** 이 워크스페이스의 휴지통 보관기간(일). null = 서버가 판단 못 함 → 화면은 보관 문구를 숨긴다.
   *  30 같은 숫자를 폴백으로 두면 요금제와 다른 값을 사용자에게 단언하게 된다. */
  retentionDays: number | null;
}

export async function fetchTrash(businessId: number, opts?: { projectId?: number }): Promise<TrashPage> {
  const q = opts?.projectId ? `&project_id=${opts.projectId}` : '';
  const r = await apiFetch(`/api/files/${businessId}/trash?limit=200${q}`);
  const j = await r.json();
  if (!r.ok || !j.success) return { items: [], total: 0, retentionDays: null };
  return {
    items: (j.data || []) as TrashedFile[],
    total: j.pagination?.total ?? (j.data || []).length,
    retentionDays: j.pagination?.retention_days ?? null,
  };
}

/** 복구. 실패 사유를 그대로 돌려준다 — 조용히 실패하면 사용자는 눌렀는데 아무 일도 안 난 것으로 본다. */
export async function restoreFile(businessId: number, fileId: number): Promise<{ ok: boolean; reason?: string }> {
  const r = await apiFetch(`/api/files/${businessId}/${fileId}/restore`, { method: 'POST' });
  const j = await r.json().catch(() => ({}));
  if (r.ok && j.success) return { ok: true };
  return { ok: false, reason: j.message || `HTTP ${r.status}` };
}

export async function purgeFile(businessId: number, fileId: number): Promise<boolean> {
  const r = await apiFetch(`/api/files/${businessId}/${fileId}/purge`, { method: 'DELETE' });
  const j = await r.json().catch(() => ({}));
  return r.ok && !!j.success;
}

export async function emptyTrash(businessId: number): Promise<{ purged: number; skipped: number }> {
  const r = await apiFetch(`/api/files/${businessId}/trash/empty`, { method: 'POST' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.success) return { purged: 0, skipped: 0 };
  return { purged: j.data?.purged ?? 0, skipped: j.data?.skipped ?? 0 };
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
  await downloadBlob(blob, `planq-files-${today}.zip`);
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

// ─── #228 파일 드래그 아웃 — 5분 서명 URL 발급 ───
//
// OS 로 파일을 빼내려면 dragstart 에서 dataTransfer 에 'DownloadURL' 을 넣어야 하는데, 브라우저는 그
// URL 을 **인증 헤더 없이** 따로 가져간다. 그래서 인증 다운로드 URL 은 쓸 수 없고, 5분짜리 서명 URL 을
// 서버에서 받아 쓴다. 발급은 자체 스토리지의 'direct' 파일만 (backend 가 다시 한 번 막는다).
export async function issueDragUrl(businessId: number, fileId: string): Promise<string | null> {
  const parsed = parseFileId(fileId);
  if (!parsed || parsed.source !== 'direct') return null;
  const r = await apiFetch(`/api/files/${businessId}/${parsed.id}/drag-url`, { method: 'POST' });
  // apiFetch 는 실패해도 throw 하지 않는다 — res.ok 를 안 보면 실패가 성공인 척 지나간다.
  if (!r.ok) return null;
  const j = await r.json();
  if (!j.success || !j.data?.url) return null;
  return j.data.url as string;
}

// 브라우저가 직접 렌더 가능한 이미지 확장자만 — heic/heif/raw/tiff 등은 미리보기 X, 파일 카드로.
// 사이클 N+23: HEIC(iPhone 기본) 업로드 시 깨진 이미지 아이콘 노출 회귀 차단.
// 브라우저가 <video>/<audio> 로 재생할 수 있는 형식.
//   mp4(H.264)·webm·ogg 는 표준. mov 는 컨테이너만 다르고 대개 H.264 라 사파리·크롬에서 재생된다.
//   재생이 안 되면 <video> 가 onError 를 내고 화면은 자동으로 "다운로드 후 확인" 으로 내려간다.
const PLAYABLE_VIDEO_EXTS = new Set(['mp4', 'm4v', 'webm', 'ogv', 'mov']);
const PLAYABLE_AUDIO_EXTS = new Set(['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'webm']);

export function isVideo(mime: string | null, name: string): boolean {
  if ((mime || '').toLowerCase().startsWith('video/')) return true;
  return PLAYABLE_VIDEO_EXTS.has(extOf(name));
}

export function isAudio(mime: string | null, name: string): boolean {
  const m = (mime || '').toLowerCase();
  if (m.startsWith('video/')) return false;
  if (m.startsWith('audio/')) return true;
  if (m) return false;
  return PLAYABLE_AUDIO_EXTS.has(extOf(name));
}

/**
 * 인앱 재생용 서명 URL 발급.
 * `<video src>` 에는 Authorization 헤더를 실을 수 없어서 서버가 짧은 수명의 서명 URL 을 준다.
 * 실패(권한·외부 스토리지·재생 불가 형식)하면 null → 호출부는 미리보기를 내리고 다운로드로 안내한다.
 */
export async function requestMediaUrl(businessId: number, fileId: string): Promise<string | null> {
  const parsed = parseFileId(fileId);
  if (!parsed || parsed.source !== 'direct') return null;
  const r = await apiFetch(`/api/files/${businessId}/${parsed.id}/media-url`, { method: 'POST' });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  return j?.success && j?.data?.url ? String(j.data.url) : null;
}

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
