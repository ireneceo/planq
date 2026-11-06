// 워크스페이스 태그 사전 — 리스트 행에서 태그를 고를 목록. 메인 리스트·팝아웃 공용 훅.
//   사전이 없으면 목록 자체는 그대로 뜬다(태그 편집만 못 한다) — 실패를 조용히 넘기되 화면은 살린다.
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../contexts/AuthContext';
import type { TaskTagLite } from './TagChips';
import { onSocket } from '../../services/socket';

export function useTaskTagDict(bizId: number | null) {
  const [dict, setDict] = useState<TaskTagLite[]>([]);

  const reload = useCallback(async () => {
    if (!bizId) { setDict([]); return; }
    const r = await apiFetch(`/api/tasks/tags?business_id=${bizId}`);
    if (!r.ok) return;                       // apiFetch 는 throw 하지 않는다 — res.ok 를 본다
    const j = await r.json().catch(() => null);
    if (j?.success) setDict(Array.isArray(j.data) ? j.data : []);
  }, [bizId]);

  useEffect(() => { void reload(); }, [reload]);
  // 다른 창·사람이 사전(이름·순서·삭제)을 바꾸면 다시 읽는다 — 태그별 묶음 순서가 이 사전 순서다(2026-11-06).
  //   business:N 방 join 은 이 훅을 쓰는 화면(팝아웃)이 이미 한다.
  useEffect(() => {
    if (!bizId) return undefined;
    return onSocket<{ business_id?: number }>('task_tag:updated', (d) => {
      if (!d?.business_id || Number(d.business_id) === bizId) void reload();
    });
  }, [bizId, reload]);

  // 새로 만든 태그를 사전에 즉시 반영(서버 재조회 없이) — 사전은 사람이 정한 순서(sort_order)라 **뒤에 붙인다**.
  //   서버도 새 태그를 max+1 로 만든다(2026-11-06 순서 지정 — 이름순으로 끼우면 다시 읽을 때 자리가 튄다).
  const add = useCallback((tag: TaskTagLite) => {
    setDict((prev) => (prev.some((g) => g.id === tag.id) ? prev : [...prev, tag]));
  }, []);

  return { dict, reload, add };
}
