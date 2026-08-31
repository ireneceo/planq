// 탭 안에서의 "뒤로 가기" — 갈 곳이 있는지와 가는 방법.
//
// ★ 왜 필요한가 (Irene 2026-08-31, 여러 번 요청):
//   "잘못 누르면 다시 못 돌아가서 당혹스러워."
//   데스크탑 브라우저는 뒤로가기가 있지만 **모바일·네이티브 앱에는 그 버튼이 아예 없어서**
//   한 번 잘못 들어가면 빠져나올 길이 없었다.
//
// ★★★ window.history.back() 도 쓰지 않는다 — 탭 모드에서 **되감기가 취소된다**(2026-08-31 실측).
//   popstate → PopstateBridge → tabStore.navigateActive(path) → UrlMirror 가 다시 pushState 하는
//   왕복이라 뒤로 갔다가 같은 자리로 돌아온다(/tasks → /tasks). 그래서 히스토리에 기대지 않고
//   **지나온 경로를 직접 기억했다가 그리로 보낸다.** navigateActive 는 미러(단일 탭)에서도 동작한다.
//
// ★★ 절대 react-router 훅(useLocation/useNavigate)을 쓰지 말 것 — 2026-08-31 운영 장애.
//   이 훅은 MainLayout 에서 불린다. 그런데 **탭 모드에서는 MainLayout 이 Router 바깥**이다
//   (라우터는 각 pane 안의 MemoryRouter — components/Tab/TabPane.tsx). 그래서 useLocation() 이
//   "may be used only in the context of a <Router>" 로 던져 **화면 전체가 죽었다**.
//   → Router 에 의존하지 않는 두 축만 쓴다:
//      · 위치 변화 감지 = tabStore 구독 (탭 경로 변화. 미러 모드에서도 TabMirror 가 갱신한다)
//      · 실제 이동      = window.history.back()
//        (탭 모드는 UrlMirror 가 window history 를 밀고 PopstateBridge 가 되받는다.
//         셸 모드는 BrowserRouter 가 곧 window history 라 양쪽 모두 정상 동작한다.)
import { useEffect, useRef, useState } from 'react';
import { tabStore } from '../stores/tabStore';

function activePathOf(): string {
  const s = tabStore.getSnapshot();
  const t = s.tabs.find((x) => x.id === s.activeId);
  return t ? t.path : (typeof window !== 'undefined' ? window.location.pathname + window.location.search : '');
}

export function usePaneBack(): { canGoBack: boolean; goBack: () => void } {
  const stack = useRef<string[]>([]);      // 지나온 경로들 (현재 것 제외)
  const current = useRef<string>(activePathOf());
  const skipNext = useRef(false);          // goBack 이 만든 경로 변화는 스택에 안 쌓는다
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    const onChange = () => {
      const p = activePathOf();
      if (p === current.current) return;
      if (skipNext.current) { skipNext.current = false; current.current = p; return; }
      stack.current.push(current.current);
      if (stack.current.length > 30) stack.current.shift();   // 무한 증가 방지
      current.current = p;
      setCanGoBack(true);
    };
    const off = tabStore.subscribe(onChange);
    window.addEventListener('popstate', onChange);
    return () => { off(); window.removeEventListener('popstate', onChange); };
  }, []);

  const goBack = () => {
    const target = stack.current.pop();
    if (!target) { setCanGoBack(false); return; }
    if (stack.current.length === 0) setCanGoBack(false);
    skipNext.current = true;
    current.current = target;
    tabStore.navigateActive(target);
  };

  return { canGoBack, goBack };
}
