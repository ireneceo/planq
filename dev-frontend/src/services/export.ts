// #63 데이터 내보내기 — 본인 L1 자료 / 워크스페이스 백업 zip.
// blob 다운로드는 files.ts bulkDownloadZip 패턴 재사용.
import { apiFetch } from '../contexts/AuthContext';
import { downloadBlob } from '../utils/download';

export interface ExportPreview {
  files: number;
  documents: number;
  total_bytes: number;
  confidential_count: number;
  // 워크스페이스 백업 미리보기만 — 영역별 행 수 · 포함/제외 목록(서버 services/exportSerializers 한 원천)
  data?: Record<string, number>;
  coverage?: { included: string[]; excluded: { area: string; reason: string }[] };
  running_job_id?: number | null;
}

export async function fetchMyExportPreview(businessId: number): Promise<ExportPreview> {
  const r = await apiFetch(`/api/export/${businessId}/me/preview`);
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'failed');
  return j.data as ExportPreview;
}

export async function fetchWorkspaceExportPreview(businessId: number): Promise<ExportPreview> {
  const r = await apiFetch(`/api/export/${businessId}/workspace/preview`);
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'failed');
  return j.data as ExportPreview;
}

async function downloadZip(path: string, fileName: string): Promise<{ ok: boolean; message?: string }> {
  const r = await apiFetch(path, { method: 'POST' });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    return { ok: false, message: j.message || `http_${r.status}` };
  }
  const blob = await r.blob();
  await downloadBlob(blob, fileName);
  return { ok: true };
}

export function exportMyData(businessId: number) {
  const today = new Date().toISOString().slice(0, 10);
  return downloadZip(`/api/export/${businessId}/me`, `planq-export-me-${today}.zip`);
}

// 워크스페이스 백업 — 2026-10-23 부터 백그라운드 작업(완료되면 알림 + 작업 내역에서 다운로드).
export async function createWorkspaceExportJob(businessId: number): Promise<{ ok: boolean; message?: string }> {
  const r = await apiFetch(`/api/export/${businessId}/workspace`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.success) return { ok: false, message: j.message || `http_${r.status}` };
  return { ok: true };
}

// Phase 2 (#63) — 워크스페이스 간 이전 (복사, 원본 유지)
export interface TransferTarget { id: number; name: string; }

export async function fetchTransferTargets(businessId: number): Promise<TransferTarget[]> {
  const r = await apiFetch(`/api/export/${businessId}/me/transfer-targets`);
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'failed');
  return j.data as TransferTarget[];
}

export async function transferMyData(businessId: number, targetBusinessId: number): Promise<{ files_copied: number; documents_copied: number; skipped: number }> {
  const r = await apiFetch(`/api/export/${businessId}/me/transfer`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_business_id: targetBusinessId }),
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'failed');
  return j.data;
}

// ─── Phase 3 (#63) — 비동기 job: 이동/복사(+Q Note) · 대용량 export ───
export interface ExportJob {
  id: number;
  kind: 'transfer' | 'export';
  scope?: 'me' | 'workspace';
  mode: 'copy' | 'move' | null;
  status: 'queued' | 'running' | 'done' | 'failed';
  target_business_id: number | null;
  include_qnote: boolean;
  result: { files_copied?: number; documents_copied?: number; qnote_copied?: number; files_removed?: number; documents_removed?: number; skipped?: number; bytes?: number } | null;
  error: string | null;
  has_download: boolean;
  download_token?: string | null;
  created_at: string;
  done_at: string | null;
}

export async function createTransferJob(
  businessId: number,
  opts: { target_business_id: number; mode: 'copy' | 'move'; include_qnote: boolean },
): Promise<{ job_id: number; status: string }> {
  const r = await apiFetch(`/api/export/${businessId}/me/transfer-job`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts),
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'failed');
  return j.data;
}

export async function createExportJob(businessId: number, includeQnote: boolean): Promise<{ job_id: number; status: string }> {
  const r = await apiFetch(`/api/export/${businessId}/me/export-job`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ include_qnote: includeQnote }),
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'failed');
  return j.data;
}

export async function fetchExportJobs(businessId: number): Promise<ExportJob[]> {
  const r = await apiFetch(`/api/export/${businessId}/me/jobs`);
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'failed');
  return j.data as ExportJob[];
}

export async function downloadExportJob(businessId: number, jobId: number, token: string): Promise<{ ok: boolean; message?: string }> {
  return downloadZipGet(`/api/export/${businessId}/me/jobs/${jobId}/download?token=${encodeURIComponent(token)}`, `planq-export-${jobId}.zip`);
}

export async function deleteExportJob(businessId: number, jobId: number): Promise<void> {
  const r = await apiFetch(`/api/export/${businessId}/me/jobs/${jobId}`, { method: 'DELETE' });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'failed');
}

async function downloadZipGet(path: string, fileName: string): Promise<{ ok: boolean; message?: string }> {
  const r = await apiFetch(path);
  if (!r.ok) { const j = await r.json().catch(() => ({})); return { ok: false, message: j.message || `http_${r.status}` }; }
  const blob = await r.blob();
  await downloadBlob(blob, fileName);
  return { ok: true };
}
