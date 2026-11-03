import styled from 'styled-components';

// 문서 상세 «첨부 파일·문서» 의 연결 문서 줄 끝 «PDF 받기» (2026-11-03)
//   PostsPage.styles 가 800줄 래칫에 닿아 따로 둔다. 높이는 컨트롤 토큰 32.
export const LinkedPdfBtn = styled.button`
  flex-shrink: 0; height: 32px; padding: 0 10px; border-radius: 6px;
  border: 1px solid #E2E8F0; background: #fff; color: #334155;
  font-size: 0.75rem; font-weight: 600; font-family: inherit; cursor: pointer;
  &:hover:not(:disabled) { border-color: #14B8A6; color: #0F766E; }
  &:disabled { opacity: 0.6; cursor: default; }
`;
