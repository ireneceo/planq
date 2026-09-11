// 페이지가 사라지는 순간(pagehide)의 마지막 저장 — docs/DRAFT_PERSISTENCE_DESIGN.md D-C3
//
// ★ apiFetch 를 쓰지 않는다 — 토큰 갱신(tryRefresh)을 먼저 await 할 수 있어 문서가 죽기 전에 요청이 안 나간다.
//   raw fetch + keepalive 는 문서가 사라져도 브라우저가 끝까지 보낸다(완주 보장은 없다 — 시도).
// ★ 401 재시도 불가 · 본문이 60KB 를 넘으면 보내지 않는다(Chrome keepalive 상한 64KB — 넘기면 요청 자체가 거부된다).
// ★ X-Workspace-Id 도 싣는다 — 창의 워크스페이스 관찰 카운터(workspaceContext.observe)가 헤더 없는 요청으로 오염되지 않게.
//   (이 파일은 AuthContext 가 import 하지 않는다 — 순환 참조를 만들지 않는다)
import { getAccessToken, getRequestWorkspaceId } from '../contexts/AuthContext';

export const KEEPALIVE_MAX_BYTES = 60 * 1024;

/** 보냈으면 true(도착 보장 아님) · 크기 초과·예외면 false */
export function keepaliveJson(url: string, method: 'PUT' | 'PATCH' | 'POST', body: unknown): boolean {
  try {
    const json = JSON.stringify(body);
    if (new Blob([json]).size > KEEPALIVE_MAX_BYTES) return false;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const ws = getRequestWorkspaceId();
    if (ws) headers['X-Workspace-Id'] = String(ws);
    void fetch(url, { method, headers, body: json, keepalive: true, credentials: 'include' }).catch(() => null);
    return true;
  } catch {
    return false;
  }
}
