// 내가 알림을 끈 대화방 묶음 — 한 벌(모듈 캐시). docs/QTALK_MUTE_DESIGN.md §4 (Fable DESIGN-READY, 2026-11-13).
//
// 서버 notify() 가 끈 방의 보통 메시지 알림(알림함·푸시·메일)을 막는다. 그런데 화면의 토스트·소리와 사이드바 «미리 +1» 은
//   알림 행이 아니라 날 소켓 `message:new` 를 보고 움직인다 — 그래서 화면도 «끈 방» 을 알아야 한다. 그 묶음이 여기 하나다.
//   · 로그인 뒤 처음 쓰일 때 GET /api/conversations/me/muted 1회
//   · 소켓 `conversation:mute`(내 다른 기기·창에서 끄고 켬)로 넣고 뺀다
//   · 창이 다시 보일 때 다시 받는다(끊긴 동안 놓친 신호)
// 워크스페이스 구분 없이 대화방 id 로만 본다(id 는 전역 유일).
import { useEffect, useState } from 'react';
import { apiFetch } from '../contexts/AuthContext';
import { onSocket } from '../services/socket';

const muted = new Set<number>();
const listeners = new Set<() => void>();
let started = false;
let offSocket: (() => void) | null = null;

function emit() { listeners.forEach((fn) => fn()); }

async function load() {
  try {
    const r = await apiFetch('/api/conversations/me/muted');
    const j = await r.json();
    if (j?.success && Array.isArray(j.data?.ids)) {
      muted.clear();
      j.data.ids.forEach((id: number) => muted.add(Number(id)));
      emit();
    }
  } catch { /* 못 받으면 «끈 방 없음» 으로 둔다 — 알림이 더 오는 쪽이 덜 나쁘다 */ }
}

/** 처음 한 번 — 받기 + 소켓 구독 + 창 복귀 때 다시 받기. 여러 번 불러도 한 번만 붙는다. */
export function ensureMutedLoaded() {
  if (started) return;
  started = true;
  void load();
  offSocket = onSocket('conversation:mute', (d: { conversation_id: number; muted_at: string | null }) => {
    setConversationMutedLocal(Number(d?.conversation_id), !!d?.muted_at);
  });
  const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('socket:reconnected', () => { void load(); });
}

/** 로그아웃·계정 전환 때 비운다(다음 사람이 앞 사람 묶음을 쓰지 않게). */
export function resetMutedConversations() {
  muted.clear();
  if (offSocket) { offSocket(); offSocket = null; }
  started = false;
  emit();
}

export function isConversationMuted(convId: number | null | undefined): boolean {
  return !!convId && muted.has(Number(convId));
}

/** 화면이 끄고 켠 직후(서버 응답 전·후) 바로 반영 — 실패하면 호출부가 되돌린다. */
export function setConversationMutedLocal(convId: number, on: boolean) {
  if (!convId) return;
  const had = muted.has(convId);
  if (on && !had) muted.add(convId);
  else if (!on && had) muted.delete(convId);
  else return;
  emit();
}

/** 화면용 — 묶음이 바뀌면 다시 그린다. */
export function useMutedConversations() {
  const [, setTick] = useState(0);
  useEffect(() => {
    ensureMutedLoaded();
    const fn = () => setTick((n) => n + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return { isMuted: isConversationMuted };
}
