// 워크스페이스 0개 계정의 착지 — «시작하기»(/welcome) (2026-11-06 · docs/SIGNUP_START_JOIN_DESIGN.md D2, Fable 설계).
//   가입은 이제 계정만 만든다. 0개 상태는 원래 성립하던 상태(빈 대시보드)였는데 착지가 없었다 — 여기 한 곳이 판정한다.
//   ProtectedRoute(셸) 와 ModeGate(탭 셸 진입 전 — 0개면 셸로 그려 이 규칙을 탄다)가 같이 쓴다.

interface MinimalUser { platform_role?: string | null; workspaces?: unknown[] | null }

/** 0개여도 열리는 곳 — 계정·초대·인증·알림·도움말·시작하기 자신. */
const ALLOWED_PREFIXES = ['/welcome', '/profile', '/invite', '/oauth', '/verify-email', '/notifications', '/guide'];

export function needsWelcome(user: MinimalUser | null | undefined): boolean {
  if (!user) return false;
  if (user.platform_role === 'platform_admin') return false;
  return !Array.isArray(user.workspaces) || user.workspaces.length === 0;
}

export function isWelcomeAllowedPath(pathname: string): boolean {
  return ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}
