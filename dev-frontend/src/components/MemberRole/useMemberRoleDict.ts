// 워크스페이스 역할 사전 훅 — 새 프로젝트 모달·프로젝트 상세·설정 멤버가 같이 쓴다.
//   다른 창·사람이 역할을 추가·변경·삭제하면 `member_role:updated` 신호로 다시 읽는다(실시간 규칙 16).
//   사전을 못 읽어도 화면은 산다(역할 고르기만 비어 있다) — apiFetch 는 throw 하지 않는다.
import { useCallback, useEffect, useState } from 'react';
import { joinRoom, leaveRoom, onSocket } from '../../services/socket';
import { fetchMemberRoles, type MemberRoleEntry } from './memberRoleApi';

export function useMemberRoleDict(bizId: number | null | undefined) {
  const [dict, setDict] = useState<MemberRoleEntry[]>([]);
  const biz = bizId ? Number(bizId) : null;

  const reload = useCallback(async () => {
    if (!biz) { setDict([]); return; }
    const list = await fetchMemberRoles(biz);
    if (list) setDict(list);
  }, [biz]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    if (!biz) return undefined;
    joinRoom(`business:${biz}`);
    let timer: number | null = null;
    const off = onSocket<{ business_id?: number }>('member_role:updated', (p) => {
      if (p?.business_id && Number(p.business_id) !== biz) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => { void reload(); }, 250);
    });
    return () => { off(); if (timer) window.clearTimeout(timer); leaveRoom(`business:${biz}`); };
  }, [biz, reload]);

  // 방금 만든 역할을 즉시 반영(서버 재조회 전) — 정렬 순서 끝에
  const add = useCallback((entry: MemberRoleEntry) => {
    setDict((prev) => (prev.some((r) => r.id === entry.id) ? prev : [...prev, entry]));
  }, []);

  return { dict, reload, add };
}
