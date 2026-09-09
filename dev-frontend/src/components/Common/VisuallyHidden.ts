// 화면에는 안 보이지만 스크린리더는 읽는 영역.
//   상태 변화를 **글리프로만** 알리는 컨트롤(예: 복사 버튼이 ✓ 로 바뀌는 것)은
//   눈으로 보는 사람에게만 결과를 준다. 그 결과를 소리로도 남기는 자리다.
//   ★ `display:none` / `visibility:hidden` 은 스크린리더도 건너뛴다 — 쓰면 안 된다.
//     자리를 0으로 만들되 **렌더 트리에는 남기는** 표준 클립 기법을 쓴다.
import styled from 'styled-components';

const VisuallyHidden = styled.span`
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
`;

export default VisuallyHidden;
