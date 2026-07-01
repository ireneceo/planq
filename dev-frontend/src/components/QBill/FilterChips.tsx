// Q Bill 공용 필터 칩 (청구서 탭 · 증빙 탭 통일).
//   active = 포인트 컬러(teal #14B8A6). 옛 검정(#0F172A) 대신 브랜드 컬러로 통일 — Q docs 등과 일관.
//   단일 원천 — 두 탭이 같은 컴포넌트를 써서 앞으로도 어긋나지 않게.
import styled from 'styled-components';

export const ChipBar = styled.div`
  display: flex; gap: 6px; flex-wrap: wrap;
`;
export const Chip = styled.button<{ $active: boolean }>`
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; font-size: 12px; font-weight: 600;
  background: ${p => p.$active ? '#14B8A6' : '#fff'};
  color: ${p => p.$active ? '#fff' : '#475569'};
  border: 1px solid ${p => p.$active ? '#14B8A6' : '#E2E8F0'};
  border-radius: 999px; cursor: pointer;
  transition: all 0.15s;
  &:hover { border-color: ${p => p.$active ? '#0D9488' : '#CBD5E1'}; color: ${p => p.$active ? '#fff' : '#0F172A'}; }
`;
export const ChipCount = styled.span<{ $active: boolean }>`
  font-size: 11px; font-weight: 700;
  padding: 1px 6px; border-radius: 999px;
  background: ${p => p.$active ? 'rgba(255,255,255,0.25)' : '#F1F5F9'};
  color: ${p => p.$active ? '#fff' : '#475569'};
`;
