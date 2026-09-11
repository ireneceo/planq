// useDirectDetail — 목록에 없는 딥링크 id 를 **그 id 로 직접** 묻는다 (docs/WORKSPACE_SCOPE_DESIGN.md Q6 · 2026-09-11)
//
// 캘린더(?event=)·청구서(?invoice=)는 상세를 **이미 불러온 목록에서 골라** 열었다. 목록에 없으면
// (날짜 범위 밖·필터 밖·다른 워크스페이스·삭제) 드로어가 null 이라 **눌러도 아무 일도 없었다.**
// 목록에 없을 때만 그 id 로 묻는다:
//   200 → data (범위 밖이어도 같은 워크스페이스면 연다)
//   404 → 내 다른 워크스페이스 것인지(findOtherWorkspaceOf) → other_workspace | not_found
//   403 → forbidden · 그 외 → error
// ★ 화면마다 이 분기를 베껴 두면 한쪽만 고쳐져 갈라진다 — 이 훅 하나를 쓴다. 표시는 DetailFallbackDrawer.
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../contexts/AuthContext';
import type { DetailStatus } from './useDetailResource';
import { findOtherWorkspaceOf, type EntityKind } from '../utils/workspaceMatch';

export interface DirectDetail<T> {
  id: number;
  data: T | null;
  status: DetailStatus;
  otherBiz: number | null;
}

/**
 * @param id    열려는 id (없으면 null — 상태를 비운다)
 * @param url   그 id 의 상세 API (현재 워크스페이스 URL). 모르면 null
 * @param skip  참이면 묻지 않는다 — 목록에서 이미 찾았거나 목록이 아직 로딩 중
 * @returns     **지금 id** 에 대한 결과만(옛 id 응답은 버린다). 묻지 않았으면 null
 */
export function useDirectDetail<T>(
  kind: EntityKind, id: number | null, url: string | null, currentBusinessId: unknown, skip: boolean,
): DirectDetail<T> | null {
  const [state, setState] = useState<DirectDetail<T> | null>(null);
  const reqRef = useRef<number | null>(null);

  useEffect(() => {
    if (id == null) { reqRef.current = null; setState(null); return; }
    if (skip || !url || reqRef.current === id) return;
    const want = id;
    reqRef.current = want;
    const settle = (next: Omit<DirectDetail<T>, 'id'>) => {
      if (reqRef.current === want) setState({ id: want, ...next });
    };
    settle({ data: null, status: 'loading', otherBiz: null });
    (async () => {
      try {
        const r = await apiFetch(url);
        if (r.status === 404) {
          const other = await findOtherWorkspaceOf(kind, want, currentBusinessId);
          settle({ data: null, status: other ? 'other_workspace' : 'not_found', otherBiz: other });
          return;
        }
        if (r.status === 403) { settle({ data: null, status: 'forbidden', otherBiz: null }); return; }
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.success) { settle({ data: null, status: 'error', otherBiz: null }); return; }
        settle({ data: j.data as T, status: 'ready', otherBiz: null });
      } catch {
        settle({ data: null, status: 'error', otherBiz: null });
      }
    })();
  }, [kind, id, url, currentBusinessId, skip]);

  return state && state.id === id ? state : null;
}
