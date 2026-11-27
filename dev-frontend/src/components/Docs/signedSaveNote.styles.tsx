import styled from 'styled-components';

// 안내 줄 안의 글자 버튼(«열기») — 어두운 줄 위 밑줄 글자. 36px 높이 대신 줄 높이를 따른다(줄 자체가 버튼이 아니다).
export const ToastLink = styled.button`
  margin-left: 10px; padding: 2px 4px;
  background: none; border: none; cursor: pointer;
  color: #5EEAD4; font: inherit; font-weight: 700; text-decoration: underline;
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; border-radius: 4px; }
`;
