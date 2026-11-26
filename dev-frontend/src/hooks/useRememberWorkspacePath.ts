import { useEffect, useRef } from 'react';
import { rememberWorkspacePath } from '../utils/workspaceLastPath';

/**
 * 워크스페이스별 «마지막에 보던 화면» 기록(2026-11-26 Irene) — 전환 때 WorkspaceSwitcher·따라가는 창이 그 값으로 착지한다.
 * MainLayout(앱 본 셸) 한 곳에서 부른다 — 팝아웃·공개 화면은 기록하지 않는다.
 * ★ 워크스페이스가 막 바뀐 렌더는 건너뛴다 — 그 순간 경로는 아직 **앞 워크스페이스** 화면이라 새 키에 박으면 섞인다.
 */
export function useRememberWorkspacePath(businessId: number | null | undefined, pathname: string, search: string): void {
  const lastBizRef = useRef<number | null>(null);
  useEffect(() => {
    const biz = businessId ? Number(businessId) : null;
    if (!biz) return;
    const switched = lastBizRef.current !== null && lastBizRef.current !== biz;
    lastBizRef.current = biz;
    if (switched) return;
    rememberWorkspacePath(biz, pathname + (search || ''));
  }, [businessId, pathname, search]);
}
