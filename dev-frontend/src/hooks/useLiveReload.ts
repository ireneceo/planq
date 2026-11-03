// hooks/useLiveReload.ts — 열어 둔 화면을 «다른 경로가 바꾼 것» 에 맞춰 다시 읽는 한 벌 (2026-11-03).
//
// Irene: "챗gpt나 다른 경로를 통해 뭔가 바꾸면 바로 바로 적용이 안돼. 프로젝트 추가하면 리스트가 안바뀌거나."
//   서버는 바꿀 때마다 신호(project:new·task:updated…)를 워크스페이스 방에 보낸다 — AI 앱·Cue·다른 사람·다른 기기 모두 같은 신호.
//   그런데 화면마다 리스너를 손으로 붙이다 보니 프로젝트 목록 화면은 아예 듣지 않았고, project:new 는 아무도 듣지 않았다.
//   realtime 규칙 16 의 (a) 방 참여 · (c) 250ms 묶음 다시 읽기 · (d) 탭 복귀 · (f) 소켓 재연결 네 가지를 이 훅이 한 번에 붙인다.
//
// 쓰는 법: useLiveReload(bizId, ['project:new', 'project:updated'], silentLoad)
//   - reload 는 «조용히» 다시 읽는 함수여야 한다(스피너·빈 화면으로 되돌리지 않는다).
//   - 다른 워크스페이스 신호는 business_id 가 실려 오면 거른다(실리지 않은 신호는 그대로 다시 읽는다 — 다시 읽기는 늘 안전하다).
import { useCallback, useEffect, useRef } from 'react';
import { joinRoom, leaveRoom, onSocket } from '../services/socket';
import { useVisibilityRefresh } from './useVisibilityRefresh';

export function useLiveReload(
  businessId: number | null | undefined,
  events: readonly string[],
  reload: () => void,
  opts: { enabled?: boolean; delayMs?: number } = {},
): void {
  const { enabled = true, delayMs = 250 } = opts;
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const key = events.join('|');

  useEffect(() => {
    if (!businessId || !enabled) return;
    let timer: number | null = null;
    const soon = () => {
      if (timer != null) return;   // 이미 예약됨 — 몰려온 신호를 한 번으로 합친다
      timer = window.setTimeout(() => { timer = null; reloadRef.current(); }, delayMs);
    };
    const onEvent = (data: unknown) => {
      const b = (data && typeof data === 'object') ? (data as { business_id?: unknown }).business_id : undefined;
      if (b != null && Number(b) !== Number(businessId)) return;
      soon();
    };
    joinRoom(`business:${businessId}`);
    const offs = key.split('|').filter(Boolean).map((ev) => onSocket(ev, onEvent));
    // 끊긴 동안 온 신호는 다시 오지 않는다 — 다시 붙으면 서버에서 다시 읽는다(규칙 16 (f)).
    window.addEventListener('socket:reconnected', soon);
    return () => {
      if (timer != null) window.clearTimeout(timer);
      offs.forEach((off) => off());
      window.removeEventListener('socket:reconnected', soon);
      leaveRoom(`business:${businessId}`);
    };
  }, [businessId, enabled, key, delayMs]);

  // 앱이 백그라운드였다가 돌아오면(폰·숨은 탭) 그 사이 바뀐 것을 다시 읽는다(규칙 16 (d)).
  //   useVisibilityRefresh 는 함수가 바뀔 때마다 다시 판정하므로 고정 함수를 넘기고 최신 값은 ref 로 읽는다.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  useVisibilityRefresh(useCallback(() => { if (enabledRef.current) reloadRef.current(); }, []));
}
