// 팝업(모달) 껍데기의 **공유 규격**. 각자 다시 쓰면 반드시 갈라진다.
//
// ★ 하단 라운드 — 2026-09-07 에 StandardModal 하나만 고쳤다가 **2026-09-10 에 되돌아왔다.**
//   Irene: "지금 팝업들이 하단에 라운드가 없어졌어. 사각라운드 다 나와야 하는데."
//   구조는 전부 같다 — Dialog 가 14px 라운드를 그리고 그 안 마지막 조각(Footer)이
//   **흰 사각 배경**이라 라운드를 덮는다. 헤더는 배경이 없어 위쪽만 둥글게 보인다.
//
//   Dialog 에 `overflow: hidden` 을 주는 것이 간단해 보이지만 **안쪽 팝오버·드롭다운이
//   같이 잘린다**(셀렉트 메뉴가 모달 밖으로 못 나간다). 그래서 껍데기를 자르지 않고
//   **마지막 조각만 같은 값으로 깎는다.**
//
//   폰(≤640px)에서는 Dialog 가 전면(`border-radius: 0`)이므로 푸터도 각져야 한다.
import { css } from 'styled-components';

/** 팝업 껍데기(Dialog)의 모서리 반경 — 값을 손으로 적지 말고 이것을 쓴다. */
export const MODAL_RADIUS = '14px';

/**
 * 팝업 **마지막 조각**(푸터/액션 줄)에 붙인다. 배경이 있는 마지막 자식이면 무조건 필요하다.
 * 없으면 그 배경이 껍데기의 라운드를 덮어 하단만 직각이 된다.
 */
export const modalFooterRadius = css`
  border-radius: 0 0 ${MODAL_RADIUS} ${MODAL_RADIUS};
  @media (max-width: 640px) { border-radius: 0; }
`;
