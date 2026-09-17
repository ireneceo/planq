// useMenuReset — «같은 메뉴를 다시 눌렀다» 를 받아 **URL 에 없는 화면 상태**를 접는다.
//
//   Irene 2026-09-17: *"해당 메뉴에 있더라도 그 메뉴를 다시 누르면 그 메뉴 처음으로 다시 돌아가야 하는 거
//   아니야? 업무리스트에서 업무추가를 눌렀어. 그럼 업무등록하는 화면인데 다시 q task 누르면 업무리스트가 나오는거지"*
//
//   URL 로 열린 것(`?task=` · `?item=` · `?conv=`)은 `tabStore.navigateActive` 가 쿼리를 떨어뜨려
//   저절로 닫힌다. 문제는 **컴포넌트 state 로만 열린 것**이다 — 같은 경로라 주소가 안 바뀌고,
//   안 바뀌면 리렌더도 없어 화면이 그대로 남는다. 그래서 신호를 받는다.
//
//   ★ 신호는 `tabStore` **한 곳**에서만 쏜다. 화면마다 «내가 눌렸나» 를 스스로 알아내게 하면
//     반드시 한 곳이 빠진다(memory feedback_same_value_multiple_formulas).
//   ★ 경로를 넘기면 그 경로일 때만 접는다 — 다른 메뉴를 눌러 떠나는 중에 내 상태를 건드리지 않는다.
import { useEffect, useRef } from 'react';

export function useMenuReset(onReset: () => void, pathPrefix?: string) {
  const cb = useRef(onReset);
  cb.current = onReset;
  useEffect(() => {
    const h = (e: Event) => {
      const p = (e as CustomEvent<{ path?: string }>).detail?.path || '';
      if (pathPrefix && !(p === pathPrefix || p.startsWith(`${pathPrefix}/`))) return;
      cb.current();
    };
    window.addEventListener('pq:menu-reset', h);
    return () => window.removeEventListener('pq:menu-reset', h);
  }, [pathPrefix]);
}

export default useMenuReset;
