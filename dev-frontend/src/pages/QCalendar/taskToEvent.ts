import type { CalendarEvent, TaskAsEvent } from './types';

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
