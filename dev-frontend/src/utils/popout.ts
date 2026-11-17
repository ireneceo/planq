// 팝아웃(분리 창) 컨텍스트 마커 — 창 단위 영속.
// 분리 창(/talk-popout, /note-popout, /help-popout) 안에서 다른 라우트(/wiki 등)로
// 이동해도 그 창은 끝까지 "팝아웃"으로 취급 → 우측 하단 퀵메뉴·토스터 재노출 차단(#84).
// sessionStorage 는 창(브라우징 컨텍스트)별 격리 → window.open 분리 창에만 표시되고
// 메인 창엔 안 묻음. 한 번 set 하면 그 창 생애 동안 유지(언마운트 해도 안 지움).
import { isNativeApp } from '../services/native';

const KEY = 'pq_popout';

export function markPopoutWindow(): void {
  try {
    // 진짜 분리 창에서만 마킹. 메인 탭이 실수로 /help-popout 직접 열어도(window.open 아님)
    // 오염되지 않게 가드 — window.opener(열어준 부모 존재) 또는 window.name='pq-*'(window.open 2nd arg).
    const realPopout = typeof window !== 'undefined'
      && (!!window.opener || /^pq-/.test(window.name || ''));
    if (realPopout) sessionStorage.setItem(KEY, '1');
  } catch { /* private mode 등 — best-effort */ }
}

export function isPopoutWindow(): boolean {
  try { return sessionStorage.getItem(KEY) === '1'; } catch { return false; }
}

/**
 * 별도 창(window.open 팝아웃)을 열 수 있는 환경인가 — **단일 술어** (2026-10-04).
 *
 * 앱(iOS·Android WebView) 안에는 «창» 이 없다. 거기서 window.open 을 부르면 시스템 브라우저(사파리)로
 * 튀어 나간다 — Irene: *"좌측 메뉴 Cue, 팝아웃 Q helper 가 링크가 웹으로 날라가. 아이패드 앱에서."*
 * 아이패드는 폭이 넓고 UA 도 «Macintosh» 라 폭만 보던 옛 판정이 데스크탑으로 읽었다.
 * 폰 폭(≤768)도 창 개념이 없다. 둘 다 앱 안(드로어·페이지)으로 연다.
 */
export function canOpenSeparateWindow(): boolean {
  if (typeof window === 'undefined') return false;
  if (isNativeApp()) return false;
  try { return !window.matchMedia('(max-width: 768px)').matches; } catch { return true; }
}

// ─── 고정 워크스페이스 창 (메일 팝아웃, 2026-11-17 Irene «권고대로» · Fable 설계 2단계) ───
//   메일 팝아웃은 **연 워크스페이스에 고정**된다 — 메인 창에서 워크스페이스를 바꿔도 이 창은 그대로이고,
//   창 안 띠에서만 직접 바꾼다. 워크스페이스 단일 정본 계약(.claude/rules/workspace.md 3항)의 **유일한 예외**다.
//   · 값은 이 창의 sessionStorage(창마다 따로). 처음 열 때 주소의 `?ws=` 로 심는다.
//   · ★ **경로가 /mail-popout 일 때만** 고정으로 읽는다 — window.open 은 여는 창의 sessionStorage 를 새 창에
//     복사하므로, 이 창이 연 다른 창(첨부·문서 등)이 고정을 물려받아 엉뚱한 워크스페이스로 뜨면 안 된다.
//   · 서버 정본은 바꾸지 않는다. /api/auth/me?view_ws= 가 그 워크스페이스의 직원 멤버일 때만 그 범위로 답한다.
const PIN_WS_KEY = 'pq_popout_ws';
export const PINNED_WS_PATH = '/mail-popout';

function onPinnedPath(): boolean {
  try { return window.location.pathname === PINNED_WS_PATH; } catch { return false; }
}

/** 이 창이 고정된 워크스페이스 — 고정 창이 아니면 null. 처음 부를 때 주소의 ?ws= 를 심는다. */
export function getPinnedWorkspace(): number | null {
  if (typeof window === 'undefined' || !onPinnedPath()) return null;
  try {
    const fromUrl = Number(new URLSearchParams(window.location.search).get('ws'));
    if (Number.isInteger(fromUrl) && fromUrl > 0) {
      sessionStorage.setItem(PIN_WS_KEY, String(fromUrl));
      return fromUrl;
    }
    const v = Number(sessionStorage.getItem(PIN_WS_KEY));
    return Number.isInteger(v) && v > 0 ? v : null;
  } catch { return null; }
}

/** 고정 풀기 — 서버가 그 워크스페이스를 못 보게 됐다고 답했을 때(멤버 해제·삭제·고객). 주소의 ?ws= 도 지운다. */
export function clearPinnedWorkspace(): void {
  try {
    sessionStorage.removeItem(PIN_WS_KEY);
    const u = new URL(window.location.href);
    if (u.searchParams.has('ws')) { u.searchParams.delete('ws'); window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash); }
  } catch { /* noop */ }
}

/** 창 안에서 다른 워크스페이스로 — 이 창만 바뀐다(다른 창·정본 그대로). 보던 메일은 버리고 새로 부팅한다. */
export function switchPinnedWorkspace(businessId: number): void {
  try {
    sessionStorage.setItem(PIN_WS_KEY, String(businessId));
    window.location.replace(`${PINNED_WS_PATH}?ws=${businessId}`);
  } catch { /* noop */ }
}
