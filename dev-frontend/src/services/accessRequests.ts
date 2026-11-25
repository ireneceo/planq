// 열람 요청 · 잠금 줄 · «검색에서 숨김» — 서버 routes/access_requests.js (2026-11-25 · docs/FILE_SEARCH_DISCOVERY_DESIGN.md)
import { apiFetch } from '../contexts/AuthContext';

export type LockedKind = 'file' | 'post';
export interface LockedItem {
  id: number;
  name: string;
  kind: LockedKind;
  owner: { id: number; name: string | null };
  locked: true;
  request: { id: number; status: 'pending' | 'denied' } | null;
}
export interface InboxItem {
  id: number;
  status: 'pending' | 'approved';
  entity_type: LockedKind;
  entity_id: number;
  name: string | null;
  missing: boolean;
  requester: { id: number; name: string | null };
  message: string | null;
  created_at: string;
  decided_at: string | null;
}

async function json<T>(r: Response): Promise<T> {
  const j = await r.json().catch(() => null);
  if (!j || !j.success) { const e = new Error((j && j.message) || 'failed'); (e as Error & { status?: number }).status = r.status; throw e; }
  return j.data as T;
}

export async function fetchLocked(businessId: number, q: string, types: LockedKind[] = ['file', 'post']) {
  return json<{ enabled: boolean; files: LockedItem[]; posts: LockedItem[] }>(
    await apiFetch(`/api/access-requests/${businessId}/locked?q=${encodeURIComponent(q)}&types=${types.join(',')}`));
}
export async function requestAccess(businessId: number, kind: LockedKind, id: number, message?: string) {
  return json<{ id: number; status: string; already: boolean }>(await apiFetch(`/api/access-requests/${businessId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entity_type: kind, entity_id: id, ...(message ? { message } : {}) }),
  }));
}
export async function fetchInbox(businessId: number) {
  return json<{ pending: InboxItem[]; approved: InboxItem[] }>(await apiFetch(`/api/access-requests/${businessId}/inbox`));
}
export async function decideRequest(businessId: number, id: number, action: 'approve' | 'deny' | 'revoke' | 'cancel', note?: string) {
  return json<{ id: number; status: string }>(await apiFetch(`/api/access-requests/${businessId}/${id}/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(note ? { note } : {}),
  }));
}
export async function fetchDiscoverySetting(businessId: number) {
  return json<{ restricted_discoverable: boolean; can_edit: boolean }>(await apiFetch(`/api/access-requests/${businessId}/settings`));
}
export async function saveDiscoverySetting(businessId: number, on: boolean) {
  return json<{ restricted_discoverable: boolean }>(await apiFetch(`/api/access-requests/${businessId}/settings`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ restricted_discoverable: on }),
  }));
}
export async function setHideExistence(businessId: number, kind: LockedKind, id: number, hide: boolean) {
  return json<{ id: number; hide_existence: boolean }>(await apiFetch(`/api/access-requests/${businessId}/hide/${kind}/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hide }),
  }));
}

// 설정 값은 화면 여러 곳(숨김 칸)이 묻는다 — 워크스페이스마다 한 번만 읽는다(바꾸면 비운다).
const settingCache = new Map<number, Promise<boolean>>();
export function discoveryEnabled(businessId: number): Promise<boolean> {
  if (!settingCache.has(businessId)) {
    settingCache.set(businessId, fetchDiscoverySetting(businessId).then((d) => d.restricted_discoverable).catch(() => false));
  }
  return settingCache.get(businessId) as Promise<boolean>;
}
export function forgetDiscoverySetting(businessId: number) { settingCache.delete(businessId); }
