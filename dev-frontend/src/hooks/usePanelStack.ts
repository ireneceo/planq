// 2·3단 화면의 단일 레이아웃 계약 (2026-08-25).
//
// 문제: 같은 "목록 + 상세 + 보조패널" 구조를 페이지마다 다르게 구현하고 있었다 — 실측:
//   · Q Talk  : mobileHidden props (드릴다운)
//   · Q Mail  : sidebarCollapsed + viewportNarrow + ctxNarrow (오버레이 드로어)
//   · Q Note  : sidebarCollapsed + viewportNarrow
//   · Q Task  : isNarrow + rightOverlayOpen
//   구현이 다르니 **동작도 달랐다** — 어떤 화면은 뒤로가기가 되고 어떤 화면은 안 되고,
//   어떤 화면은 목록이 85% 오버레이로 뜨고 어떤 화면은 전체폭이었다(Irene: "다 다르다").
//
// 계약(theme/tokens.PANEL_BP):
//   ≥1280 : 목록 + 상세 + 보조 3단 동시
//   ≥1025 : 목록 + 상세 2단 (보조는 접힘, 핸들로 토글)
//   ≤1024 : **드릴다운** — 한 번에 하나만. 목록 → (선택) 상세 → (열기) 보조.
//           뒤로 가기는 한 단계씩 되돌린다. 목록은 항상 전체폭이다.
//
// 이 훅은 "무엇을 보여줄지" 만 정한다. 그리기는 각 페이지가 한다(점진 이관 가능).
import { useCallback, useEffect, useState } from 'react';
import { PANEL_BP } from '../theme/tokens';

export type PanelPane = 'list' | 'detail' | 'aside';

export interface PanelStack {
  /** 현재 폭 구간 */
  cols: 1 | 2 | 3;
  /** 드릴다운 모드인가 (한 번에 하나) */
  drilldown: boolean;
  /** 지금 그려야 하는 것들 */
  showList: boolean;
  showDetail: boolean;
  showAside: boolean;
  /** 드릴다운에서 현재 보이는 단계 */
  active: PanelPane;
  /** 보조 패널 토글 (2·3단에서는 접기/펴기, 드릴다운에서는 열기/닫기) */
  asideOpen: boolean;
  setAsideOpen: (v: boolean) => void;
  /** 한 단계 뒤로 — aside → detail → list. 더 갈 곳이 없으면 false 를 돌려준다. */
  goBack: () => boolean;
  /** 뒤로 갈 곳이 있는가 (뒤로 버튼 노출 판단) */
  canGoBack: boolean;
}

function readCols(): 1 | 2 | 3 {
  if (typeof window === 'undefined') return 3;
  const w = window.innerWidth;
  if (w >= PANEL_BP.threeCol) return 3;
  if (w >= PANEL_BP.twoCol) return 2;
  return 1;
}

/**
 * @param hasDetail 상세로 들어갈 대상이 선택됐는가 (예: 선택된 대화·메일·노트)
 * @param hasAside  보조 패널이 이 화면에 존재하는가 (작업대·맥락 등)
 * @param onCloseDetail 드릴다운에서 목록으로 돌아갈 때 선택을 해제하는 콜백
 */
export function usePanelStack(hasDetail: boolean, hasAside: boolean, onCloseDetail?: () => void): PanelStack {
  const [cols, setCols] = useState<1 | 2 | 3>(readCols);
  const [asideOpen, setAsideOpen] = useState(false);

  useEffect(() => {
    const onResize = () => setCols(readCols());
    window.addEventListener('resize', onResize);
    // 폭이 바뀌면 보조 패널 상태를 정리한다 — 드릴다운에서 열어둔 채 넓어지면 유령 오버레이가 남는다.
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const drilldown = cols === 1;
  const active: PanelPane = drilldown
    ? (asideOpen && hasAside ? 'aside' : (hasDetail ? 'detail' : 'list'))
    : 'detail';

  const showList = drilldown ? active === 'list' : true;
  const showDetail = drilldown ? active === 'detail' : hasDetail || cols >= 2;
  const showAside = hasAside && (drilldown ? active === 'aside' : (cols === 3 ? true : asideOpen));

  const goBack = useCallback((): boolean => {
    if (asideOpen) { setAsideOpen(false); return true; }
    if (hasDetail) { onCloseDetail?.(); return true; }
    return false;
  }, [asideOpen, hasDetail, onCloseDetail]);

  return {
    cols, drilldown, showList, showDetail, showAside, active,
    asideOpen, setAsideOpen, goBack,
    canGoBack: drilldown && (asideOpen || hasDetail),
  };
}
