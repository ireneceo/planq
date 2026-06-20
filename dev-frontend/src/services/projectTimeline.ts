// 일정 타임라인 + 관련 프로젝트 (R1) — API 클라이언트.
import { apiFetch } from '../contexts/AuthContext';

export interface TimelineTask {
  id: number; title: string; status: string;
  start_date: string | null; due_date: string | null;
  progress_percent: number; workstream_id: number | null;
  is_milestone: boolean; assignee_name: string | null;
}
export interface TimelineWorkstream { id: number; title: string; color: string | null; order_index: number; }
export interface TimelineData {
  project: { id: number; name: string; start_date: string | null; end_date: string | null };
  today: string;
  progress: { percent: number; expected_percent: number | null; schedule_status: 'ahead' | 'ontrack' | 'behind' | null; d_day: number | null };
  key_only_default: boolean;
  workstreams: TimelineWorkstream[];
  tasks: TimelineTask[];
}
export interface RelatedProject {
  link_id: number; relation_label: string | null;
  project: { id: number; name: string; status: string; start_date: string | null; end_date: string | null; progress_percent: number; health: 'green' | 'yellow' | 'red'; overdue_count: number; d_day: number | null };
}

async function jsonOf(r: Response) { const j = await r.json(); if (!j.success) throw new Error(j.message || 'failed'); return j.data; }

export async function getTimeline(projectId: number, keyOnly?: boolean): Promise<TimelineData> {
  return jsonOf(await apiFetch(`/api/projects/${projectId}/timeline${keyOnly ? '?key_only=1' : ''}`));
}
export async function setTimelineKeyOnly(projectId: number, keyOnly: boolean): Promise<void> {
  await jsonOf(await apiFetch(`/api/projects/${projectId}/timeline-settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key_only: keyOnly }) }));
}
export async function getRelatedProjects(projectId: number): Promise<RelatedProject[]> {
  return jsonOf(await apiFetch(`/api/projects/${projectId}/links`));
}
export async function linkProject(projectId: number, targetId: number, label?: string): Promise<void> {
  await jsonOf(await apiFetch(`/api/projects/${projectId}/links`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target_project_id: targetId, relation_label: label }) }));
}
export async function unlinkProject(projectId: number, targetId: number): Promise<void> {
  await jsonOf(await apiFetch(`/api/projects/${projectId}/links/${targetId}`, { method: 'DELETE' }));
}
