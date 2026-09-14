// 페이지 머리 오른쪽의 **주 액션 버튼** — [+ 새 프로젝트] · [+ 업무 추가] · [+ 고객응대 내역 추가].
// (2026-09-14 공용 추출)
//
// Irene: *"+고객응대 내역 추가 버튼은 Q task 에 +업무추가랑 같은 버튼으로 해. 활성화 버튼."*
//        *"프로젝트 헤더처럼."*
//
// ★ 세 화면이 같은 버튼을 **각자 선언**하고 있었다(실측):
//     · 프로젝트 `NewProjectCta`  — #14B8A6 / h32 / 0 12px / 13px / 600
//     · Q task  `HeaderAddBtn`    — #14B8A6 / h36 / 0 14px / 13px / **700**
//     · Q sale  ActionButton xs   — secondary(흰 배경) ← 아예 다른 톤이었다
//   그래서 "같은 버튼으로 해" 라는 말이 나올 수밖에 없었다.
//   값은 **프로젝트 헤더 것을 정본**으로 모았다(색을 새로 만들지 않았다).
//
// ★ 왜 `ActionButton tone="primary"` 가 아닌가 — 그 톤은 #0F766E(더 진한 초록)이고,
//   머리줄 CTA 세 곳은 전부 #14B8A6 이다. 여기서 ActionButton 을 쓰면 **화면이 바뀐다**
//   (Irene: *"색상이나 디자인 막 바꾸지 말고 배치를 맞춰봐."*). 새 톤을 만든 것이 아니라
//   이미 있던 머리줄 CTA 규격을 한 곳으로 모은 것이다.
//
// 높이는 32 가 기본이다. Q task 만 36 으로 남겨 두었다 — 그 화면의 머리줄 컨트롤이 36 이라
// 거기만 32 로 낮추면 줄이 들쭉날쭉해진다. 바꿀 일이 있으면 **이 파일 한 곳**에서 바꾼다.
import styled from 'styled-components';

export const HeaderCta = styled.button<{ $h?: 32 | 36; $collapseOnPhone?: boolean }>`
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  flex-shrink: 0;
  height: ${p => p.$h ?? 32}px; padding: 0 ${p => (p.$h === 36 ? 14 : 12)}px;
  background: #14B8A6; color: #FFF; border: none; border-radius: 8px;
  font-size: 0.8125rem; font-weight: 600; cursor: pointer; white-space: nowrap;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
  &:focus-visible { outline: 2px solid #0F766E; outline-offset: 2px; }
  /* 아이콘(+). ★ height 를 적지 않는다 — viewBox 가 있는 svg 는 폭만 주면 비율대로 따라오고,
     UI 규격 가드는 height:<n>px 를 **컨트롤 높이**로 세기 때문에 장식 높이를 적으면
     규격을 지킨 코드가 래칫을 올린다(guard-invariants.js:1365 의 알려진 한계).
     (주석 안에 백틱을 쓰지 않는다 — styled 템플릿이 거기서 끊긴다. memory
      feedback_styled_comment_backtick) */
  svg { width: 14px; flex-shrink: 0; }
  ${p => p.$collapseOnPhone ? `
  @media (max-width: 640px) { width: ${p.$h ?? 32}px; padding: 0; span { display: none; } }
  ` : ''}
`;

export default HeaderCta;
