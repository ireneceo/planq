// 패널 폭 조절 — 좌측 리스트 · 우측 패널 공통.
//
// 여태 우측 패널만 폭을 조절할 수 있었다. 좌측 리스트(대화·메일·세션·문서)는 300px 고정이라
// 제목이 길면 답답했다 (Irene). 다섯 화면(Q Talk·Q Mail·Q docs·Q Note·Q Task)이 같은 방식으로
// 조절되게 이 하나를 쓴다. 폭은 화면별로 localStorage 에 저장돼 다음에 들어와도 그대로다.
import { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';

export const PANEL_MIN_W = 240;
export const PANEL_MAX_W = 520;

/**
 * 패널 폭 상태 + 드래그 시작 핸들러.
 * @param storageKey localStorage 키 (화면별로 다르게 — 예: 'qmail_list_width')
 * @param defaultWidth 기본 폭
 * @param side  'left'  = 오른쪽 경계를 잡아 늘린다 (좌측 리스트)
 *              'right' = 왼쪽 경계를 잡아 늘린다 (우측 패널)
 */
export function usePanelWidth(storageKey: string, defaultWidth = 300, side: 'left' | 'right' = 'left') {
  const [width, setWidth] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem(storageKey));
      return v ? Math.min(PANEL_MAX_W, Math.max(PANEL_MIN_W, v)) : defaultWidth;
    } catch { return defaultWidth; }
  });
  const resizing = useRef(false);
  // 패널의 화면상 시작 x — 앱 사이드바(MainLayout) 폭만큼 오른쪽에서 시작한다.
  //   clientX 를 그대로 폭으로 쓰면 앱 사이드바 폭(약 220px)이 더해져 실제보다 넓게 잡힌다.
  const originX = useRef(0);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const panel = (e.currentTarget as HTMLElement).parentElement;
    originX.current = panel ? panel.getBoundingClientRect().left : 0;
    resizing.current = true;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizing.current) return;
      const next = side === 'left' ? (e.clientX - originX.current) : (window.innerWidth - e.clientX);
      setWidth(Math.min(PANEL_MAX_W, Math.max(PANEL_MIN_W, next)));
    };
    const onUp = () => {
      if (!resizing.current) return;
      resizing.current = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      try { localStorage.setItem(storageKey, String(width)); } catch { /* 사파리 프라이빗 */ }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [storageKey, width, side]);

  return { width, startResize };
}

/** 드래그 바 — 패널 경계에 놓는다 (부모가 position: relative). 태블릿 이하는 숨김(오버레이 드로어라 의미 없음) */
const PanelResizeHandle = styled.div<{ $side?: 'left' | 'right' }>`
  position: absolute;
  top: 0; bottom: 0;
  /* 패널 **안쪽** 경계에 붙인다 — 바깥(-3px)에 두면 overflow:hidden 인 사이드바에서 잘려 클릭이 안 된다 */
  ${(p) => (p.$side === 'right' ? 'left: 0;' : 'right: 0;')}
  width: 6px;
  cursor: col-resize;
  z-index: 6;
  &:hover { background: rgba(20, 184, 166, 0.18); }
  @media (max-width: 1024px) { display: none; }
`;

export default PanelResizeHandle;
