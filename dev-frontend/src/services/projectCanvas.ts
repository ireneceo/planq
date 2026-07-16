// 프로젝트 캔버스 (D3 #65) — API 클라이언트. /api/projects/:id/canvas 외.
import { apiFetch } from '../contexts/AuthContext';

export interface CanvasStrategy {
  context: string | null;
  key_question: string | null;
  goal: string | null;
  governing_thought: string | null;
  approach: string | null;
}
export type StrategyKey = keyof CanvasStrategy;

export type CanvasSource = 'ai' | 'manual';

export interface SuccessMetric {
  id?: string;
  label: string;
  target: string;
  current: string;
  unit: string;
  source?: CanvasSource;  // ⑤ 자동/수동 인지
}

export interface WorkstreamRollup {
  total: number; completed: number; in_progress: number; overdue: number; progress_pct: number;
}
export interface Workstream {
  id: number; title: string; description: string | null;
  order_index: number; color: string | null;
  status: 'active' | 'done' | 'dropped';
  source?: CanvasSource;  // ⑤ 자동/수동 인지
  rollup: WorkstreamRollup;
}

export interface CanvasTaskBrief {
  id: number; title: string; status: string;
  due_date: string | null; progress_percent: number;
  assignee_id: number | null; assignee_name: string | null;
  workstream_id: number | null;
}
export interface CanvasGraphTask {
  id: number; title: string; status: string;
  workstream_id: number | null; assignee_name: string | null;
}
export interface Deliverable {
  kind: 'post' | 'document'; id: number; title: string;
  category: string | null; status: string | null; created_at: string; link: string;
}
export interface CanvasData {
  project: { id: number; name: string; status: string; start_date: string | null; end_date: string | null; color: string | null; description: string | null; owner_user_id: number };
  strategy: CanvasStrategy;
  strategy_sources?: Partial<Record<StrategyKey, CanvasSource>>;  // ⑤ 전략 필드별 출처
  success_metrics: SuccessMetric[];
  workstreams: Workstream[];
  tasks: CanvasGraphTask[];
  task_links: { a: number; b: number }[];
  week_focus: { week_start: string; next_week_start: string; this_week: CanvasTaskBrief[]; next_week: CanvasTaskBrief[] };
  deliverables: Deliverable[];
  stakeholders: { members: { user_id: number; name: string; role: string; dept: string | null; team: string | null }[]; clients: { id: number; name: string; kind: string }[] };
  risks: { id: number; body: string; created_at: string }[];
}

async function jsonOf(r: Response) {
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'request_failed');
  return j.data;
}

export async function getCanvas(projectId: number): Promise<CanvasData> {
  return jsonOf(await apiFetch(`/api/projects/${projectId}/canvas`));
}

export async function patchStrategy(projectId: number, patch: Partial<CanvasStrategy>): Promise<CanvasStrategy> {
  return jsonOf(await apiFetch(`/api/projects/${projectId}/strategy`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  }));
}

// ⑤ AI 캔버스 초안 생성 — 빈 전략·지표·추진과제를 AI가 초안으로 채운다(비파괴). 실패 시 throw(message).
export interface AiDraftResult { strategy_filled: number; metrics_filled: number; workstreams_created: number; }
export async function aiDraftCanvas(projectId: number): Promise<AiDraftResult> {
  return jsonOf(await apiFetch(`/api/projects/${projectId}/canvas/ai-draft`, { method: 'POST' }));
}

export async function putSuccessMetrics(projectId: number, metrics: SuccessMetric[]): Promise<SuccessMetric[]> {
  return jsonOf(await apiFetch(`/api/projects/${projectId}/success-metrics`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ metrics }),
  }));
}

export async function listWorkstreams(projectId: number): Promise<Workstream[]> {
  return jsonOf(await apiFetch(`/api/projects/${projectId}/workstreams`));
}

export async function createWorkstream(projectId: number, body: { title: string; description?: string; color?: string }): Promise<Workstream> {
  return jsonOf(await apiFetch(`/api/projects/${projectId}/workstreams`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
}

export async function updateWorkstream(projectId: number, wsId: number, patch: Partial<{ title: string; description: string; color: string; status: string }>): Promise<Workstream> {
  return jsonOf(await apiFetch(`/api/projects/${projectId}/workstreams/${wsId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  }));
}

export async function deleteWorkstream(projectId: number, wsId: number): Promise<void> {
  await jsonOf(await apiFetch(`/api/projects/${projectId}/workstreams/${wsId}`, { method: 'DELETE' }));
}

export async function reorderWorkstreams(projectId: number, orderedIds: number[]): Promise<void> {
  await jsonOf(await apiFetch(`/api/projects/${projectId}/workstreams/reorder`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ordered_ids: orderedIds }),
  }));
}

// 캔버스 그룹 색 팔레트 (color 미지정 워크스트림에 index 기준 자동 배정)
export const WORKSTREAM_PALETTE = ['#14B8A6', '#6366F1', '#F59E0B', '#EC4899', '#0EA5E9', '#84CC16', '#F43F5E', '#14B8A6'];
export const wsColor = (ws: { color: string | null; order_index: number }, idx: number): string =>
  ws.color || WORKSTREAM_PALETTE[(ws.order_index ?? idx) % WORKSTREAM_PALETTE.length];
