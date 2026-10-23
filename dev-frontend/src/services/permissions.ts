// 멤버 권한 API (사이클 N+21)
// PERMISSION_MATRIX Layer 3 — 9 메뉴 × 3 레벨 + admin role 임명 + 기본 청구 담당
import { apiFetch } from '../contexts/AuthContext';

// 사이드바 메뉴 순서 + weekly_team (사이클 N+26 — 워크스페이스 통합 주간보고 보기, default 'none')
// insights / weekly_team 은 조회 전용 (write 의미 X).
export type MenuKey = 'qtalk' | 'qmail' | 'qsale' | 'qtask' | 'qcalendar' | 'qnote' | 'qdocs' | 'qinfo' | 'qfile' | 'qbill' | 'insights' | 'weekly_team';  // 'clients' 는 2026-10-16 폐지(qsale 로 합침)
export type PermissionLevel = 'none' | 'read' | 'write';
export type MemberRole = 'owner' | 'admin' | 'member' | 'ai';

export interface MemberPermissionRow {
  user_id: number;
  name: string;
  email: string;
  role: MemberRole;
  menus: Record<MenuKey, PermissionLevel>;
  /** 따로 정한 칸(행이 있는 칸). 나머지는 워크스페이스 «멤버 기본 권한» 을 따른다 (2026-10-23) */
  explicit?: Partial<Record<MenuKey, boolean>>;
}

export interface MembersPermissionsResponse {
  members: MemberPermissionRow[];
  valid_menus: MenuKey[];
  valid_levels: PermissionLevel[];
  /** 워크스페이스 «멤버 기본 권한» — 시스템 기본값 위에 워크스페이스가 정한 값을 얹은 전체 표 */
  member_defaults: Record<MenuKey, PermissionLevel>;
  system_defaults: Record<MenuKey, PermissionLevel>;
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

/** level 'default' = 따로 정한 칸을 지워 워크스페이스 기본값을 따르게 한다 */
export async function updateMemberPermission(businessId: number, userId: number, menu_key: MenuKey, level: PermissionLevel | 'default') {
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

/** 워크스페이스 «멤버 기본 권한» 한 칸 — 따로 정하지 않은 멤버 전원에게 즉시 적용. 'default' = 시스템 기본값으로 */
export async function updateMemberDefault(businessId: number, menu_key: MenuKey, level: PermissionLevel | 'default'): Promise<{ member_defaults: Record<MenuKey, PermissionLevel> }> {
  return j(await apiFetch(`/api/businesses/${businessId}/member-defaults`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ menu_key, level }),
  }));
}

// 같은 창 안의 권한 표·멤버 상세가 서로를 따라가게 — 저장한 쪽이 쏘고 다른 쪽이 다시 읽는다(다른 사람 창은 소켓 permissions:updated)
export const PERMISSIONS_CHANGED_EVENT = 'planq:permissions-changed';
export function emitPermissionsChanged(businessId: number) {
  try { window.dispatchEvent(new CustomEvent(PERMISSIONS_CHANGED_EVENT, { detail: { business_id: businessId } })); } catch { /* noop */ }
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
