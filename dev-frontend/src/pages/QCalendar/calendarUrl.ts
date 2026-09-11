// Q calendar URL 싱크 — 주소(?view=&date=&event=&scope=)에서 첫 화면 상태를 읽는다.
//   (QCalendarPage 에서 분리 — 페이지가 god-file 기준 800줄을 넘지 않게. 동작 동일)
import type { CalendarViewMode, CalendarScope } from './types';

// #133 — 폰(≤640)에서 무파라미터 진입 시 기본 뷰를 agenda(리스트)로. 명시 ?view= 있으면 항상 존중.
export const defaultView = (): CalendarViewMode =>
  (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 640px)').matches) ? 'agenda' : 'month';

export const readUrl = (search: string) => {
  const p = new URLSearchParams(search);
  const view = (p.get('view') || defaultView()) as CalendarViewMode;
  const dateStr = p.get('date');
  const eventId = p.get('event') ? Number(p.get('event')) : null;
  const scope = (p.get('scope') || 'all') as CalendarScope;
  const date = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();
  return { view, date, eventId, scope };
};
