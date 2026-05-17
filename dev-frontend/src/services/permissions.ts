// 멤버 권한 API (사이클 N+21)
// PERMISSION_MATRIX Layer 3 — 9 메뉴 × 3 레벨 + admin role 임명 + 기본 청구 담당
import { apiFetch } from '../contexts/AuthContext';

export type MenuKey = 'qtalk' | 'qtask' | 'qnote' | 'qdocs' | 'qbill' | 'qcalendar' | 'qfile' | 'clients' | 'insights';
export type PermissionLevel = 'none' | 'read' | 'write';
export type MemberRole = 'owner' | 'admin' | 'member' | 'ai';

export interface MemberPermissionRow {
  user_id: number;
  name: string;
  email: string;
  role: MemberRole;
  menus: Record<MenuKey, PermissionLevel>;
}

export interface MembersPermissionsResponse {
  members: MemberPermissionRow[];
  valid_menus: MenuKey[];
  valid_levels: PermissionLevel[];
}

export interface BillingOwnerCandidate {
  user_id: number; name: string; email: string;
  role: MemberRole; level: PermissionLevel;
}

const j = async (r: Response) => {
  const x = await r.json();
  if (!x.success) throw new Error(x.message || x.code || 'request_failed');
  return x.data;
};

export async function listMembersPermissions(businessId: number): Promise<MembersPermissionsResponse> {
  return j(await apiFetch(`/api/businesses/${businessId}/members-permissions`));
}

export async function updateMemberPermission(businessId: number, userId: number, menu_key: MenuKey, level: PermissionLevel) {
  return j(await apiFetch(`/api/businesses/${businessId}/members/${userId}/permissions`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ menu_key, level }),
  }));
}

export async function updateMemberRole(businessId: number, userId: number, role: 'admin' | 'member') {
  return j(await apiFetch(`/api/businesses/${businessId}/members/${userId}/role`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  }));
}

export async function listBillingOwnerCandidates(businessId: number): Promise<BillingOwnerCandidate[]> {
  return j(await apiFetch(`/api/businesses/${businessId}/billing-owner-candidates`));
}

export async function setDefaultBillingOwner(businessId: number, userId: number | null) {
  return j(await apiFetch(`/api/businesses/${businessId}/default-billing-owner`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId }),
  }));
}
