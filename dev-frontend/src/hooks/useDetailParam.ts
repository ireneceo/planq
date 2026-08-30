// hooks/useDetailParam.ts — 상세 URL 파라미터 ↔ 선택 상태 양방향 싱크 (2026-08-30)
//
// 왜 껍데기를 뽑는가: 이 코드가 이미 QTaskPage·PostsPage·MailPage 에 **각자** 복제돼 있었고,
// 복제되지 않은 화면(파일·고객·서명)에는 **아예 없어서 딥링크가 죽어 있었다** —
// 링크를 만드는 곳은 5곳인데 읽는 곳이 0곳이었다(`/files?file=N`).
// 그래서 알림 클릭·전역검색으로 파일/고객을 여는 것이 **항상, 아무 일도 안 일어났다.**
// (Irene: "여러 상황에서 상세가 제대로 딱 딱 안열리는 경우가 너무 많아")
//
// 정본 표는 utils/notificationLink.ts 의 ENTITY_LINK 다. 새 상세 화면을 만들면
// 그 표에 넣고 이 훅을 달면 끝 — 한쪽만 하면 또 죽은 링크가 생긴다.
import { useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

type Options = {
  /** URL 이 가리키는 id 를 실제로 열 때 호출. 같은 id 로 두 번 부르지 않는다. */
  onOpen: (id: number) => void;
  /** 지금 열려 있는 id (없으면 null). 이 값이 바뀌면 URL 을 맞춘다. */
  activeId: number | null;
  /** 이 훅을 끌 조건 — 예: 임베드된 인스턴스(프로젝트·개인보관함)는 페이지 오너만 읽어야 한다. */
  enabled?: boolean;
};

/**
 * @param key  쿼리 키 ('file' | 'client' | 'post' | 'task' | 'sig' …)
 */
export function useDetailParam(key: string, { onOpen, activeId, enabled = true }: Options) {
  const [sp, setSp] = useSearchParams();
  const raw = sp.get(key);
  const openedRef = useRef<number | null>(null);

  // URL → 화면. 같은 id 를 반복해서 열지 않는다(무한 루프·깜빡임 차단).
  useEffect(() => {
    if (!enabled) return;
    const id = Number(raw);
    if (!raw || !Number.isFinite(id) || id <= 0) { openedRef.current = null; return; }
    if (openedRef.current === id) return;
    openedRef.current = id;
    onOpen(id);
  }, [raw, enabled, onOpen]);

  // 화면 → URL. 새로고침·공유·뒤로가기에서 맥락이 유지된다(CLAUDE.md UI 규칙).
  useEffect(() => {
    if (!enabled) return;
    const cur = sp.get(key);
    const want = activeId != null ? String(activeId) : null;
    if (cur === want) return;
    // ★ 두 effect 가 싸우는 것을 막는다 (2026-08-30 실측으로 발각).
    //   딥링크로 처음 들어오면 이 커밋에서 위 effect 가 onOpen(id) 을 부르지만
    //   **이 렌더의 activeId 는 아직 null** 이다. 그대로 두면 여기서 파라미터를 지워 버리고,
    //   지워진 URL 을 위 effect 가 다시 읽어 "열 것 없음" 으로 판단한다 —
    //   결과적으로 딥링크가 조용히 죽는다(고객 화면에서 정확히 이 증상이 났다).
    //   방금 채택한 값이면 화면 반영을 기다린다.
    if (cur && want === null && openedRef.current != null && String(openedRef.current) === cur) return;
    const next = new URLSearchParams(sp);
    if (want) next.set(key, want); else next.delete(key);
    setSp(next, { replace: true });
    openedRef.current = activeId;
  }, [activeId, enabled, key, sp, setSp]);

  /** 닫을 때 파라미터만 지우고 싶을 때 (선택) */
  const clearParam = useCallback(() => {
    const next = new URLSearchParams(sp);
    next.delete(key);
    setSp(next, { replace: true });
    openedRef.current = null;
  }, [key, sp, setSp]);

  return { paramId: raw ? Number(raw) : null, clearParam };
}
