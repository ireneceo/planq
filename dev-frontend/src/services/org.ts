// Q조직 (Workspace Org) D1 — API 클라이언트. /api/org/:businessId/*
import { apiFetch } from '../contexts/AuthContext';

export interface OrgTeam { id: number; name: string; name_en: string | null; sort_order: number; }
export interface OrgDepartment {
  id: number;
  name: string;
  name_en: string | null;
  color: string | null;
  lead_user_id: number | null;
  sort_order: number;
  member_count: number;
  teams: OrgTeam[];
  lead?: { id: number; name: string } | null;
}
export interface OrgMemberRow {
  user_id: number;
  name: string;
  department_id: number | null;
  team_id: number | null;
  job_title: string | null;
  active: number;
  overdue: number;
}
export interface OrgDeptStat { id: number | null; name: string | null; color: string | null; member_count: number; active: number; }
export interface OrgOverview {
  scope: 'company' | 'department' | 'personal';
  department_id: number | null;
  members: number;
  activeTasks: number;
  doneThisWeek: number;
  overdue: number;
  byMember: OrgMemberRow[];
  byDepartment: OrgDeptStat[];
}

async function jq<T>(p: Promise<Response>): Promise<T> {
  const res = await p;
  const j = await res.json();
  if (!res.ok || !j.success) throw new Error(j.message || `HTTP ${res.status}`);
  return j.data as T;
}
const j = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const listDepartments = (bizId: number) =>
  jq<OrgDepartment[]>(apiFetch(`/api/org/${bizId}/departments`));

export const createDepartment = (bizId: number, body: Partial<OrgDepartment>) =>
  jq<OrgDepartment>(apiFetch(`/api/org/${bizId}/departments`, j(body)));

export const updateDepartment = (bizId: number, id: number, body: Partial<OrgDepartment>) =>
  jq<OrgDepartment>(apiFetch(`/api/org/${bizId}/departments/${id}`, { ...j(body), method: 'PUT' }));

export const deleteDepartment = (bizId: number, id: number) =>
  jq<{ id: number }>(apiFetch(`/api/org/${bizId}/departments/${id}`, { method: 'DELETE' }));

export const createTeam = (bizId: number, body: { department_id: number; name: string; name_en?: string }) =>
  jq<OrgTeam>(apiFetch(`/api/org/${bizId}/teams`, j(body)));

export const updateTeam = (bizId: number, id: number, body: Partial<OrgTeam>) =>
  jq<OrgTeam>(apiFetch(`/api/org/${bizId}/teams/${id}`, { ...j(body), method: 'PUT' }));

export const deleteTeam = (bizId: number, id: number) =>
  jq<{ id: number }>(apiFetch(`/api/org/${bizId}/teams/${id}`, { method: 'DELETE' }));

export const assignMember = (bizId: number, userId: number, body: { department_id?: number | null; team_id?: number | null; job_title?: string | null }) =>
  jq<OrgMemberRow>(apiFetch(`/api/org/${bizId}/members/${userId}/assignment`, { ...j(body), method: 'PUT' }));

export function fetchOrgOverview(bizId: number, scope: 'company' | 'department' | 'personal', departmentId?: number) {
  const sp = new URLSearchParams({ scope });
  if (departmentId) sp.set('department_id', String(departmentId));
  return jq<OrgOverview>(apiFetch(`/api/org/${bizId}/overview?${sp.toString()}`));
}
