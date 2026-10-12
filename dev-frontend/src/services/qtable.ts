// 표(table) API 서비스 — 동적 테이블 (Notion DB 패턴).
//   ★ 제품에 'Q record' 라는 메뉴는 없다. 이 파일이 다루는 것은 Q docs 문서 안의 **표**다.
//     서버 경로·테이블 이름은 여전히 record 계열이다 — 아래 주석 참조.
import { apiFetch } from '../contexts/AuthContext';

export type QRecordColumnType =
  | 'text' | 'longtext' | 'number' | 'date' | 'datetime'
  | 'checkbox' | 'url' | 'email' | 'phone'
  | 'select' | 'multi_select' | 'secret'
  | 'attach'   // 파일/문서 첨부 — 셀 값 = { kind: 'file'|'post', id: number, label?: string }[]
  | 'row_sum' | 'row_avg' | 'row_min' | 'row_max'  // 행 기준 자동 계산 — 같은 행의 모든 number 컬럼 합산/평균/최소/최대
  | 'yesno' | 'rating' | 'scale';  // 설문 v2 — 예/아니오(true/false) · 별점 1~5 · 척도 0~10(NPS). 표에서도 쓴다

export type QRecordAggregate = 'none' | 'count' | 'sum' | 'avg' | 'min' | 'max' | 'empty' | 'filled';

export interface QRecordColumn {
  id: string;
  name: string;
  type: QRecordColumnType;
  options?: string[];
  order: number;
  aggregate?: QRecordAggregate;  // 컬럼 footer 집계 — none 또는 미설정 시 표시 X
  bg?: string;                   // 열 색 — 팔레트 CELL_FILLS key (2026-10-12)
}

export interface QRecordSummary {
  id: number;
  business_id: number;
  project_id: number | null;
  name: string;
  category: string | null;
  description: string | null;
  columns: QRecordColumn[];
  read_policy: 'all' | 'owner';
  position: number;
  row_count: number;
  created_at: string;
  updated_at: string;
  Project?: { id: number; name: string } | null;
  creator?: { id: number; name: string } | null;
}

export interface QRecordRow {
  id: number;
  q_record_id: number;
  values: Record<string, unknown>;
  position: number;
  // 설문 v2 — 응답 줄의 회차·받는 사람(조인). 손으로 넣은 줄·공개 링크·익명은 null
  survey_issue_id?: number | null;
  survey_recipient_id?: number | null;
  respondent?: { name: string | null; email: string } | null;
  created_by?: number | null;
  created_at: string;
  updated_at: string;
}

export interface QRecordDetail extends QRecordSummary {
  rows: QRecordRow[];
  survey_on?: boolean;          // 공개 링크(옛 표-설문 포함)가 켜져 있나 — 열쇠 값은 싣지 않는다
  responses_hidden?: boolean;   // 설문 응답을 볼 수 없는 사람(멤버 미만) — 질문지만 보인다
}

// 사이클 N+55 — auto-paginate. records 백엔드 default 200 / max 500. 5 page 자동 누적.
export async function fetchRecords(businessId: number, opts?: { projectId?: number | null; category?: string }): Promise<QRecordSummary[]> {
  const baseParams = new URLSearchParams({ business_id: String(businessId) });
  if (opts?.projectId != null) baseParams.set('project_id', String(opts.projectId));
  if (opts?.category) baseParams.set('category', opts.category);
  const collected: QRecordSummary[] = [];
  const MAX_PAGES = 5;
  const LIMIT = 500;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const p = new URLSearchParams(baseParams);
    p.set('page', String(page));
    p.set('limit', String(LIMIT));
    const r = await apiFetch(`/api/records?${p}`);
    const j = await r.json();
    if (!j.success) break;
    collected.push(...((j.data || []) as QRecordSummary[]));
    if (!j.pagination || !j.pagination.has_more) break;
  }
  return collected;
}

export async function fetchRecordCategories(businessId: number): Promise<string[]> {
  const r = await apiFetch(`/api/records/categories?business_id=${businessId}`);
  const j = await r.json();
  return (j.data || []) as string[];
}

export async function fetchRecord(id: number): Promise<QRecordDetail | null> {
  const r = await apiFetch(`/api/records/${id}`);
  const j = await r.json();
  if (!j.success) return null;
  return j.data as QRecordDetail;
}

export async function createRecord(payload: {
  business_id: number;
  project_id?: number | null;
  name: string;
  category?: string | null;
  description?: string | null;
  columns?: Partial<QRecordColumn>[];
}): Promise<QRecordSummary> {
  const r = await apiFetch('/api/records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'create failed');
  return j.data as QRecordSummary;
}

export async function updateRecord(id: number, patch: Partial<{
  name: string; category: string | null; description: string | null;
  read_policy: 'all' | 'owner'; columns: QRecordColumn[];
}>): Promise<QRecordSummary> {
  const r = await apiFetch(`/api/records/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'update failed');
  return j.data as QRecordSummary;
}

export async function deleteRecord(id: number): Promise<boolean> {
  const r = await apiFetch(`/api/records/${id}`, { method: 'DELETE' });
  const j = await r.json();
  return !!j.success;
}

/** place 가 있으면 그 행 위/아래에 끼워 넣는다(없으면 맨 끝) */
export async function createRow(recordId: number, values: Record<string, unknown>,
  place?: { before_row_id?: number; after_row_id?: number }): Promise<QRecordRow> {
  const r = await apiFetch(`/api/records/${recordId}/rows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values, ...(place || {}) }),
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'row create failed');
  return j.data as QRecordRow;
}

export async function updateRow(recordId: number, rowId: number, patch: { values?: Record<string, unknown>; position?: number }): Promise<QRecordRow> {
  const r = await apiFetch(`/api/records/${recordId}/rows/${rowId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'row update failed');
  return j.data as QRecordRow;
}

export async function deleteRow(recordId: number, rowId: number): Promise<boolean> {
  const r = await apiFetch(`/api/records/${recordId}/rows/${rowId}`, { method: 'DELETE' });
  const j = await r.json();
  return !!j.success;
}

export async function revealSecret(recordId: number, rowId: number, columnId: string): Promise<string> {
  const r = await apiFetch(`/api/records/${recordId}/rows/${rowId}/secret/${columnId}`);
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'reveal failed');
  return (j.data?.value as string) || '';
}

// ─── 설문 — #460(표의 «응답 받기» 문) → v2(Q docs 세 번째 종류, docs/SURVEY_V2_DESIGN.md) ───
export interface SurveySettings {
  title?: string; intro?: string; required?: string[]; hidden?: string[];
  help?: Record<string, string>; closes_at?: string | null; max_responses?: number | null;
  anonymous?: boolean; thanks?: string;
}
export interface SurveyView {
  enabled: boolean; token: string | null; path: string | null; settings: SurveySettings;
  response_count: number; hard_cap: number; blocked: 'security_level' | null;
}
export interface SurveyColumnStat {
  id: string; name: string; type: QRecordColumnType; answered: number;
  counts?: Record<string, number>; avg?: number | null; min?: number | null; max?: number | null;
  by_day?: Record<string, number>; recent?: string[];
  dist?: Record<string, number>;                         // 별점 1~5 · 척도 0~10 (0건인 값도 키가 있다)
  nps?: number | null; promoters?: number; passives?: number; detractors?: number;
  yes_pct?: number | null;
}
export interface SurveyStatsData { total: number; survey_count: number; kind?: 'survey' | 'table'; columns: SurveyColumnStat[] }
/** 설정 조회 — 켤 권한이 없으면 null(버튼을 숨긴다) */
export async function fetchSurvey(recordId: number): Promise<SurveyView | null> {
  const r = await apiFetch(`/api/records/${recordId}/survey`);
  if (r.status === 403 || r.status === 404) return null;
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'survey_load_failed');
  return j.data as SurveyView;
}
/** 켜기·끄기·설정 저장 — 실패는 던진다(AutoSaveField 가 ! 뱃지로 보여 준다) */
export async function saveSurvey(recordId: number, body: { enabled?: boolean; settings?: SurveySettings }): Promise<SurveyView> {
  const r = await apiFetch(`/api/records/${recordId}/survey`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'survey_save_failed');
  return j.data as SurveyView;
}
/** 통계 — 계산은 서버(services/surveyStats) 한 곳. scope: 회차·기간 거르기 */
export async function fetchSurveyStats(recordId: number, scope?: { issueId?: number | null; from?: string; to?: string }): Promise<SurveyStatsData> {
  const p = new URLSearchParams();
  if (scope?.issueId) p.set('issue_id', String(scope.issueId));
  if (scope?.from) p.set('from', scope.from);
  if (scope?.to) p.set('to', scope.to);
  const qs = p.toString();
  const r = await apiFetch(`/api/records/${recordId}/survey-stats${qs ? `?${qs}` : ''}`);
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'survey_stats_failed');
  return j.data;
}

// ── 발행(회차·받는 사람) — /api/surveys/:recordId/* ──
export interface SurveyRecipientView {
  id: number; client_id: number | null; email: string; display_name: string | null;
  status: 'queued' | 'sent' | 'failed' | 'responded';
  sent_at: string | null; opened_at: string | null; responded_at: string | null;
  revoked: boolean; has_responded: boolean;
}
export interface SurveyIssueView {
  id: number; origin: 'manual' | 'rule'; rule_id: number | null;
  status: 'pending_review' | 'sent' | 'skipped' | 'expired' | 'failed' | 'blocked_quota';
  title: string; message: string | null; closes_at: string | null; sent_at: string | null; created_at: string;
  counts: { total: number; sent: number; failed: number; opened: number; responded: number; missing: number };
  rate: number | null;
  recipients: SurveyRecipientView[];
}
export interface SurveyQuota { limit: number | null; used: number; remaining: number | null }
export interface SurveyCandidate { id: number; name: string; company: string | null; email: string | null; status: string }

async function jsonOrThrow(r: Response) {
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.success) {
    const e = new Error(j.message || `http_${r.status}`) as Error & { status?: number; data?: unknown };
    e.status = r.status; e.data = j;
    throw e;
  }
  return j.data;
}
export async function fetchSurveyIssues(recordId: number): Promise<{ issues: SurveyIssueView[]; quota: SurveyQuota }> {
  return jsonOrThrow(await apiFetch(`/api/surveys/${recordId}/issues`));
}
export async function fetchSurveyCandidates(recordId: number, projectId?: number | null): Promise<{ clients: SurveyCandidate[]; projects: { id: number; name: string }[]; quota: SurveyQuota }> {
  return jsonOrThrow(await apiFetch(`/api/surveys/${recordId}/candidates${projectId ? `?project_id=${projectId}` : ''}`));
}
export async function sendSurveyIssue(recordId: number, body: { client_ids: number[]; emails: string[]; title?: string; message?: string; closes_at?: string | null }): Promise<{ issue: SurveyIssueView; background: boolean }> {
  return jsonOrThrow(await apiFetch(`/api/surveys/${recordId}/issues`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
}
export async function resendSurveyIssue(recordId: number, issueId: number, recipientIds?: number[]): Promise<{ issue: SurveyIssueView }> {
  return jsonOrThrow(await apiFetch(`/api/surveys/${recordId}/issues/${issueId}/resend`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(recipientIds ? { recipient_ids: recipientIds } : {}) }));
}
export async function revokeSurveyRecipient(recordId: number, recipientId: number): Promise<{ issue: SurveyIssueView }> {
  return jsonOrThrow(await apiFetch(`/api/surveys/${recordId}/recipients/${recipientId}/revoke`, { method: 'POST' }));
}
/** 응답 화면 미리보기 — 공개 GET 과 같은 모양(제출 불가) */
export interface SurveyQuestion { id: string; name: string; type: string; options?: string[]; required: boolean; help?: string }
export interface SurveyQuestionnaire {
  title: string; intro: string; description_html: string; workspace_name: string; closes_at: string | null;
  thanks: string; hello_name: string | null; personal: boolean; questions: SurveyQuestion[]; preview?: boolean;
}
export async function fetchSurveyPreview(recordId: number): Promise<SurveyQuestionnaire> {
  return jsonOrThrow(await apiFetch(`/api/surveys/${recordId}/preview`));
}
