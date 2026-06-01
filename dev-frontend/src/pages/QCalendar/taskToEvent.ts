import type { CalendarEvent, TaskAsEvent, CalendarItem, PersonalCalendarEvent } from './types';

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
export const personalToEvent = (raw: PersonalRaw): PersonalCalendarEvent => ({
  id: raw.id,
  _source: 'personal_google',
  title: raw.title || '(제목 없음)',
  description: raw.description ?? null,
  location: raw.location ?? null,
  start_at: raw.start_at,
  end_at: raw.end_at || raw.start_at,
  all_day: !!raw.all_day,
  color: '#8B5CF6',
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
    id: task.id, // Q Task 페이지로 네비게이션할 때 사용
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
export const isTaskEvent = (e: CalendarEvent | TaskAsEvent): e is TaskAsEvent =>
  (e as TaskAsEvent)._source === 'task';
