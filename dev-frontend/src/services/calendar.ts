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

export async function updateEvent(bizId: number, id: number, patch: Partial<CalendarEvent>): Promise<CalendarEvent> {
  const res = await apiFetch(`/api/calendar/by-business/${bizId}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return handle<CalendarEvent>(res);
}

export async function deleteEvent(bizId: number, id: number): Promise<void> {
  const res = await apiFetch(`/api/calendar/by-business/${bizId}/${id}`, { method: 'DELETE' });
  await handle<unknown>(res);
}

export async function getVideoStatus(): Promise<{ daily_configured: boolean }> {
  const res = await apiFetch('/api/calendar/video/status');
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
