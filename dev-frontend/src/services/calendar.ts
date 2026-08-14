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
  /** 팀 축 — 팀 캘린더 동기화·"구글 캘린더로 보내기" 는 워크스페이스 연동에서만 가능하다.
   *  아래 gcal_* 는 Meet 축(개인 연동 포함)으로 의미가 넓으므로, 팀 기능은 반드시 이 값을 봐야 한다. */
  workspace_connected: boolean;
  workspace_can_write: boolean;
  workspace_account_email: string | null;
  /** 개인 축 — 본인 Google 계정 연동. 배너가 "누구의 연동을 고쳐야 하는지" 를 가리키는 근거.
   *  워크스페이스 연동은 오너만 할 수 있으므로, 직원에게는 이 축만이 실행 가능한 경로다. */
  personal_connected: boolean;
  personal_can_write: boolean;
  /** Meet 축 — 워크스페이스 **또는** 개인 연동 중 하나라도 연결/발급 가능하면 true. */
  gcal_connected: boolean;
  /** #242 — 토큰이 있어도 캘린더 쓰기 권한이 없을 수 있다. Meet UI 는 이 값으로 게이트한다. */
  gcal_can_write: boolean;
  /** 회의가 실제로 만들어질 계정의 종류 — 'personal' 이면 본인 구글 계정으로 개설된다. */
  meet_source: 'personal' | 'workspace' | null;
  account_email: string | null;
  /** ── 동기화 상태 (#242) — 배너가 상태를 말하고 행동으로 잇는다. 새 라우트를 만들지 않고 여기에 얹었다. */
  workspace_needs_reconnect: boolean;
  workspace_last_error_at: string | null;
  /** 팀 연동은 오너만 고칠 수 있다 — 아니면 배너가 "오너가 해야 한다" 로 말을 바꾼다. */
  can_reconnect_workspace: boolean;
  /** 폴링 주기(초). "최대 N분 내 반영" 문구가 이 값을 쓴다 — 코드와 문구가 갈라지지 않게. */
  poll_interval_seconds: number;
  /** 마지막 **확인** 시각. 마지막 반영이 아니다 — 건강해도 반영은 며칠 없을 수 있다. */
  last_checked_at: string | null;
  last_reverse_sync_at: string | null;
}> {
  const qs = bizId ? `?business_id=${bizId}` : '';
  const res = await apiFetch(`/api/calendar/video/status${qs}`);
  return handle(res);
}

/** 구글 변경분을 지금 당겨온다. 화면 진입·복귀 시 자동 호출(사용자가 눌러야 최신인 것은 떠넘기기다). */
export async function syncCalendarNow(bizId: number): Promise<{
  sources: number; applied: number; skipped: number; busy: number; errors: number;
  excluded: Array<{ kind: string; id: number; businessId: number; reason: string }>;
}> {
  const res = await apiFetch(`/api/calendar/sync-now/${bizId}`, { method: 'POST' });
  return handle(res);
}

export interface GcalOrphan {
  gcal_event_id: string;
  title: string;
  start: string | null;
  html_link: string | null;
  /** 인스턴스 표식이 없는 옛 사본 — 일괄 삭제 금지, 건별 선택만 허용한다. */
  legacy: boolean;
}

/** 구글에 남은 PlanQ 고아 사본 목록 (오너 전용). */
export async function listGcalOrphans(bizId: number): Promise<{
  supported: boolean; reason: string | null; scanned: number; orphans: GcalOrphan[]; max_per_call: number;
}> {
  const res = await apiFetch(`/api/calendar/gcal-orphans/${bizId}`);
  return handle(res);
}

/** 선택된 고아 사본만 구글에서 삭제 (오너 전용). */
export async function cleanupGcalOrphans(bizId: number, ids: string[]): Promise<{
  deleted: number; skipped: number; failed: number;
}> {
  const res = await apiFetch(`/api/calendar/gcal-orphans/${bizId}/cleanup`, {
    method: 'POST', body: JSON.stringify({ gcal_event_ids: ids }),
  });
  return handle(res);
}

/** 재연결 직후 — 권한이 죽어 있던 기간의 일정을 팀 캘린더로 올려보낸다 (오너 전용). */
export async function backfillWorkspaceCalendar(bizId: number): Promise<{
  eligible: number; pushed: number; failed: number; remaining: number; skipped: string | null;
}> {
  const res = await apiFetch(`/api/calendar/workspace-backfill/${bizId}`, { method: 'POST' });
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
