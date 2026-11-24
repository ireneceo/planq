// 워크스페이스 기능 켜짐 판정 — 화면 쪽 한 곳(서버 정본 dev-backend/services/modules.js · /api/auth/me 의 modules).
//   근태·휴가(attendance)는 기본 켜짐 — 옛 /me 응답에 키가 없으면 켜진 것으로 본다(서버 MODULE_DEFAULTS 와 같은 값).
type Mods = { payroll?: boolean; attendance?: boolean; doc_billing_terms?: boolean } | null | undefined;

export function attendanceOn(modules: Mods): boolean {
  return modules?.attendance !== false;
}

/**
 * 지금 워크스페이스에서 **내가** 출퇴근을 기록하는가 — 출퇴근 위젯·상태 요약·출근 묻기 창이 같이 쓴다.
 *   근태·휴가 켜짐 ∧ 직원(고객 아님) ∧ 이 워크스페이스에서 «출퇴근 안 함» 이 아님(/api/auth/me 의 attendance_tracked,
 *   서버 정본 services/attendanceTracking). 동료 근무 점(TeamPresenceRow·채팅)은 보는 사람이 아니라 각 사람의 tracked 로 가른다.
 */
export function attendanceTrackedHere(user: { business_id?: number | string | null; business_role?: string | null; modules?: Mods; attendance_tracked?: boolean } | null | undefined): boolean {
  if (!user || !user.business_id || user.business_role === 'client') return false;
  return attendanceOn(user.modules) && user.attendance_tracked !== false;
}
