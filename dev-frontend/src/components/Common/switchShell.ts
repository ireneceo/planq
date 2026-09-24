// 켜고 끄는 스위치(36×20) — **값을 한 곳에 둔다.**
//
// 왜: 설정 화면마다 같은 스위치를 styled 로 다시 그리고 있었다(NotificationSettings · WorkManagementSettings ·
//   FocusSettingsCard · IntegratedReportView …). 2026-09-24 권한 설정에 하나를 더 넣으려다 **세 번째 복사본**이
//   될 뻔했다 — 복사본은 갈라진다(memory feedback_copied_component_drifts_extract_shell).
//   값은 NotificationSettings 의 것을 그대로 옮기고 두 줄만 더했다 — `flex-shrink:0`(줄이 좁아도 안 눌린다) ·
//   `:disabled`(오너만 바꾸는 설정). 나머지 복사본은 필요할 때 이리로 모은다.
// 쓰는 법: `<AutoSaveField type="toggle"><Switch role="switch" aria-checked={on} $on={on}><SwitchKnob $on={on} /></Switch></AutoSaveField>`
import styled from 'styled-components';

export const Switch = styled.button<{ $on: boolean }>`
  width: 36px; height: 20px; border-radius: 999px; border: none;
  background: ${p => p.$on ? '#14B8A6' : '#CBD5E1'};
  position: relative; cursor: pointer; flex-shrink: 0;
  transition: background 0.15s;
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
  &:disabled { cursor: not-allowed; opacity: 0.6; }
`;
export const SwitchKnob = styled.span<{ $on: boolean }>`
  position: absolute; top: 2px; left: ${p => p.$on ? '18px' : '2px'};
  width: 16px; height: 16px; border-radius: 50%; background: #fff;
  transition: left 0.15s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.15);
`;
