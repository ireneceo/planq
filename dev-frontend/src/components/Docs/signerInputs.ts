// 서명자 이메일·이름 입력 — 서명 요청 창(PostSignatureModal)의 일반 행과 서명 자리 행(SignSlotThemInput)이 같이 쓴다.
//   PostSignatureModal 에 있던 것을 옮겼다(값 무변경). 두 곳이 각자 선언하면 갈라진다.
import styled from 'styled-components';

export const SignerFields = styled.div`flex: 1; min-width: 0; display: grid; grid-template-columns: 1fr 110px; gap: 6px;`;
export const SignerEmailInput = styled.input`
  border: none; background: transparent; padding: 4px 0;
  font-size: 0.8125rem; color: #0F172A; min-width: 0;
  &::placeholder { color: #CBD5E1; }
  &:focus { outline: none; }
`;
export const SignerNameInput = styled(SignerEmailInput)`
  text-align: right; color: #64748B;
  &::placeholder { color: #CBD5E1; }
`;
