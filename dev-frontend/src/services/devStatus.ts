// 배포별 개발 현황 (플랫폼 관리자 전용)
import { apiFetch } from '../contexts/AuthContext';

export type Verified = 'fable_pass' | 'opus_only' | 'none';

export interface DevStatusSections {
  working_on: { title: string; detail?: string; owner?: string; since?: string }[];
  completed: { title: string; detail?: string; commit?: string; verified?: Verified }[];
  in_progress: { title: string; detail?: string; blocked_by?: string }[];
  issues: { title: string; detail?: string; severity?: string; area?: string; feedback_id?: number }[];
  backlog: { title: string; detail?: string; priority?: string }[];
  behavior_changes: { title: string; before?: string; after?: string; affected?: string }[];
  check_areas: { area: string; why?: string; how?: string }[];
  migrations: { script?: string; table?: string; kind?: string; rollback_note?: string }[];
  blocked_on_human: { what: string; who?: string; since?: string }[];
  tooling_health: { tool: string; symptom?: string; workaround?: string }[];
  undeployed: { commit?: string; subject?: string }[];
}

export interface DevStatusSummary {
  id: number;
  commit_to: string;
  commit_from: string | null;
  version: string | null;
  deployed_at: string;
  backup_dir: string | null;
  closed_feedback_ids: number[];
  kept_open_ids: number[];
  pdf_check: string | null;
  release_note_published: boolean;
  schema_changed: boolean;
  author_name: string | null;
  section_counts: Record<keyof DevStatusSections, number>;
}

export interface DevStatusDetail extends Omit<DevStatusSummary, 'section_counts'> {
  sections: DevStatusSections;
  /** 이슈의 실제 처리 상태 — 여기 적힌 글이 아니라 피드백 원장이 정본이다. */
  feedback_status: Record<string, string>;
}

export async function listDevStatus(limit = 50): Promise<DevStatusSummary[]> {
  const res = await apiFetch(`/api/admin/dev-status?limit=${limit}`);
  const j = await res.json();
  if (!res.ok || !j.success) throw new Error(j.message || 'failed');
  return j.data as DevStatusSummary[];
}

export async function getDevStatus(commit: string): Promise<DevStatusDetail> {
  const res = await apiFetch(`/api/admin/dev-status/${encodeURIComponent(commit)}`);
  const j = await res.json();
  if (!res.ok || !j.success) throw new Error(j.message || 'failed');
  return j.data as DevStatusDetail;
}
