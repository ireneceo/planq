// 고객을 «관리» 하는 손(추가·초대·직접 관리 등록)을 누가 보나 — 한 곳.
//   Q sale 고객 탭 · 설정 > 구성원·고객 · 프로젝트 > 고객 이 같은 술어를 쓴다(2026-10-22 Fable 판정 3·4).
//   서버는 requireMenu('qsale','write') 로 막는다 — 화면은 옛 설정 > 고객 과 같은 선(대표·플랫폼 관리자)만 문을 보인다.
interface U { business_role?: string | null; platform_role?: string | null }
export function canManageClients(user: U | null | undefined): boolean {
  return user?.business_role === 'owner' || user?.platform_role === 'platform_admin';
}
