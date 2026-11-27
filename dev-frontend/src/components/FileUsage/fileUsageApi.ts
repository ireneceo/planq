// 파일 «연결된 곳» — 서버 services/fileUsage 한 벌을 읽는다 (2026-11-25 · docs/FILE_USAGE_DESIGN.md)
import { apiFetch } from '../../contexts/AuthContext';

export type UsageKind = 'post' | 'post_image' | 'event' | 'project' | 'invoice' | 'contact' | 'task' | 'chat';
export interface UsagePlace { kind: UsageKind; id: number; title: string; link: string }
export interface FileUsage { live: UsagePlace[]; copy: UsagePlace[]; hidden?: number }
export interface UsageSummary {
  files_with_live: number; live_places: number; copy_places: number;
  hidden_places?: number; top: UsagePlace[]; truncated: boolean;
}

export async function fetchFileUsage(businessId: number, fileId: number): Promise<FileUsage | null> {
  const r = await apiFetch(`/api/files/${businessId}/${fileId}/usage`);
  if (!r.ok) return null;
  const j = await r.json();
  return j?.success ? (j.data as FileUsage) : null;
}

export async function fetchUsageSummary(businessId: number, body: { file_ids?: number[]; folder_id?: number }): Promise<UsageSummary | null> {
  const r = await apiFetch(`/api/files/${businessId}/usage-summary`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j?.success ? (j.data as UsageSummary) : null;
}

/** 목록 행 → 원본 파일 번호. 직접 올린 행은 `direct-<id>`, 문서 첨부 행 등은 내려받기 주소에서 읽는다(업무·채팅 사본은 null). */
export function fileIdOfRow(row: { id: string | number; download_url?: string | null }): number | null {
  const m = /^direct-(\d+)$/.exec(String(row.id));
  if (m) return Number(m[1]);
  if (/^\d+$/.test(String(row.id))) return Number(row.id);
  const d = /\/api\/files\/\d+\/(\d+)\/download/.exec(String(row.download_url || ''));
  return d ? Number(d[1]) : null;
}

/** 공개 범위가 좁아지는가 — 등급이 내려가거나(L4>L3>L2>L1) L2 의 프로젝트가 바뀔 때. 넓히기는 묻지 않는다. */
export function isNarrowing(prev: { level?: string | null; projectId?: number | null; members?: number[] | null }, next: { level?: string | null; projectId?: number | null; members?: number[] | null }): boolean {
  const rank = (l?: string | null) => ({ L1: 1, L2: 2, L3: 3, L4: 4 } as Record<string, number>)[String(l || 'L3')] || 3;
  if (rank(next.level) < rank(prev.level)) return true;
  // «특정 멤버» 로 좁히거나 명단을 바꾸는 것도 좁힘이다(2026-11-27) — 명단 밖 사람에게서 연결된 곳이 닫힌다.
  const key = (m?: number[] | null) => [...(m || [])].sort((a, b) => a - b).join(',');
  if (next.level === 'L2' && (next.members || []).length > 0 && key(next.members) !== key(prev.members)) return true;
  if (next.level === 'L2' && prev.level === 'L2' && (next.projectId ?? null) !== (prev.projectId ?? null)) return true;
  return false;
}
