import { apiFetch } from '../contexts/AuthContext';

export interface Workspace {
  id: number;
  slug: string;
  name?: string;
  brand_name?: string;
  brand_name_en?: string | null;
  brand_tagline?: string | null;
  brand_tagline_en?: string | null;
  brand_logo_url?: string | null;
  brand_color?: string | null;
  legal_name?: string | null;
  legal_name_en?: string | null;
  legal_entity_type?: 'corporation' | 'individual' | 'llc' | 'other' | null;
  tax_id?: string | null;
  representative?: string | null;
  representative_en?: string | null;
  address?: string | null;
  address_en?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  default_language?: 'ko' | 'en';
  timezone?: string;
  work_hours?: Record<string, [number, number] | null> | null;
  plan?: 'free' | 'basic' | 'pro' | 'enterprise';
  plan_expires_at?: string | null;
  cue_user_id?: number | null;
  cue_mode?: 'smart' | 'auto' | 'draft';
  cue_paused?: boolean;
  owner_id?: number;
}

export interface WorkspaceMember {
  id: number;
  business_id: number;
  user_id: number | null;
  role: 'owner' | 'member' | 'ai';
  default_role?: string | null;
  daily_work_hours?: number | string | null;
  weekly_work_days?: number | null;
  participation_rate?: number | string | null;
  joined_at?: string | null;
  invited_at?: string | null;
  invite_email?: string | null;
  invite_token?: string | null;
  user?: {
    id: number;
    name: string;
    email: string | null;
    avatar_url: string | null;
    is_ai: boolean | number;
    last_login_at?: string | null;
    phone?: string | null;
    job_title?: string | null;
    organization?: string | null;
    bio?: string | null;
    expertise?: string | null;
    timezone?: string | null;
  } | null;
}

export interface CueInfo {
  cue_user_id: number | null;
  cue_user?: { id: number; name: string; avatar_url: string | null } | null;
  mode: 'smart' | 'auto' | 'draft';
  paused: boolean;
  usage: {
    year_month: string;
    action_count: number;
    limit: number;
    remaining: number;
    cost_usd: number;
    by_type: Record<string, number>;
  };
}

async function unwrap<T>(res: Response): Promise<T> {
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.message || 'Request failed');
  }
  return json.data as T;
}

export async function getWorkspace(id: number): Promise<Workspace & { members?: WorkspaceMember[]; cueUser?: { id: number; name: string; avatar_url: string | null; is_ai: number } }> {
  return unwrap(await apiFetch(`/api/businesses/${id}`));
}

export async function updateBrand(id: number, payload: Partial<Workspace>): Promise<Workspace> {
  return unwrap(await apiFetch(`/api/businesses/${id}/brand`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }));
}

export async function updateLegal(id: number, payload: Partial<Workspace>): Promise<Workspace> {
  return unwrap(await apiFetch(`/api/businesses/${id}/legal`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }));
}

export async function updateSettings(id: number, payload: Partial<Workspace>): Promise<Workspace> {
  return unwrap(await apiFetch(`/api/businesses/${id}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }));
}

export async function listMembers(id: number): Promise<WorkspaceMember[]> {
  return unwrap(await apiFetch(`/api/businesses/${id}/members`));
}

export async function inviteMember(id: number, payload: { email: string; default_role?: string }): Promise<WorkspaceMember> {
  return unwrap(await apiFetch(`/api/businesses/${id}/members/invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }));
}

export async function updateMemberRole(id: number, memberId: number, role: 'owner' | 'member'): Promise<WorkspaceMember> {
  return unwrap(await apiFetch(`/api/businesses/${id}/members/${memberId}/role`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  }));
}

export async function removeMember(id: number, memberId: number): Promise<{ id: number; removed: boolean }> {
  return unwrap(await apiFetch(`/api/businesses/${id}/members/${memberId}`, { method: 'DELETE' }));
}

export async function getCueInfo(id: number): Promise<CueInfo> {
  return unwrap(await apiFetch(`/api/businesses/${id}/cue`));
}

export async function updateCue(id: number, payload: { mode?: 'smart' | 'auto' | 'draft'; paused?: boolean }): Promise<{ mode: string; paused: boolean }> {
  return unwrap(await apiFetch(`/api/businesses/${id}/cue`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }));
}
