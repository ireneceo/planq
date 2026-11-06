// 워크스페이스 참여 신청 API — «시작하기»(/welcome) · 설정 › 멤버 «참여 신청» · 설정 › 일반 «멤버 참여» 가 같이 쓴다.
//   설계 docs/SIGNUP_START_JOIN_DESIGN.md §5·§6 (2026-11-06).
import { apiFetch } from '../contexts/AuthContext';

export interface JoinRequestView {
  id: number;
  status: 'pending' | 'approved' | 'rejected' | 'canceled' | 'expired';
  requested_at: string;
  expires_at: string;
  retry_after: string | null;
  decision_note: string | null;
}
export interface JoinWorkspaceCard { business_id: number; brand_name: string; brand_logo_url: string | null; request: JoinRequestView | null; already_member?: boolean }
export interface JoinSettings {
  join_by_domain: boolean; join_domain: string | null; domain_open: boolean; owner_domains: string[];
  code_enabled: boolean; join_code: string | null; join_code_rotated_at: string | null; pending_count: number;
}
export interface PendingJoinRequest {
  id: number; source: 'domain' | 'code'; message: string | null; requested_at: string; expires_at: string; expired: boolean;
  user: { id: number; name: string; email: string; avatar_url: string | null } | null;
}

/** 실패는 던진다 — message(서버 코드)와 status 를 싣는다. */
export class JoinApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) { super(String(body?.message || `HTTP ${status}`)); this.status = status; this.body = body; }
}
async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await apiFetch(url, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.success) throw new JoinApiError(r.status, j || {});
  return j.data as T;
}
const json = (method: string, body?: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

export const getJoinSuggestions = () => call<{ domains: string[]; workspaces: JoinWorkspaceCard[] }>('/api/join/suggestions');
export const lookupJoinCode = (code: string) => call<JoinWorkspaceCard>('/api/join/lookup', json('POST', { code }));
export const requestJoin = (p: { business_id: number; source: 'domain' | 'code'; code?: string; message?: string }) =>
  call<{ id: number; status: 'pending'; expires_at: string }>('/api/join/requests', json('POST', p));
export const getMyJoinRequests = () => call<JoinWorkspaceCard[]>('/api/join/requests/mine');
export const cancelJoinRequest = (id: number) => call<{ id: number }>(`/api/join/requests/${id}`, { method: 'DELETE' });

export const getJoinRequests = (bizId: number) => call<{ requests: PendingJoinRequest[]; seats_remaining: number | null }>(`/api/businesses/${bizId}/join-requests`);
export const approveJoinRequest = (bizId: number, rid: number, role: 'member' | 'admin') =>
  call<{ id: number; role: string }>(`/api/businesses/${bizId}/join-requests/${rid}/approve`, json('POST', { role }));
export const rejectJoinRequest = (bizId: number, rid: number, note?: string) =>
  call<{ id: number }>(`/api/businesses/${bizId}/join-requests/${rid}/reject`, json('POST', { note }));

export const getJoinSettings = (bizId: number) => call<JoinSettings>(`/api/businesses/${bizId}/join-settings`);
export const putJoinSettings = (bizId: number, p: { join_by_domain?: boolean; join_domain?: string; code_enabled?: boolean }) =>
  call<JoinSettings>(`/api/businesses/${bizId}/join-settings`, json('PUT', p));
export const rotateJoinCode = (bizId: number) => call<JoinSettings>(`/api/businesses/${bizId}/join-settings/rotate-code`, json('POST', {}));
