// #63 데이터 내보내기 — 본인 L1 자료 / 워크스페이스 백업 zip.
// blob 다운로드는 files.ts bulkDownloadZip 패턴 재사용.
import { apiFetch } from '../contexts/AuthContext';

export interface ExportPreview {
  files: number;
  documents: number;
  total_bytes: number;
  confidential_count: number;
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
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
  return { ok: true };
}

export function exportMyData(businessId: number) {
  const today = new Date().toISOString().slice(0, 10);
  return downloadZip(`/api/export/${businessId}/me`, `planq-export-me-${today}.zip`);
}

export function exportWorkspaceData(businessId: number) {
  const today = new Date().toISOString().slice(0, 10);
  return downloadZip(`/api/export/${businessId}/workspace`, `planq-export-workspace-${today}.zip`);
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
