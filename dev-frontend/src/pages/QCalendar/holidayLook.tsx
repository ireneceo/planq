// 캘린더 휴일 표시 — 월 보기 날짜 칸 · 주/일 보기 종일 칸 공용 (#424 Q3 후속)
//   휴일은 일정이 아니다(누를 수 없다) — 칩 모양 대신 날짜 옆 글자로, 일요일과 같은 붉은 계열로 둔다.
import styled from 'styled-components';
import type { HolidayMark } from '../../hooks/useWorkspaceHolidays';

export const holidayLabel = (h: HolidayMark, lang?: string) => (lang?.startsWith('en') && h.name_en ? h.name_en : h.name);

export const HolidayName = styled.span<{ $block?: boolean }>`
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 0.6875rem; font-weight: 600; color: #DC2626; line-height: 1.3;
  ${(p) => (p.$block ? 'display:block; padding: 1px 4px;' : 'flex: 1 1 auto; margin: 0 4px;')}
  /* 폰 월 보기는 칸이 ~50px 이라 날짜·+ 버튼 사이에서 폭 0 으로 눌렸다(실측) — 다음 줄로 내려 칸 폭을 다 쓴다 */
  @media (max-width: 640px) { ${(p) => (p.$block ? '' : 'flex: 1 1 100%; order: 3; margin: 0; font-size: 0.625rem;')} }
`;
