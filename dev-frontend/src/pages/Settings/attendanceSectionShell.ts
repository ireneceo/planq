// 설정 › 근태 관리 섹션 껍데기 — 「휴가 설정」·「휴일·근무일」이 같이 쓴다(2026-10-22).
//   두 섹션이 각자 styled 를 적으면 반드시 갈라진다(CLAUDE.md «껍데기는 빼서 같이 쓴다»). 값은 휴일 섹션 것을 그대로 옮겼다.
import styled from 'styled-components';

export const Section = styled.section`
  display: flex; flex-direction: column; gap: 10px;
  padding: 16px; margin-bottom: 20px;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 12px;
`;
export const Head = styled.div` display: flex; align-items: center; justify-content: space-between; `;
export const Title = styled.h3` margin: 0; font-size: 0.9375rem; font-weight: 700; color: #0F172A; `;
export const Hint = styled.p` margin: 0; font-size: 0.8125rem; color: #64748B; line-height: 1.5; `;
export const AddRow = styled.div` display: flex; align-items: center; gap: 8px; flex-wrap: wrap; `;
export const NameInput = styled.input`
  flex: 1 1 180px; min-width: 0; height: 36px; padding: 0 10px;
  border: 1px solid #CBD5E1; border-radius: 8px; font-size: 0.875rem;
  &:focus { outline: none; border-color: #14B8A6; }
  &:disabled { background: #F8FAFC; color: #94A3B8; }
`;
export const ErrText = styled.span` flex-basis: 100%; font-size: 0.75rem; color: #DC2626; `;
export const Empty = styled.div` padding: 16px 0; font-size: 0.8125rem; color: #94A3B8; `;
export const List = styled.ul` list-style: none; margin: 0; padding: 0; border-top: 1px solid #F1F5F9; `;
export const Row = styled.li<{ $muted: boolean }>`
  display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 6px 0;
  border-bottom: 1px solid #F1F5F9;
  color: ${(p) => (p.$muted ? '#94A3B8' : '#0F172A')};
`;
export const Badge = styled.span<{ $accent: boolean }>`
  font-size: 0.6875rem; padding: 2px 6px; border-radius: 6px;
  background: ${(p) => (p.$accent ? '#F0FDFA' : '#F1F5F9')};
  color: ${(p) => (p.$accent ? '#0F766E' : '#64748B')};
`;
export const DelBtn = styled.button`
  width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center;
  border: none; background: none; border-radius: 8px; color: #94A3B8; cursor: pointer;
  &:hover { background: #FEF2F2; color: #DC2626; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
