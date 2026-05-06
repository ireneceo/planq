// 주간 보고 (Weekly Review) API client

import { apiFetch } from '../contexts/AuthContext';

// ─── Types ───
export interface WeeklyReviewSummary {
  total: number;
  completed: number;
  incomplete: number;
  estimated_total: number;
  actual_total: number;
  utilization_pct: number;
  capacity_hours: number;
}

export interface WeeklyReviewTask {
  id: number;
  title: string;
  status: string;
  estimated_hours: number;
  actual_hours: number;
  progress_percent: number;
  due_date: string | null;
  start_date: string | null;
  project_id: number | null;
  project_name: string | null;
  priority_order: number | null;
}

export interface BurndownPoint {
  date: string;
  estimated_cumulative: number;
  actual_cumulative: number;
}

export interface WeeklyReviewSnapshot {
  tasks: WeeklyReviewTask[];
  summary: WeeklyReviewSummary;
  burndown: BurndownPoint[];
}

export interface WeeklyReview {
  id: number;
  user_id: number;
  business_id: number;
  week_start: string;
  week_end: string;
  finalized_at: string;
  finalized_by: 'manual' | 'auto';
  snapshot_data: WeeklyReviewSnapshot;
  retro_note: string | null;
  created_at: string;
}

export interface WeeklyReviewListItem {
  id: number;
  week_start: string;
  week_end: string;
  finalized_at: string;
  finalized_by: 'manual' | 'auto';
  retro_note: string | null;
  summary: WeeklyReviewSummary | null;
  created_at: string;
}

export interface WeeklyReviewSettings {
  auto_enabled: boolean;
}

// ─── API 함수 ───

// 수동 박제
export async function createWeeklyReview(params: {
  business_id: number;
  week_start?: string;
  retro_note?: string;
  overwrite?: boolean;
}): Promise<WeeklyReview> {
  const qs = params.overwrite ? '?overwrite=true' : '';
  const res = await apiFetch(`/api/weekly-reviews${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      business_id: params.business_id,
      week_start: params.week_start,
      retro_note: params.retro_note,
    }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.message || 'Failed to create weekly review');
  return json.data;
}

// 누적 결산 목록
export async function listWeeklyReviews(params: {
  business_id: number;
  user_id?: number;
  limit?: number;
  before?: string;
}): Promise<WeeklyReviewListItem[]> {
  const sp = new URLSearchParams();
  sp.set('business_id', String(params.business_id));
  if (params.user_id) sp.set('user_id', String(params.user_id));
  if (params.limit) sp.set('limit', String(params.limit));
  if (params.before) sp.set('before', params.before);

  const res = await apiFetch(`/api/weekly-reviews?${sp.toString()}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.message || 'Failed to list weekly reviews');
  return json.data;
}

// 가장 최근 결산
export async function getLatestWeeklyReview(businessId: number): Promise<WeeklyReview | null> {
  const res = await apiFetch(`/api/weekly-reviews/latest?business_id=${businessId}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.message || 'Failed to get latest');
  return json.data;
}

// 풀 view
export async function getWeeklyReview(id: number): Promise<WeeklyReview> {
  const res = await apiFetch(`/api/weekly-reviews/${id}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.message || 'Failed to get weekly review');
  return json.data;
}

// retro_note 수정
export async function updateWeeklyReviewNote(id: number, retro_note: string | null): Promise<WeeklyReview> {
  const res = await apiFetch(`/api/weekly-reviews/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ retro_note }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.message || 'Failed to update');
  return json.data;
}

// 삭제
export async function deleteWeeklyReview(id: number): Promise<void> {
  const res = await apiFetch(`/api/weekly-reviews/${id}`, { method: 'DELETE' });
  const json = await res.json();
  if (!json.success) throw new Error(json.message || 'Failed to delete');
}

// 설정 조회
export async function getWeeklyReviewSettings(businessId: number): Promise<WeeklyReviewSettings> {
  const res = await apiFetch(`/api/weekly-reviews/settings?business_id=${businessId}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.message || 'Failed to get settings');
  return json.data;
}

// 설정 변경
export async function updateWeeklyReviewSettings(params: {
  business_id: number;
  auto_enabled: boolean;
}): Promise<WeeklyReviewSettings> {
  const res = await apiFetch('/api/weekly-reviews/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.message || 'Failed to update settings');
  return json.data;
}

// ─── Preview 빌드 (서버 호출 없이 현재 주 예상) ───
// POST / 전에 모달에서 보여줄 preview용 — 서버 API 추가 시 교체
export async function previewCurrentWeek(_businessId: number): Promise<WeeklyReviewSnapshot | null> {
  // 서버에 preview 엔드포인트가 없으므로 null 반환
  // 실제 저장 시 서버에서 빌드
  return null;
}
