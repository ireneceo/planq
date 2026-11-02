// components/Docs/docFocusStyles.ts — 문서 집중 편집의 모양 조각 (설명은 docFocusMode.tsx 머리말).
// 스타일 파일(PostsPage.styles)이 가져다 쓰므로 화면 코드와 따로 둔다 — 한 파일에 두면 서로를 불러 순환한다.
import styled, { css } from 'styled-components';
import { focusBackdropCss, focusFloatingCss } from '../Common/focusShell';

// 앱 크롬(≤100)·안내 띠 위, 편집기가 여는 창(모달 1000~1200·메뉴 10000) 아래.
const FOCUS_Z = 900;

/** 어두운 막 — 누르면 집중 편집만 끝난다(편집은 그대로). */
export const DocFocusBackdrop = styled.div`
  ${focusBackdropCss}
  z-index: ${FOCUS_Z};
`;

/** Content 상자에 얹는 조각 — 켜졌을 때만. 판 위치·모양은 공용 focusFloatingCss. */
export const docFocusSurface = css`
  ${focusFloatingCss}
  z-index: ${FOCUS_Z + 1};
  [data-testid='docs-meta-summary'], [data-testid='docs-meta-row'] { display: none; }
`;

/** ★ 글 쓰는 중(화면 키보드 + 편집기 포커스, index.css «글 쓰는 중» · html[data-pq-compose]) — 편집 판을 저절로 화면 전체로 띄운다
 *  (2026-11-02 Fable 설계 2단계). 아이패드 가로는 문서 목록·사이드바가 왼쪽 544px 를 계속 먹고, 위쪽 줄이 키보드 뒤 415px 를 다 먹었다.
 *  «전체 화면으로 쓰기» 와 같은 자리 띄우기(편집기를 옮기지 않는다 — TipTap 다시 마운트 금지). 높이는 보이는 영역(--vvh)에 묶는다 —
 *  bottom 으로 잡으면 아이폰·아이패드에서는 키보드 뒤까지 내려간다. 상태바 자리는 --pq-popup-safe-pad. 키보드를 내리면 저절로 제자리. */
export const docComposeSurface = css`
  html[data-pq-compose] & {
    position: fixed; z-index: ${FOCUS_Z + 1};
    top: var(--pq-popup-top, 0px); left: 0; right: 0; bottom: auto;
    width: 100%; margin: 0; box-sizing: border-box;
    padding-top: var(--pq-popup-safe-pad, 0px);
    height: calc(var(--vvh, 100dvh) - var(--pq-popup-top, 0px));
    border-radius: 0; box-shadow: none;
  }
`;
