// 역할 사전 API — 만드는·고치는 호출을 **한 곳**에 둔다(2026-10-15, docs/MEMBER_ROLES_DESIGN.md).
//   피커의 «추가», 관리창의 추가·이름 변경·삭제가 모두 이 함수를 쓴다(태그 createTaskTag 와 같은 이유 — 각자 적으면 갈라진다).
import { apiFetch } from '../../contexts/AuthContext';

export interface MemberRoleEntry {
  id: number;
  name: string;
  sort_order: number;
  usage_project?: number;
  usage_default?: number;
}

export interface RoleCallResult<T = unknown> { ok: boolean; data?: T; message?: string | null }

async function call<T>(url: string, init?: RequestInit): Promise<RoleCallResult<T>> {
  try {
    const r = await apiFetch(url, init);
    const j = await r.json().catch(() => null);
    return { ok: r.ok && !!j?.success, data: j?.data, message: j?.message || null };
  } catch { return { ok: false }; }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };
export const ROLE_MAX_LEN = 30;

export async function fetchMemberRoles(bizId: number): Promise<MemberRoleEntry[] | null> {
  const r = await call<MemberRoleEntry[]>(`/api/member-roles?business_id=${bizId}`);
  return r.ok && Array.isArray(r.data) ? r.data : null;
}

/** 역할을 만든다(이미 있으면 그 행). 실패하면 ok:false + 서버 메시지. */
export function createMemberRole(bizId: number, rawName: string) {
  const name = String(rawName || '').trim().slice(0, ROLE_MAX_LEN);
  if (!name) return Promise.resolve<RoleCallResult<MemberRoleEntry>>({ ok: false });
  return call<MemberRoleEntry>('/api/member-roles', {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ business_id: bizId, name }),
  });
}

export function renameMemberRole(id: number, name: string) {
  return call<MemberRoleEntry>(`/api/member-roles/${id}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ name }) });
}

export function deleteMemberRole(id: number) {
  return call(`/api/member-roles/${id}`, { method: 'DELETE' });
}
