// 팝오버 안의 고르기 목록(사람 고르기 등) — ChipPopover 안에서 쓴다. 메일 담당·문서 공동 편집자가 같이 쓴다(2026-10-23 MailPage.styles 에서 뺐다).
//   react-select·PlanQSelect 를 쓰지 않는 이유: 포털된 메뉴는 팝오버의 "바깥클릭" 으로 읽혀 선택 전에 닫힌다(CLAUDE.md 밴드2 절).
import styled from 'styled-components';

export const PickerFilter = styled.input`
  width: 100%; box-sizing: border-box;
  height: 30px; padding: 0 10px;
  border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 0.75rem; color: #0F172A;
  &::placeholder { color: #94A3B8; }
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 2px rgba(20,184,166,0.15); }
`;
export const PickerList = styled.div`
  display: flex; flex-direction: column; gap: 2px;
  max-height: 240px; overflow-y: auto;
`;
export const PickerItem = styled.button<{ $on?: boolean }>`
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px; border: none; border-radius: 6px;
  background: ${p => (p.$on ? '#F0FDFA' : 'transparent')};
  color: ${p => (p.$on ? '#0F766E' : '#0F172A')};
  font-size: 0.8125rem; font-weight: ${p => (p.$on ? 600 : 500)};
  text-align: left; cursor: pointer; white-space: nowrap;
  &:hover { background: ${p => (p.$on ? '#CCFBF1' : '#F8FAFC')}; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: -2px; }
  @media (max-width: 640px) { min-height: 44px; }
`;
export const PickerHint = styled.span`
  margin-left: auto; padding-left: 10px;
  font-size: 0.6875rem; font-weight: 600; color: #94A3B8;
`;

