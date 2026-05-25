export type EventCategory = 'personal' | 'work' | 'meeting' | 'deadline' | 'other';
export type EventVisibility = 'personal' | 'business';
export type AttendeeResponse = 'pending' | 'accepted' | 'declined' | 'tentative';
export type MeetingProvider = 'daily' | 'manual';

export interface CalendarAttendee {
  id: number;
  user_id?: number | null;
  client_id?: number | null;
  response: AttendeeResponse;
  user?: { id: number; name: string; email?: string } | null;
  client?: { id: number; display_name?: string; company_name?: string } | null;
}

export interface CalendarEvent {
  id: number;
  business_id: number;
  project_id: number | null;
  title: string;
  description: string | null;
  location: string | null;
  start_at: string; // ISO
  end_at: string;   // ISO
  all_day: boolean;
  category: EventCategory;
  color: string | null;
  rrule: string | null;
  meeting_url: string | null;
  meeting_provider: MeetingProvider | null;
  visibility: EventVisibility;
  created_by: number;
  creator?: { id: number; name: string; email?: string } | null;
  Project?: { id: number; name: string; color?: string | null } | null;
  attendees?: CalendarAttendee[];
  createdAt?: string;
  updatedAt?: string;
  // N+63 — 임박 알림
  reminder_minutes?: number | null;
  reminder_sent_at?: string | null;
  // N+63 P2a — 정기일정 exception (RFC 5545)
  recurrence_parent_id?: number | null;
  recurrence_id?: string | null;
  exception_dates?: string[] | null;
  // GET expansion 시점 메타 (server response)
  _is_exception?: boolean;
  _parent_event_id?: number;
  _instance_key?: string;
}

export type CalendarViewMode = 'month' | 'week' | 'day';
export type CalendarScope = 'all' | 'mine' | 'tasks' | 'events';

// Q Task 업무를 캘린더 이벤트로 변환한 가상 이벤트 (클릭 시 Q Task 페이지로 이동)
export interface TaskAsEvent extends CalendarEvent {
  _source: 'task';
  _task_id: number;
  _task_status: string;
  _task_progress: number;
  _task_assignee_name?: string | null;
}

export type CalendarItem = CalendarEvent | TaskAsEvent;
