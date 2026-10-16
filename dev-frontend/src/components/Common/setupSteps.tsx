// 설정 화면의 «이렇게 연결하세요» 단계 안내 껍데기 — 한 벌 (2026-10-16).
//   처음 쓰인 곳은 프로필 › AI 앱 연결(ConnectedAiAppsSection)이고, Q Bill 카드 결제 설정 안내가 같은 모양을 쓴다.
//   값은 그 화면에서 옮겨 온 그대로다(바꾸지 않는다) — 화면마다 베끼면 번호 색·간격이 갈라진다.
import styled from 'styled-components';

export const HowTo = styled.div`
  display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px;
  font-size: 0.75rem; color: #475569; line-height: 1.5;
`;
export const Steps = styled.ol`
  margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 10px;
  li::marker { color: #0D9488; font-weight: 700; }
`;
export const OpenRow = styled.div`display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px;`;
export const OpenLink = styled.a`
  height: 32px; padding: 0 12px; display: inline-flex; align-items: center; border-radius: 6px;
  background: #F0FDFA; border: 1px solid #99F6E4; color: #0F766E; font-size: 0.75rem; font-weight: 600; text-decoration: none;
  &:hover { background: #CCFBF1; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
  @media (max-width: 640px) { height: 40px; }
`;
export const StepHint = styled.div`margin-top: 4px; font-size: 0.6875rem; color: #64748B;`;
