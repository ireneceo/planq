// 프로젝트 파일 허브 서비스
// Phase 2 — 실 API 연결 완료

import { apiFetch } from '../contexts/AuthContext';

export type FileSource = 'direct' | 'chat' | 'task' | 'meeting';
export type StorageProvider = 'planq' | 'gdrive' | 'dropbox';

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
  external_id?: string | null;          // Drive/Dropbox 파일 id (외부 저장소)
  external_url?: string | null;         // Drive/Dropbox webViewLink
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

export async function fetchProjectFiles(projectId: number): Promise<ProjectFile[]> {
  const r = await apiFetch(`/api/projects/${projectId}/files`);
  const j = await r.json();
  if (!j.success) return [];
  return (j.data || []) as ProjectFile[];
}

export async function fetchWorkspaceFiles(businessId: number): Promise<ProjectFile[]> {
  const r = await apiFetch(`/api/projects/workspace/${businessId}/all-files`);
  const j = await r.json();
  if (!j.success) return [];
  return (j.data || []) as ProjectFile[];
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

export function isImage(mime: string | null, name: string): boolean {
  if (mime?.startsWith('image/')) return true;
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(extOf(name));
}
