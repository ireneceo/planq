// 워크스페이스 «전체» 대화방 + 공지 — 서버 routes/team_channel.js (2026-11-16 Fable 설계 B).
//   공지 = «전체» 방의 메시지(제목 + 본문, 올리면 자동 핀). 방 읽기·쓰기 자체는 Q talk 대화 API 그대로.
import { apiFetch } from '../contexts/AuthContext';

export interface TeamChannelInfo { conversation_id: number; can_announce: boolean }
export interface Announcement {
  id: number;
  conversation_id: number;
  title: string;
  content: string;
  sender_id: number;
  sender: { id: number; name: string; name_localized?: Record<string, string> | null } | null;
  created_at: string;
  is_edited: boolean;
  edited_at: string | null;
  pinned_at: string | null;
  read_by_count: number;
  other_count: number;
}
export interface AnnouncementReaders {
  read: { user_id: number; name: string; read_at: string }[];
  unread: { user_id: number; name: string }[];
}

export class TeamChannelError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number) { super(code); this.code = code; this.status = status; }
}

async function handle<T>(res: Response): Promise<{ data: T; total?: number }> {
  let body: { success?: boolean; data?: T; message?: string; pagination?: { total: number } } | null = null;
  try { body = await res.json(); } catch { throw new TeamChannelError(`http_${res.status}`, res.status); }
  if (!res.ok || !body?.success) throw new TeamChannelError(body?.message || `http_${res.status}`, res.status);
  return { data: body.data as T, total: body.pagination?.total };
}

export async function getTeamChannel(businessId: number): Promise<TeamChannelInfo> {
  return (await handle<TeamChannelInfo>(await apiFetch(`/api/team-channel/${businessId}`))).data;
}

export async function listAnnouncements(businessId: number, limit = 50): Promise<{ items: Announcement[]; total: number }> {
  const r = await handle<Announcement[]>(await apiFetch(`/api/team-channel/${businessId}/announcements?limit=${limit}`));
  return { items: r.data || [], total: r.total ?? (r.data || []).length };
}

export async function postAnnouncement(businessId: number, title: string, body: string): Promise<{ id: number; conversation_id: number }> {
  const res = await apiFetch(`/api/team-channel/${businessId}/announcements`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, body }),
  });
  return (await handle<{ id: number; conversation_id: number }>(res)).data;
}

export async function editAnnouncement(businessId: number, id: number, title: string, body: string): Promise<void> {
  const res = await apiFetch(`/api/team-channel/${businessId}/announcements/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, body }),
  });
  await handle<unknown>(res);
}

export async function getAnnouncementReaders(businessId: number, id: number): Promise<AnnouncementReaders> {
  return (await handle<AnnouncementReaders>(await apiFetch(`/api/team-channel/${businessId}/announcements/${id}/readers`))).data;
}
