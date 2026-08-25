// 문서 동시 편집 표시 (2026-08-25)
//   "같이 다른 사람하고도 쓰고 싶어. 누가 쓰고 있으면 아이디 표시 못해? 구글문서처럼?"(Irene)
//
// 지금 범위는 **누가 편집 중인지 보여주는 것**이다. 같은 문단을 동시에 쳐도 글자가 합쳐지지는
// 않는다(그건 CRDT — 별도 과제). 대신 서로를 보게 해서 모르고 덮어쓰는 사고를 없앤다.
import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getAccessToken } from '../contexts/AuthContext';

export interface PresenceUser { userId: number; name: string }

export function usePostPresence(postId: number | null, businessId: number | null, myName: string, active: boolean): PresenceUser[] {
  const [users, setUsers] = useState<PresenceUser[]>([]);
  useEffect(() => {
    if (!active || !postId || !businessId) { setUsers([]); return; }
    let s: Socket | null = null;
    try {
      s = io({ auth: { token: getAccessToken() } });
      const join = () => s?.emit('post:editing:join', { postId, businessId, name: myName });
      s.on('connect', join);          // 재연결 시에도 다시 알린다 — 안 하면 조용히 사라진다
      s.on('post:presence', (p: { post_id: number; users: PresenceUser[] }) => {
        if (p && p.post_id === postId) setUsers(Array.isArray(p.users) ? p.users : []);
      });
    } catch { /* 소켓 불가 — 표시만 못 할 뿐 편집은 그대로 */ }
    return () => {
      try { s?.emit('post:editing:leave', { postId }); s?.disconnect(); } catch { /* 무시 */ }
    };
  }, [postId, businessId, myName, active]);
  return users;
}
