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

/**
 * ★ 폰 전면 팝업의 **버튼 줄은 화면에 고정하지 않는다** (2026-10-22 — 전 팝업·우측 패널 공통).
 *   Irene: "일정 추가할 때 모바일에서 푸터가 이상하게 높게 나오고 아래 뚫려서 뒤 내용 스크롤 하면 다 보여서
 *   에러같고 날짜지정이나 다른 거 입력하려는데도 방해 … 모바일에서는 모든 고정푸터 다 고정 안해야 하는 거 아니야?"
 *   본문만 굴리고 버튼 줄을 형제로 두면, 키보드가 뜰 때 껍데기가 보이는 높이(--vvh)로 줄며 버튼 줄이 키보드
 *   바로 위 — 화면 한가운데 — 에 떠서 입력 칸·날짜 고르기를 덮는다. 그래서 폰 전면에서는
 *     · 껍데기 자신이 스크롤 상자(본문 + 버튼 줄을 한 번에 굴린다)
 *     · 머리(제목·닫기)만 위에 붙는다
 *     · 본문은 flex 1 0 auto — 짧으면 버튼 줄이 바닥, 길면 내용 뒤
 *     · 껍데기 아래 틈(보이는 높이 < 실제 화면)은 흰색으로 잇는다(그림자 — 스크롤 상자라 ::after 는 잘린다)
 *   같은 규칙: DetailDrawer(Panel) · StandardModal(Dialog 전면) · DrawerFooter(폰 static).
 *   쓰는 법: 껍데기의 `@media (max-width: 640px)` 안에서 `${() => phoneSheetFlow(Header, Body)}`
 *   (함수로 감싼다 — Header·Body 가 껍데기보다 뒤에 선언돼도 렌더 때 읽는다).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const phoneSheetFlow = (head: any, body: any) => css`
  overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain;
  box-shadow: 0 100vh 0 100vh #fff;
  & > * { flex-shrink: 0; }
  & > ${head} { position: sticky; top: 0; z-index: 3; background: #fff; }
  & > ${body} { flex: 1 0 auto; overflow: visible; min-height: auto; }
`;
