import styled from 'styled-components';

// 문서 상세 «첨부 파일·문서» 의 연결 문서 줄 끝 «PDF 받기» (2026-11-03)
//   PostsPage.styles 가 800줄 래칫에 닿아 따로 둔다. 높이는 컨트롤 토큰 32.
export const LinkedPdfBtn = styled.button`
  flex-shrink: 0; height: 32px; padding: 0 10px; border-radius: 6px;
  display: inline-flex; align-items: center; gap: 4px; text-decoration: none; white-space: nowrap;
  border: 1px solid #E2E8F0; background: #fff; color: #334155;
  font-size: 0.75rem; font-weight: 600; font-family: inherit; cursor: pointer;
  &:hover:not(:disabled) { border-color: #14B8A6; color: #0F766E; }
  &:disabled { opacity: 0.6; cursor: default; }
`;

// 줄 끝 단추의 뜻 아이콘 — ↓ = 내려받기, ↗ = 열기 (2026-11-03 Irene «누르면 열릴 것 같은데 갑자기 다운로드 되서»)
export const DlIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
);
export const OpenIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
);

// 줄의 이름 — 누를 수 없는 글자(누르는 일은 오른쪽 단추가 한다). AttachName 은 눌리는 모양(밑줄·손가락)이라 따로 둔다.
export const AttachText = styled.span`
  flex: 1; min-width: 0; font-size: 0.8125rem; color: #0F172A;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
