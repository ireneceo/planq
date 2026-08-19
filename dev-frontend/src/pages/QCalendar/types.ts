export type EventCategory = 'personal' | 'work' | 'meeting' | 'deadline' | 'other';
export type EventVisibility = 'personal' | 'business';
// N+65 — 통합 visibility (VISIBILITY_VOCABULARY.md L1-L4)
export type EventVlevel = 'L1' | 'L2' | 'L3' | 'L4';
export type AttendeeResponse = 'pending' | 'accepted' | 'declined' | 'tentative';
// 사이클 N+13 에 Daily.co → Google Meet 으로 전면 교체됐는데 이 타입만 갱신되지 않아,
// 백엔드가 실제로 저장하는 'google_meet' 이 타입에 없었다(비교하면 TS2367).
// 'daily' 는 교체 이전 데이터가 남아 있을 수 있어 그대로 둔다.
export type MeetingProvider = 'google_meet' | 'manual' | 'daily';

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
  /** #242 — 일정은 저장됐지만 Meet 링크 생성이 실패한 경우의 사유 코드 (생성 응답에만 실린다) */
  meet_warning?: string | null;
  gcal_event_id?: string | null;  // #126 — Google Calendar 동기화 시 저장. NULL = 미동기화(backfill 대상)
  meeting_provider: MeetingProvider | null;
  visibility: EventVisibility;
  // N+65 — 통합 visibility (hook 가 옛 visibility 와 자동 동기)
  vlevel?: EventVlevel | null;
  target_member_ids?: number[] | null;
  target_client_ids?: number[] | null;
  created_by: number;
  created_via?: string | null;
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

export type CalendarViewMode = 'agenda' | 'month' | 'week' | 'day';
export type CalendarScope = 'all' | 'mine' | 'tasks' | 'events';

// Q Task 업무를 캘린더 이벤트로 변환한 가상 이벤트 (클릭 시 Q Task 페이지로 이동)
export interface TaskAsEvent extends CalendarEvent {
  _source: 'task';
  _task_id: number;
  _task_status: string;
  _task_progress: number;
  _task_assignee_name?: string | null;
}

// 개인 Google 캘린더 일정 overlay — GET /api/me/calendar/events
//   쓰기 권한(calendar.events)에 동의한 연결이면 PlanQ 안에서 바로 수정·삭제할 수 있다.
export interface PersonalCalendarEvent {
  id: string;            // 'gcal-{connId}-{eventId}'
  _source: 'personal_google';
  title: string;
  description?: string | null;
  location?: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
  color: string;         // violet #14B8A6 (회사 일정과 색 분리)
  html_link: string | null;
  account_email: string | null;
  // ★ 여태 리터럴 true 였다 — 쓰기 권한이 있어도 화면은 읽기 전용이라고 말하고 있었다.
  read_only: boolean;
  connection_id: number;
  gcal_event_id: string;
  etag: string | null;                  // 동시 수정 충돌 감지
  recurring_event_id: string | null;    // 있으면 반복 일정의 한 회차
  is_organizer: boolean;                // 주최자가 아니면 구글이 수정을 거부한다
}

export type CalendarItem = CalendarEvent | TaskAsEvent | PersonalCalendarEvent;
