// 프로젝트 상세 — 메뉴에 추가한 문서(📌)를 탭으로 띄우기 위한 상태.
//
// ★ 2026-09-07 — **localStorage → 서버(사람 단위)**.
//   여태 `qproject_pinned_docs_<projectId>` 를 브라우저에 저장했다. 그래서 데스크탑에서 올린
//   탭이 폰에서는 하나도 없었고, 사용자에게는 **기능이 없는 것**과 구별되지 않았다
//   (Irene 2026-09-07: "프로젝트에서 별도로 핀기능으로 탭메뉴 추가한게 모바일에서는 안나와. 나와야지.").
//   이제 `/api/projects/:id/pinned-docs` 가 정본이다 — 어느 기기에서 열어도 같다.
//   탭 라벨도 서버가 같이 준다(문서마다 GET /api/posts/:id 를 치던 N+1 이 사라진다).
//   지워진 문서는 서버가 걸러 내보내므로 죽은 탭이 남지 않는다.
//
// 옛 브라우저 핀은 **한 번 자동으로 옮긴다** — 쓰던 사람이 다시 올리지 않아도 되게.
// 옮긴 뒤 그 키는 지운다(두 벌이 남으면 어느 쪽이 진실인지 갈린다).
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../contexts/AuthContext';

export interface PinnedDocTab { post_id: number; title: string | null }

export function usePinnedDocTabs(projectId: number) {
  const [tabs, setTabs] = useState<PinnedDocTab[]>([]);
  const migratedRef = useRef(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const r = await apiFetch(`/api/projects/${projectId}/pinned-docs`);
      // apiFetch 는 실패해도 throw 하지 않는다 — ok 를 직접 본다.
      if (!r.ok) return;
      const j = await r.json();
      if (j?.success) setTabs(Array.isArray(j.data) ? j.data : []);
    } catch { /* 네트워크 — 다음 이벤트에서 다시 읽는다 */ }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  // 옛 브라우저 저장분 1회 이관
  useEffect(() => {
    if (!projectId || migratedRef.current) return;
    migratedRef.current = true;
    const key = `qproject_pinned_docs_${projectId}`;
    let old: number[] = [];
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      old = Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'number') : [];
    } catch { return; }
    if (!old.length) { try { localStorage.removeItem(key); } catch { /* private */ } return; }
    (async () => {
      for (const post_id of old) {
        await apiFetch(`/api/projects/${projectId}/pinned-docs`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ post_id }),
        }).catch(() => null);
      }
      try { localStorage.removeItem(key); } catch { /* private */ }
      await load();
    })();
  }, [projectId, load]);

  // 같은 탭 안에서 문서 목록의 핀 토글이 즉시 반영되게 (CLAUDE.md §16 (e) 안전망)
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ projectId?: number }>;
      if (!ce.detail || ce.detail.projectId === projectId) void load();
    };
    window.addEventListener('qproject-pinned-changed', handler);
    return () => window.removeEventListener('qproject-pinned-changed', handler);
  }, [projectId, load]);

  const pinnedDocIds = tabs.map((t) => t.post_id);
  const pinnedDocLabels: Record<number, string> = {};
  tabs.forEach((t) => { if (t.title) pinnedDocLabels[t.post_id] = t.title; });

  return { pinnedDocIds, pinnedDocLabels, reloadPinned: load };
}

export default usePinnedDocTabs;
