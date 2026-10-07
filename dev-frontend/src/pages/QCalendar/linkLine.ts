// 일정 항목의 «연결» 한 줄 — 업무에서 온 항목은 «업무 · 프로젝트», 일정은 «프로젝트 · 업무: 제목» (2026-10-07).
//   Irene: "프로젝트랑 업무가 연결되어 있는게 표시 되어야지. 업무를 일정으로 넣은 건."
//   목록 카드(둘째 줄) · 월/주 칸(툴팁)이 같은 함수를 쓴다 — 화면마다 조합하면 한쪽만 프로젝트가 빠진다.
import type { TFunction } from 'i18next';
import type { CalendarItem, CalendarEvent } from './types';
import { isTaskEvent } from './taskToEvent';

export function linkLine(e: CalendarItem, t: TFunction): string {
  const project = (e as CalendarEvent).Project?.name || '';
  if (isTaskEvent(e)) {
    return [t('taskLink.fromTask', { defaultValue: '업무' }) as string, project].filter(Boolean).join(' · ');
  }
  const tk = (e as CalendarEvent).task;
  const task = tk && !tk.hidden && tk.title ? (t('taskLink.taskOf', { title: tk.title, defaultValue: '업무: {{title}}' }) as string) : '';
  return [project, task].filter(Boolean).join(' · ');
}
