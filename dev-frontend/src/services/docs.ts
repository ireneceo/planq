// Q docs 서비스 — 문서·템플릿 통합 시스템
// 백엔드: /api/docs/templates · /api/docs/documents
import { apiFetch } from '../contexts/AuthContext';

export type DocKind =
  | 'quote' | 'invoice' | 'tax_invoice' | 'contract' | 'nda'
  | 'proposal' | 'sow' | 'meeting_note' | 'sop' | 'custom';

export type DocMode = 'form' | 'editor' | 'hybrid';

export type DocStatus = 'draft' | 'sent' | 'viewed' | 'accepted' | 'rejected' | 'signed' | 'archived';

export interface DocTemplate {
  id: number;
  business_id: number | null;
  kind: DocKind;
  name: string;
  description: string | null;
  mode: DocMode;
  schema_json: Record<string, unknown> | null;
  body_template: string | null;
  variables_json: Record<string, unknown> | null;
  visibility: 'workspace_only' | 'client_shareable';
  locale: 'ko' | 'en' | 'bilingual';
  is_system: boolean;
  is_active: boolean;
  preview_image: string | null;
  usage_count: number;
}

export interface DocSummary {
  id: number;
  business_id: number;
  template_id: number | null;
  kind: DocKind;
  title: string;
  status: DocStatus;
  client_id: number | null;
  project_id: number | null;
  quote_id: number | null;
  invoice_id: number | null;
  share_token: string | null;
  ai_generated: boolean;
  created_at: string;
  updated_at: string;
  Client?: { id: number; display_name: string | null; company_name: string | null } | null;
  Project?: { id: number; name: string } | null;
  creator?: { id: number; name: string } | null;
}

export interface DocDetail extends DocSummary {
  form_data: Record<string, unknown> | null;
  body_json: Record<string, unknown> | null;
  body_html: string | null;
  pdf_url: string | null;
  DocumentTemplate?: DocTemplate;
}

export async function listTemplates(businessId: number, kind?: DocKind): Promise<DocTemplate[]> {
  const qs = new URLSearchParams();
  qs.set('business_id', String(businessId));
  if (kind) qs.set('kind', kind);
  const r = await apiFetch(`/api/docs/templates?${qs}`);
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'Failed');
  return j.data;
}

export async function listDocuments(params: {
  businessId: number;
  kind?: DocKind;
  status?: DocStatus;
  clientId?: number;
  projectId?: number;
  query?: string;
}): Promise<DocSummary[]> {
  const qs = new URLSearchParams();
  qs.set('business_id', String(params.businessId));
  if (params.kind) qs.set('kind', params.kind);
  if (params.status) qs.set('status', params.status);
  if (params.clientId) qs.set('client_id', String(params.clientId));
  if (params.projectId) qs.set('project_id', String(params.projectId));
  if (params.query) qs.set('q', params.query);
  const r = await apiFetch(`/api/docs/documents?${qs}`);
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'Failed');
  return j.data;
}

export async function getDocument(id: number): Promise<DocDetail> {
  const r = await apiFetch(`/api/docs/documents/${id}`);
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'Failed');
  return j.data;
}

export async function createDocument(payload: {
  business_id: number;
  template_id?: number | null;
  kind: DocKind;
  title: string;
  client_id?: number | null;
  project_id?: number | null;
  form_data?: Record<string, unknown> | null;
  body_json?: Record<string, unknown> | null;
  body_html?: string | null;
}): Promise<DocDetail> {
  const r = await apiFetch('/api/docs/documents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'Failed');
  return j.data;
}

export async function updateDocument(id: number, payload: Partial<{
  title: string;
  status: DocStatus;
  form_data: Record<string, unknown> | null;
  body_json: Record<string, unknown> | null;
  body_html: string | null;
  client_id: number | null;
  project_id: number | null;
  ai_generated: boolean;
}>): Promise<DocDetail> {
  const r = await apiFetch(`/api/docs/documents/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'Failed');
  return j.data;
}

export interface AiGenerateResult {
  body_html: string;
  usage: { total: number; limit: number; remaining: number; over: boolean };
}
export async function aiGenerateDoc(payload: {
  business_id: number;
  kind: DocKind;
  title: string;
  user_input: string;
  client_id?: number | null;
  template_id?: number | null;
}): Promise<AiGenerateResult> {
  const r = await apiFetch('/api/docs/ai-generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = await r.json();
  if (r.status === 429) {
    const e = new Error('cue_limit_exceeded') as Error & { usage?: AiGenerateResult['usage'] };
    e.usage = j.usage;
    throw e;
  }
  if (!j.success) throw new Error(j.message || 'Failed');
  return j.data;
}

export async function archiveDocument(id: number): Promise<void> {
  const r = await apiFetch(`/api/docs/documents/${id}`, { method: 'DELETE' });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'Failed');
}

export async function shareDocument(id: number, payload: {
  method?: 'link' | 'email' | 'qtalk';
  recipient_email?: string;
  recipient_name?: string;
  expires_in_days?: number;
}): Promise<{ share_url: string; share: Record<string, unknown> }> {
  const r = await apiFetch(`/api/docs/documents/${id}/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.message || 'Failed');
  return j.data;
}

export const KIND_LABELS_KO: Record<DocKind, string> = {
  quote: '견적서',
  invoice: '청구서',
  tax_invoice: '세금계산서',
  contract: '계약서',
  nda: '비밀유지계약서',
  proposal: '제안서',
  sow: '작업내역서',
  meeting_note: '회의록',
  sop: '운영문서',
  custom: '자유 문서',
};

// 라인 아이콘 (Lucide-style) — 이모지 사용 안 함.
// 컴포넌트에서 KIND_ICON_PATH[kind] 를 svg children 으로 렌더.
export const KIND_ICON_PATH: Record<DocKind, React.ReactElement> = {} as Record<DocKind, React.ReactElement>;
// (실제 라인 아이콘은 컴포넌트에서 KIND_ICON_PATH 대신 직접 svg 인라인. 단순화 위해 빈 매핑.)
// Legacy 호환 — 빈 string 으로 사용처 확인 후 일괄 제거.
export const KIND_ICON: Record<DocKind, string> = {
  quote: '', invoice: '', tax_invoice: '',
  contract: '', nda: '', proposal: '',
  sow: '', meeting_note: '', sop: '', custom: '',
};
