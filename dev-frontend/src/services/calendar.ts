import { apiFetch } from '../contexts/AuthContext';
import type { CalendarEvent, AttendeeResponse } from '../pages/QCalendar/types';

// 업무 목록 (캘린더 통합용) — by-business 엔드포인트 재사용
export async function listTasksForCalendar(bizId: number): Promise<Array<{
  id: number; business_id: number; project_id: number | null; title: string;
  description: string | null; status: string; assignee_id: number | null;
  start_date: string | null; due_date: string | null; progress_percent: number;
  assignee?: { id: number; name: string } | null;
  Project?: { id: number; name: string; color?: string | null } | null;
}>> {
  const res = await apiFetch(`/api/tasks/by-business/${bizId}`);
  return handle(res);
}

async function handle<T>(res: Response): Promise<T> {
  const json = await res.json().catch(() => null) as { success?: boolean; data?: T; message?: string } | null;
  if (!res.ok || !json?.success) {
    throw new Error(json?.message || `HTTP ${res.status}`);
  }
  return json.data as T;
}

export interface RangeQuery {
  start: string;           // ISO
  end: string;             // ISO
  project_id?: number;
  scope?: 'all' | 'mine' | 'tasks' | 'events';
}

export async function listEvents(bizId: number, q: RangeQuery): Promise<CalendarEvent[]> {
  const qs = new URLSearchParams({ start: q.start, end: q.end });
  if (q.project_id != null) qs.set('project_id', String(q.project_id));
  if (q.scope) qs.set('scope', q.scope);
  const res = await apiFetch(`/api/calendar/by-business/${bizId}?${qs.toString()}`);
  return handle<CalendarEvent[]>(res);
}

export async function createEvent(bizId: number, payload: Partial<CalendarEvent> & { attendees?: Array<{ user_id?: number; client_id?: number }> }): Promise<CalendarEvent> {
  const res = await apiFetch(`/api/calendar/by-business/${bizId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handle<CalendarEvent>(res);
}

// N+63 P2a — scope option. master event (rrule) 의 시간/title 변경 시:
//   scope='single' + recurrence_id (YYYY-MM-DD): 이 회차만 (child exception 생성)
//   scope='future' + from_date: 이 날짜 이후 모두 (master split)
//   scope='all' (default): 모든 회차 (기존 동작)
export async function updateEvent(
  bizId: number,
  id: number,
  patch: Partial<CalendarEvent> & { recurrence_id?: string | null; from_date?: string | null },
  scope: 'single' | 'future' | 'all' = 'all',
): Promise<CalendarEvent> {
  const qs = scope !== 'all' ? `?scope=${scope}` : '';
  const res = await apiFetch(`/api/calendar/by-business/${bizId}/${id}${qs}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return handle<CalendarEvent>(res);
}

export async function deleteEvent(
  bizId: number,
  id: number,
  scope: 'single' | 'future' | 'all' = 'all',
  recurrenceId?: string,
): Promise<void> {
  const qs = scope !== 'all'
    ? `?scope=${scope}&recurrence_id=${encodeURIComponent(recurrenceId || '')}`
    : '';
  const res = await apiFetch(`/api/calendar/by-business/${bizId}/${id}${qs}`, { method: 'DELETE' });
  await handle<unknown>(res);
}

// 사이클 N+13 — Daily.co 완전 교체, Google Meet (Google Calendar API) 채택.
// gcal_configured  서버 .env 에 Google OAuth credentials 있는지 (전역)
// gcal_connected   해당 워크스페이스가 Google Calendar OAuth 완료했는지
export async function getVideoStatus(bizId?: number): Promise<{
  gcal_configured: boolean;
  gcal_connected: boolean;
  account_email: string | null;
}> {
  const qs = bizId ? `?business_id=${bizId}` : '';
  const res = await apiFetch(`/api/calendar/video/status${qs}`);
  return handle(res);
}

export async function createMeetingRoom(bizId: number, eventId: number): Promise<CalendarEvent> {
  const res = await apiFetch(`/api/calendar/by-business/${bizId}/${eventId}/meeting`, { method: 'POST' });
  return handle<CalendarEvent>(res);
}

export async function respondAttendee(
  bizId: number, eventId: number, attendeeId: number, response: AttendeeResponse,
): Promise<void> {
  const res = await apiFetch(`/api/calendar/by-business/${bizId}/${eventId}/attendees/${attendeeId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response }),
  });
  await handle<unknown>(res);
}
