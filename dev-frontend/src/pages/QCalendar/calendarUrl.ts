// Q calendar URL 싱크 — 주소(?view=&date=&event=&scope=)에서 첫 화면 상태를 읽는다.
//   (QCalendarPage 에서 분리 — 페이지가 god-file 기준 800줄을 넘지 않게. 동작 동일)
import type { CalendarViewMode } from './types';

// #133 — 폰(≤640)에서 무파라미터 진입 시 기본 뷰를 agenda(리스트)로. 명시 ?view= 있으면 항상 존중.
export const defaultView = (): CalendarViewMode =>
  (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 640px)').matches) ? 'agenda' : 'month';

export const readUrl = (search: string) => {
  const p = new URLSearchParams(search);
  const view = (p.get('view') || defaultView()) as CalendarViewMode;
  const dateStr = p.get('date');
  const eventId = p.get('event') ? Number(p.get('event')) : null;
  const date = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();
  const projectId = Number(p.get('project')) || null;
  return { view, date, eventId, projectId };   // 보기 분류(?layers=·옛 ?scope=)는 calendarLayers
};

// 프로젝트 탭에 얹힌 캘린더(#461)는 주소를 못 쓴다(주소는 프로젝트 것) — 보던 보기·날짜를 이 창(sessionStorage)에 프로젝트별로 둔다.
//   탭을 옮겼다 오면 본문이 다시 그려져 오늘·기본 보기로 돌아가던 것(2026-10-15 프로젝트 일정 보완). 못 읽으면 처음 상태.
const embKey = (projectId: number) => `pq:projcal:${projectId}`;
const VIEWS: CalendarViewMode[] = ['agenda', 'month', 'week', 'day'];

export const readEmbedded = (projectId: number) => {
  const base = readUrl('');
  try {
    const raw = window.sessionStorage.getItem(embKey(projectId));
    const j = raw ? JSON.parse(raw) as { view?: string; date?: string } : null;
    if (j && VIEWS.includes(j.view as CalendarViewMode)) base.view = j.view as CalendarViewMode;
    if (j && typeof j.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(j.date)) base.date = new Date(`${j.date}T00:00:00`);
  } catch { /* 사생활 모드 등 */ }
  return base;
};

export const saveEmbedded = (projectId: number, view: CalendarViewMode, anchor: Date) => {
  const d = `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, '0')}-${String(anchor.getDate()).padStart(2, '0')}`;
  try { window.sessionStorage.setItem(embKey(projectId), JSON.stringify({ view, date: d })); } catch { /* 위와 같음 */ }
};
