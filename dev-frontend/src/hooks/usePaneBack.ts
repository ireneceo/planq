// 탭 안에서의 "뒤로 가기" — 갈 곳이 있는지와 가는 방법.
//
// ★ 왜 필요한가 (Irene 2026-08-31, 여러 번 요청):
//   "잘못 누르면 다시 못 돌아가서 당혹스러워."
//   데스크탑 브라우저는 뒤로가기가 있지만 **모바일·네이티브 앱에는 그 버튼이 아예 없어서**
//   한 번 잘못 들어가면 빠져나올 길이 없었다.
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
  const depth = useRef(0);
  const lastPath = useRef<string>(activePathOf());
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    const onChange = () => {
      const p = activePathOf();
      if (p === lastPath.current) return;
      lastPath.current = p;
      // 뒤로/앞으로인지 구분할 수 없으므로 깊이는 goBack 에서만 줄인다.
      depth.current += 1;
      setCanGoBack(true);
    };
    const off = tabStore.subscribe(onChange);
    // 셸(단일 탭) 모드에서 tabStore 가 안 움직이는 경로가 있어도 popstate 는 온다.
    window.addEventListener('popstate', onChange);
    return () => { off(); window.removeEventListener('popstate', onChange); };
  }, []);

  const goBack = () => {
    if (depth.current <= 0) return;
    depth.current -= 1;
    if (depth.current <= 0) setCanGoBack(false);
    window.history.back();
  };

  return { canGoBack, goBack };
}
