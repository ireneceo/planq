// 반응형 브레이크포인트 토큰.
// 새 컴포넌트는 하드코딩된 px 대신 이 토큰을 참조해야 함.
// 실제 반응형 스프린트(Phase 1~4)는 기능 95% 완료 후 착수 예정.
//
// 기준:
//   phone:   ~640px   (모바일 세로)
//   tablet:  641~1024 (모바일 가로 / 태블릿)
//   desktop: 1025+    (노트북 / 데스크탑 — 현재 설계 타겟)
//
// 사용 예:
//   import { mediaPhone } from 'theme/breakpoints';
//   const Box = styled.div`
//     padding: 20px;
//     ${mediaPhone} { padding: 12px; }
//   `;

export const BP = {
  phone: 640,
  tablet: 1024,
} as const;

// styled-components 용 미디어쿼리 문자열
export const mediaPhone = `@media (max-width: ${BP.phone}px)`;
export const mediaTablet = `@media (max-width: ${BP.tablet}px)`;
export const mediaDesktopUp = `@media (min-width: ${BP.tablet + 1}px)`;
