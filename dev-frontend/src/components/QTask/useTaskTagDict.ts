// 워크스페이스 태그 사전 — 리스트 행에서 태그를 고를 목록. 메인 리스트·팝아웃 공용 훅.
//   사전이 없으면 목록 자체는 그대로 뜬다(태그 편집만 못 한다) — 실패를 조용히 넘기되 화면은 살린다.
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../contexts/AuthContext';
import type { TaskTagLite } from './TagChips';

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

  // 새로 만든 태그를 사전에 즉시 반영(서버 재조회 없이) — 이름 사전순 유지
  const add = useCallback((tag: TaskTagLite) => {
    setDict((prev) => (prev.some((g) => g.id === tag.id)
      ? prev
      : [...prev, tag].sort((a, b) => a.name.localeCompare(b.name))));
  }, []);

  return { dict, reload, add };
}
