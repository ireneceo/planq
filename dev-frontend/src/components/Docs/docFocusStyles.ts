// components/Docs/docFocusStyles.ts — 문서 집중 편집의 모양 조각 (설명은 docFocusMode.tsx 머리말).
// 스타일 파일(PostsPage.styles)이 가져다 쓰므로 화면 코드와 따로 둔다 — 한 파일에 두면 서로를 불러 순환한다.
import styled, { css } from 'styled-components';
import { focusBackdropCss, focusSurfaceCss } from '../Common/focusShell';

// 앱 크롬(≤100)·안내 띠 위, 편집기가 여는 창(모달 1000~1200·메뉴 10000) 아래.
const FOCUS_Z = 900;

/** 어두운 막 — 누르면 집중 편집만 끝난다(편집은 그대로). */
export const DocFocusBackdrop = styled.div`
  ${focusBackdropCss}
  z-index: ${FOCUS_Z};
`;

/** Content 상자에 얹는 조각 — 켜졌을 때만. 데스크탑은 가운데 1100px 판, ≤768 은 꽉 찬 화면. */
export const docFocusSurface = css`
  ${focusSurfaceCss}
  position: fixed; z-index: ${FOCUS_Z + 1};
  top: calc(var(--pq-popup-top, 0px) + 24px); bottom: 24px;
  left: 0; right: 0; margin: 0 auto;
  width: min(1100px, calc(100% - 48px));
  display: flex; flex-direction: column;
  @media (max-width: 768px) {
    top: var(--pq-popup-top, 0px); bottom: 0; width: 100%;
  }
  [data-testid='docs-meta-summary'], [data-testid='docs-meta-row'] { display: none; }
`;
