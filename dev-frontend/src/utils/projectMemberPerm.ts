// 프로젝트 멤버 구성(추가·빼기·PM·역할)을 바꿀 수 있는가 — 서버 services/projectAccess.canManageProjectMembers 와 같은 술어.
//   워크스페이스 대표·관리자·플랫폼 관리자 (2026-11-16 Irene «권고대로» — 관리자 추가 · Fable 설계).
//   화면 두 곳(프로젝트 상세 멤버 칸 · 채팅 설정 참여자 힌트)이 이 함수 하나를 쓴다.
export function canManageProjectMembers(user: { business_role?: string | null; platform_role?: string | null } | null | undefined): boolean {
  if (!user) return false;
  const r = String(user.business_role || '');
  return user.platform_role === 'platform_admin' || r === 'owner' || r === 'admin';
}
