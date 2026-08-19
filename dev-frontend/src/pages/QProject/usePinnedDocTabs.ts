// 프로젝트 상세 — 메뉴에 추가한 문서(📌)를 탭으로 띄우기 위한 상태.
//
// QProjectDetailPage 에서 추출 (god-file 가드: 컴포넌트 800줄). 로직은 그대로 옮겼다.
//
// 저장이 localStorage 라 **기기를 바꾸면 핀이 사라진다.** DB 이관은 별도 백로그다
// (프로젝트 리스트 핀은 처음부터 DB 로 간다 — 같은 한계를 물려받지 않기 위해).
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../contexts/AuthContext';

export function usePinnedDocTabs(projectId: number) {
  const PIN_KEY = `qproject_pinned_docs_${projectId}`;

  const readPinnedIds = useCallback((): number[] => {
    try { const raw = localStorage.getItem(PIN_KEY); if (raw) return JSON.parse(raw); } catch { /* ignore */ }
    return [];
  }, [PIN_KEY]);

  const [pinnedDocIds, setPinnedDocIds] = useState<number[]>(readPinnedIds);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ projectId?: number }>;
      if (!ce.detail || ce.detail.projectId === projectId) setPinnedDocIds(readPinnedIds());
    };
    window.addEventListener('qproject-pinned-changed', handler);
    return () => window.removeEventListener('qproject-pinned-changed', handler);
  }, [projectId, readPinnedIds]);

  // 탭 라벨 캐시 — pinned id → post title
  const [pinnedDocLabels, setPinnedDocLabels] = useState<Record<number, string>>({});
  useEffect(() => {
    const missing = pinnedDocIds.filter((id) => !pinnedDocLabels[id]);
    if (missing.length === 0) return;
    Promise.all(missing.map((id) => apiFetch(`/api/posts/${id}`)
      .then((r) => r.json())
      .then((j) => [id, j?.data?.title || `#${id}`] as [number, string])
      .catch(() => [id, `#${id}`] as [number, string])))
      .then((rows) => setPinnedDocLabels((prev) => ({ ...prev, ...Object.fromEntries(rows) })));
  }, [pinnedDocIds, pinnedDocLabels]);

  return { pinnedDocIds, setPinnedDocIds, pinnedDocLabels };
}

export default usePinnedDocTabs;
