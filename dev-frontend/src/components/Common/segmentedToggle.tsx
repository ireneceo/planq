// 연회색 알약 탭 — Q task 상단의 [내 업무 | 전체 업무] 와 **같은 것**. (2026-09-14 공용 추출)
//
// Irene: *"Q sale UI를 Q task 처럼 해줘. 우측 상단에 연회색 탭으로 상담, 고객을 넣어주고…
//          색상이나 디자인 막 바꾸지 말고 배치를 맞춰봐. 그리고 칸, 버튼 스타일은 맞추고."*
//
// ★ 베끼지 않고 **빼서 같이 쓴다.** 화면마다 다시 선언하면 반드시 갈라진다 —
//   이 저장소에서 이미 여러 번 났던 일이다(memory `feedback_copied_component_drifts_extract_shell`).
//
// ★ 높이는 **32px 고정**이다 (2026-09-14 실측 후 박제).
//   그 전에는 높이를 안 적고 padding 만 줬는데, 그러면 글자 줄높이가 높이를 정한다 —
//   실측 **37px** 이었고 옆에 선 머리줄 CTA(32)와 **5px 어긋나** 있었다(3폭 전부).
//   폰에서 글자를 숨기는 프로젝트 쪽 복사본은 같은 이유로 **30px** 이었다.
//   안쪽 버튼은 `height: 100%` 로 **따라온다** — 여기에 숫자를 적지 않는다(두 곳에 같은 숫자를
//   적는 것 자체가 갈라지는 원인이고, 26 같은 값은 규격 토큰 32/36/40/44 밖이라 가드가 센다).
import styled from 'styled-components';

export const SegmentedToggle = styled.div`
  display: inline-flex; align-items: center; gap: 4px; padding: 3px;
  height: 32px; box-sizing: border-box;
  background: #F1F5F9; border-radius: 8px;
  /* ★ 2026-09-14 (Irene: *"상담 고객이 글자가 왜 세로야?"*)
     머리줄은 flex 라 자리가 모자라면 이 알약이 **먼저 줄어든다**(flex-shrink 기본 1).
     폭이 글자 하나만큼 좁아지면 "상담" 이 세로로 쪼개진다 — 줄이지 않는다. */
  flex-shrink: 0;
`;

export const SegmentedBtn = styled.button<{ $active: boolean }>`
  height: 100%;  /* 알약 높이를 따라온다 — 숫자를 다시 적지 않는다 */
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0 14px; font-size: 0.8125rem; font-weight: 600;
  white-space: nowrap;  /* 두 글자가 세로로 쪼개지지 않는다 */
  background: ${p => (p.$active ? '#FFFFFF' : 'transparent')};
  color: ${p => (p.$active ? '#0F172A' : '#64748B')};
  border: none; border-radius: 6px; cursor: pointer;
  box-shadow: ${p => (p.$active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none')};
  transition: background 0.15s, color 0.15s;
  &:hover { background: ${p => (p.$active ? '#FFFFFF' : '#E2E8F0')}; color: #0F172A; }
`;
