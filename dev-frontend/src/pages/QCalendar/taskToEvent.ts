import type { TaskAsEvent, CalendarItem, PersonalCalendarEvent } from './types';

// #104 — task 파생 이벤트의 id 오프셋. 숫자 캘린더 이벤트 id 와 겹치지 않게 큰 오프셋을 더해
//   '나만보기' 일정 클릭 시 같은 숫자 id 의 task 가 잘못 열리던 버그 차단. 실제 이동/조회는 _task_id 사용.
export const TASK_EVENT_ID_OFFSET = 1_000_000_000;

// 개인 Google 캘린더 일정 (read-only overlay) 식별
export const isPersonalEvent = (e: CalendarItem): e is PersonalCalendarEvent =>
  (e as PersonalCalendarEvent)._source === 'personal_google';

// /api/me/calendar/events 응답 raw → PersonalCalendarEvent (violet 색 고정)
interface PersonalRaw {
  id: string;
  title: string;
  description?: string | null;
  location?: string | null;
  start_at: string;
  end_at: string | null;
  all_day: boolean;
  html_link?: string | null;
  account_email?: string | null;
}
export const personalToEvent = (raw: PersonalRaw, untitledLabel = '(제목 없음)'): PersonalCalendarEvent => ({
  id: raw.id,
  _source: 'personal_google',
  title: raw.title || untitledLabel,
  description: raw.description ?? null,
  location: raw.location ?? null,
  start_at: raw.start_at,
  end_at: raw.end_at || raw.start_at,
  all_day: !!raw.all_day,
  color: '#14B8A6',
  html_link: raw.html_link ?? null,
  account_email: raw.account_email ?? null,
  read_only: true,
});

// Q Task API 응답 형태 (/api/tasks/by-business/:bizId)
interface TaskRow {
  id: number;
  business_id: number;
  project_id: number | null;
  title: string;
  description: string | null;
  status: string;
  assignee_id: number | null;
  start_date: string | null; // YYYY-MM-DD
  due_date: string | null;   // YYYY-MM-DD
  progress_percent: number;
  assignee?: { id: number; name: string } | null;
  Project?: { id: number; name: string; color?: string | null } | null;
}

// 업무를 캘린더 아이템으로 변환 — 마감이 있는 업무만 표시 (종일 이벤트)
export const taskToEvent = (task: TaskRow): TaskAsEvent | null => {
  if (!task.due_date) return null;
  // 업무는 마감일(due_date) 하루 종일 이벤트로 표시 (기간 스팬 금지 — 중복 방지)
  const dueKey = String(task.due_date).slice(0, 10);
  const startLocal = new Date(`${dueKey}T00:00:00`);
  const endLocal = new Date(`${dueKey}T23:59:59`);
  if (Number.isNaN(startLocal.getTime()) || Number.isNaN(endLocal.getTime())) return null;
  return {
    id: task.id + TASK_EVENT_ID_OFFSET, // #104 — 캘린더 이벤트 id 와 충돌 방지 (실제 이동은 _task_id)
    business_id: task.business_id,
    project_id: task.project_id,
    title: task.title,
    description: task.description,
    location: null,
    start_at: startLocal.toISOString(),
    end_at: endLocal.toISOString(),
    all_day: true,
    category: 'deadline',
    color: null,
    rrule: null,
    meeting_url: null,
    meeting_provider: null,
    visibility: 'business',
    created_by: task.assignee_id || 0,
    Project: task.Project || null,
    creator: task.assignee ? { id: task.assignee.id, name: task.assignee.name } : null,
    attendees: [],
    _source: 'task',
    _task_id: task.id,
    _task_status: task.status,
    _task_progress: task.progress_percent || 0,
    _task_assignee_name: task.assignee?.name || null,
  };
};

// TaskAsEvent 식별
export const isTaskEvent = (e: CalendarItem): e is TaskAsEvent =>
  (e as TaskAsEvent)._source === 'task';
