// 연회색 알약 탭 — Q task 상단의 [내 업무 | 전체 업무] 와 **같은 것**. (2026-09-14 공용 추출)
//
// Irene: *"Q sale UI를 Q task 처럼 해줘. 우측 상단에 연회색 탭으로 상담, 고객을 넣어주고…
//          색상이나 디자인 막 바꾸지 말고 배치를 맞춰봐. 그리고 칸, 버튼 스타일은 맞추고."*
//
// ★ 베끼지 않고 **빼서 같이 쓴다.** 화면마다 다시 선언하면 반드시 갈라진다 —
//   이 저장소에서 이미 여러 번 났던 일이다(memory `feedback_copied_component_drifts_extract_shell`).
//   값(색·높이·그림자)은 QTaskPage 에 있던 것 그대로다. 옮기면서 디자인을 바꾸지 않는다.
import styled from 'styled-components';

export const SegmentedToggle = styled.div`
  display: inline-flex; gap: 4px; padding: 3px;
  background: #F1F5F9; border-radius: 8px;
`;

export const SegmentedBtn = styled.button<{ $active: boolean }>`
  padding: 6px 14px; font-size: 0.8125rem; font-weight: 600;
  background: ${p => (p.$active ? '#FFFFFF' : 'transparent')};
  color: ${p => (p.$active ? '#0F172A' : '#64748B')};
  border: none; border-radius: 6px; cursor: pointer;
  box-shadow: ${p => (p.$active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none')};
  transition: background 0.15s, color 0.15s;
  &:hover { background: ${p => (p.$active ? '#FFFFFF' : '#E2E8F0')}; color: #0F172A; }
`;
