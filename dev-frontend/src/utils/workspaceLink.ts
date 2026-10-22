// 워크스페이스가 실린 링크(?ws=<business_id>) — 처음 한 번 전환하고 그 화면으로 바로 간다 (2026-10-13)
//
// Irene: *"알림을 누르면 다른 워크스페이스로 갈 경우 채팅방 제대로 안열리고 리스트로 열려.
//         가는 것도 이상하게 보이고. 모든 경로가 워크스페이스 다른 경우 처음만 딱 다르게 제대로 디렉션 해줘."*
//
// 푸시·메일은 모든 워크스페이스의 알림이 한 기기·한 메일함으로 온다. 링크가 경로뿐이면 앱은 지금
// 워크스페이스 안에서 그 id 를 찾다가 목록으로 떨어지거나 «전환해서 열기» 안내를 띄웠다.
// 서버(services/notification_link.withWorkspace)가 밖으로 나가는 링크에 `ws` 를 싣고, 화면은
// **그리기 전에** 여기서 판정한다:
//   ws 가 지금 워크스페이스 → ws 만 떼고 그대로
//   ws 가 내가 멤버인 다른 워크스페이스 → 전환 → ws 를 뗀 주소로 한 번 다시 연다(전환은 원래 재부팅이다 — WorkspaceSyncGuard)
//   그 밖(모르는 값·멤버 아님·전환 실패) → ws 만 떼고 그대로(화면의 기존 «다른 워크스페이스» 판정이 받는다)
// ★ ws 를 믿지 않는다 — 전환 가능 여부는 서버(/api/auth/switch-workspace)가 다시 판정한다.
// 부르는 곳: App.tsx ModeGate(문서 로드 — 웹 푸시·메일·주소 입력) · NativeBridge.deepLinkNav(앱 알림 탭 — SPA 이동).

import { journalStep } from '../services/navDiag';
import { getRequestWorkspaceId } from '../contexts/AuthContext';

export const WS_PARAM = 'ws';

type UserLike = {
  business_id?: number | null;
  workspaces?: Array<{ business_id: number }> | null;
} | null | undefined;

/** 경로에서 ws 를 읽고, ws 를 뗀 경로를 돌려준다. ws 가 없으면 ws=null, clean=원래 경로 */
export function splitWorkspaceParam(path: string): { ws: number | null; clean: string; had: boolean } {
  try {
    const u = new URL(path, window.location.origin);
    if (!u.searchParams.has(WS_PARAM)) return { ws: null, clean: path, had: false };
    const n = Number(u.searchParams.get(WS_PARAM));
    u.searchParams.delete(WS_PARAM);
    const clean = u.pathname + (u.search || '') + (u.hash || '');
    return { ws: Number.isInteger(n) && n > 0 ? n : null, clean, had: true };
  } catch {
    return { ws: null, clean: path, had: false };
  }
}

/** 이 경로가 «내가 멤버인 다른 워크스페이스» 를 가리키면 그 id, 아니면 null */
export function foreignWorkspaceOf(path: string, user: UserLike): number | null {
  const { ws } = splitWorkspaceParam(path);
  if (!ws || !user) return null;
  if (Number(user.business_id) === ws) return null;
  const member = (user.workspaces || []).some((w) => Number(w.business_id) === ws);
  return member ? ws : null;
}

/** 현재 주소창에서 ws 만 지운다(히스토리 칸을 늘리지 않는다) */
export function stripWorkspaceParamFromLocation(): void {
  try {
    const here = window.location.pathname + window.location.search + window.location.hash;
    const { had, clean } = splitWorkspaceParam(here);
    if (had) window.history.replaceState(window.history.state, '', clean);
  } catch { /* noop */ }
}

/**
 * 다른 워크스페이스 링크면 전환하고 ws 를 뗀 주소로 다시 연다 — true 를 돌려주면 이 창은 곧 다시 로드된다.
 * false 면 전환하지 않았다(같은 워크스페이스·멤버 아님·실패) — 부르는 쪽이 clean 경로로 계속 간다.
 */
export async function enterWorkspaceLink(
  path: string,
  user: UserLike,
  switchWorkspace: (businessId: number) => Promise<boolean>,
): Promise<boolean> {
  const target = foreignWorkspaceOf(path, user);
  if (!target) return false;
  let ok = false;
  try { ok = await switchWorkspace(target); } catch { ok = false; }
  if (!ok) return false;
  const { clean } = splitWorkspaceParam(path);
  journalStep('ws_reload', clean);   // 알림 탭 추적 — 일부러 문서를 다시 연다(services/navDiag)
  try {
    window.location.replace(new URL(clean, window.location.origin).href);
  } catch {
    window.location.replace(clean);
  }
  return true;
}

/**
 * 앱 안에서 서버가 준 앱 주소(auth-check 의 appUrl 등 — ?ws= 가 실릴 수 있다)로 갈 때 쓰는 문 하나 (2026-10-14).
 *   ws 가 **이 창의 워크스페이스가 아니면** 문서를 새로 연다 — 부팅 판정(App.tsx ModeGate)이 전환하고 ws 를 뗀 주소로 다시 연다.
 *   그 밖이면 ws 를 떼고 `go`(SPA 이동·새 탭)로 간다.
 * 운영 신고: 고객 최정우님(자기 워크스페이스 기율법률)이 워프로랩 청구서 링크를 열자 공개 청구서 화면이 **지금 워크스페이스**의
 *   Q bill 로 SPA 이동해 «찾을 수 없음» 이었다. SPA 이동은 ModeGate 를 지나지 않는다 — 그래서 여기서 가른다.
 */
export function openAppLink(appUrl: string, go: (path: string) => void): void {
  const { ws, clean } = splitWorkspaceParam(appUrl);
  const current = getRequestWorkspaceId();
  if (ws && current && ws !== Number(current)) {
    window.location.assign(appUrl);
    return;
  }
  go(clean);
}
