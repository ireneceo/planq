// 탭 안에서의 "뒤로 가기" — 갈 곳이 있는지와 가는 방법.
//
// ★ 왜 필요한가 (Irene 2026-08-31, 여러 번 요청):
//   "잘못 누르면 다시 못 돌아가서 당혹스러워."
//   탭 하나하나가 별도 MemoryRouter(components/Tab/TabPane.tsx)로 돌아간다. 데스크탑은 브라우저
//   뒤로가기가 popstate 로 들어와 동작하지만(PopstateBridge), **모바일·네이티브 앱에는 그 버튼이
//   아예 없다.** 그래서 한 번 잘못 들어가면 빠져나올 길이 없었다.
//
// react-router v6 는 history 길이를 노출하지 않는다. 그래서 이 훅이 **이 pane 안에서 일어난
// 위치 변화 횟수**를 직접 센다. 0 이면 뒤로 갈 곳이 없다 — 그때는 버튼을 그리지 않는다
// (눌러도 아무 일 없는 버튼은 고장으로 읽힌다).
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export function usePaneBack(): { canGoBack: boolean; goBack: () => void } {
  const location = useLocation();
  const navigate = useNavigate();
  const depth = useRef(0);
  const lastKey = useRef(location.key);
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    if (location.key === lastKey.current) return;
    lastKey.current = location.key;
    // POP(뒤로/앞으로)인지 PUSH 인지 구분할 수 없으므로 깊이는 goBack 에서만 줄인다.
    depth.current += 1;
    setCanGoBack(true);
  }, [location.key]);

  const goBack = () => {
    if (depth.current <= 0) return;
    depth.current -= 1;
    if (depth.current <= 0) setCanGoBack(false);
    navigate(-1);
  };

  return { canGoBack, goBack };
}
