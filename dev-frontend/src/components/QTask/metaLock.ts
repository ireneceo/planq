// 읽기 전용 자물쇠 — 업무 상세 메타 칸과 «산출물» 칸이 같이 쓴다(TaskDetailDrawer 에서 옮김, 값 그대로).
import styled from 'styled-components';

// 읽기 전용 표시 — 라벨 칸(64px)에 «읽기 전용» 알약이 들어가지 않아 자물쇠 하나로. 값 셀렉트는 화살표가 사라진다.
export const MetaLock = styled.span`
  flex-shrink: 0; width: 10px; height: 10px;
  background: currentColor; color: #CBD5E1;
  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M6 10V7a6 6 0 1 1 12 0v3h1a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1h1zm2 0h8V7a4 4 0 1 0-8 0v3z'/%3E%3C/svg%3E") center/contain no-repeat;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M6 10V7a6 6 0 1 1 12 0v3h1a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1h1zm2 0h8V7a4 4 0 1 0-8 0v3z'/%3E%3C/svg%3E") center/contain no-repeat;
`;
