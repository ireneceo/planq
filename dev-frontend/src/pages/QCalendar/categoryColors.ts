import type { EventCategory, CalendarEvent } from './types';

// 카테고리별 기본 팔레트 (파스텔 bg + 진한 fg) — 간트·상태 pill 과 톤 통일
export const CATEGORY_PALETTE: Record<EventCategory, { bg: string; fg: string; border: string }> = {
  personal: { bg: '#F0FDFA', fg: '#0F766E', border: '#5EEAD4' },
  work:     { bg: '#ECFDF5', fg: '#0F766E', border: '#5EEAD4' },
  meeting:  { bg: '#EFF6FF', fg: '#1D4ED8', border: '#93C5FD' },
  deadline: { bg: '#FFF1F2', fg: '#BE123C', border: '#FDA4AF' },
  other:    { bg: '#F1F5F9', fg: '#334155', border: '#CBD5E1' },
};

// hex → 파스텔 bg (알파 15%) + 진한 fg (원본) 유틸
const hexToPastel = (hex: string): { bg: string; fg: string; border: string } => {
  const normalized = hex.replace('#', '');
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return {
    bg: `rgba(${r},${g},${b},0.12)`,
    fg: hex,
    border: `rgba(${r},${g},${b},0.45)`,
  };
};

// 우선순위: event.color(커스텀) > project.color > 분류 색(워크스페이스가 정한 색) > 기본 분류 팔레트
//   분류 목록은 서버가 정본이다(calendarCategories.ts) — 화면에 분류 목록을 적지 않는다(2026-11-27).
export const getEventColors = (event: CalendarEvent) => {
  if (event.color && /^#[0-9A-Fa-f]{6}$/.test(event.color)) return hexToPastel(event.color);
  if (event.Project?.color && /^#[0-9A-Fa-f]{6}$/.test(event.Project.color)) return hexToPastel(event.Project.color);
  const ref = event.category_ref;
  if (ref?.color && /^#[0-9A-Fa-f]{6}$/.test(ref.color)) return hexToPastel(ref.color);
  const code = (ref?.code || event.category) as EventCategory;
  return CATEGORY_PALETTE[code] || CATEGORY_PALETTE.other;
};
