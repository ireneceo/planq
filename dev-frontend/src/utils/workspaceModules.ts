// 워크스페이스 기능 켜짐 판정 — 화면 쪽 한 곳(서버 정본 dev-backend/services/modules.js · /api/auth/me 의 modules).
//   근태·휴가(attendance)는 기본 켜짐 — 옛 /me 응답에 키가 없으면 켜진 것으로 본다(서버 MODULE_DEFAULTS 와 같은 값).
type Mods = { payroll?: boolean; attendance?: boolean; doc_billing_terms?: boolean } | null | undefined;

export function attendanceOn(modules: Mods): boolean {
  return modules?.attendance !== false;
}
