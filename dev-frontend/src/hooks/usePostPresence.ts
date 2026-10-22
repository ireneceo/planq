// 문서 «누가 같이 쓰고 있나» (2026-08-25 첫 판 · 2026-10-22 고침 — docs/DOC_COEDIT_DESIGN.md B 안)
//   "같이 다른 사람하고도 쓰고 싶어. 누가 쓰고 있으면 아이디 표시 못해? 구글문서처럼?"(Irene)
//   "같은 문서를 같이 편집하고 싶으면 어떻게 해? 히스토리 남기고 공동작업 할 수 없어?"(Irene 2026-10-22)
//
// 글자 단위 동시 입력은 하지 않는다 — 서로를 보게 해서 모르고 덮어쓰는 일을 막고, 겹치면 저장 때 고르게 한다.
// 판정(들어올 수 있는 사람·이름·«치는 중» 30초)은 서버 services/postPresence 한 곳이다.
//   - 보기만 해도 방에 들어간다(목록엔 안 나온다) → 보기 화면에서도 «○○ 편집 중» 을 안다.
//   - 소켓은 세션 공유 소켓(services/socket) — 예전엔 문서마다 소켓을 새로 열었다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket, onSocket } from '../services/socket';

export interface PresenceUser { userId: number; name: string; typing: boolean }

const TYPING_PING_MS = 10 * 1000;

export function usePostPresence(
  postId: number | null,
  businessId: number | null,
  myUserId: number | null,
  editing: boolean,
  active: boolean,
): { others: PresenceUser[]; ping: () => void } {
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const lastPingRef = useRef(0);

  useEffect(() => {
    if (!active || !postId || !businessId) { setUsers([]); return; }
    const join = () => getSocket()?.emit('post:presence:join', { postId, businessId, editing });
    const s = getSocket();
    if (s?.connected) join(); else s?.once('connect', join);
    // 끊겼다 붙으면 서버는 나를 잊었다 — 다시 알린다(안 하면 조용히 사라진다).
    window.addEventListener('socket:reconnected', join);
    const off = onSocket('post:presence', (p: { post_id: number; users: PresenceUser[] }) => {
      if (p && p.post_id === postId) setUsers(Array.isArray(p.users) ? p.users : []);
    });
    lastPingRef.current = 0;
    return () => {
      window.removeEventListener('socket:reconnected', join);
      s?.off('connect', join);
      off();
      try { getSocket()?.emit('post:presence:leave', { postId }); } catch { /* 표시만 못 할 뿐 */ }
      setUsers([]);
    };
  }, [postId, businessId, editing, active]);

  // 내가 치고 있다 — 10초에 한 번까지만 알린다.
  const ping = useCallback(() => {
    if (!active || !editing || !postId) return;
    const now = Date.now();
    if (now - lastPingRef.current < TYPING_PING_MS) return;
    lastPingRef.current = now;
    try { getSocket()?.emit('post:presence:typing', { postId }); } catch { /* 무시 */ }
  }, [active, editing, postId]);

  const others = users.filter((u) => u.userId !== myUserId);
  return { others, ping };
}
