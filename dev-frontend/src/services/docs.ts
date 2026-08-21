// Q docs 서비스 — 문서·템플릿 통합 시스템
// 백엔드: /api/docs/templates · /api/docs/documents
import { apiFetch } from '../contexts/AuthContext';

// ★ Document(문서) 엔티티의 CRUD 함수는 제거됐다 (#250 후속, Fable 설계 게이트 2026-08-08).
//   이유: Document 를 여는 화면이 제품에 **존재한 적이 없다** — DocumentEditorPage/NewDocumentModal 은
//   한 번도 라우팅되지 않은 채 3개월간 남아 있었고, 운영 documents 는 0행이었다.
//   살아있는 문서 표면은 **Post**(QDocsPage → components/Docs/PostsPage) 하나뿐이다.
//   여기 남은 것은 그 Post 화면이 실제로 쓰는 것들뿐 — 템플릿(listTemplates)·AI 생성(aiGenerateDoc)·
//   종류 라벨(DocKind/KIND_*). 백엔드 routes/docs.js·공개 공유(/public/docs/:token)는 그대로 살아있다.
//   ⚠️ Document CRUD 를 되살리려면 Post 와 경쟁하는 병행 문서 시스템이 된다 — 설계 결정을 먼저 할 것.
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
  security_level?: 'general' | 'internal' | 'confidential';  // D4 #62
  ai_generated: boolean;
  created_via?: string | null;   // ⑤B provenance('cue' 등) — 표시 전용
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
  project_id?: number | null;
  template_id?: number | null;
  instruction?: string;  // 운영 — AI 재생성/재수정 지시 (에디터 레벨 재생성 시 사용)
  // 운영 #312 — 재생성은 "다시 쓰기" 가 아니라 "고쳐 쓰기" 다.
  //   base_html: 지금 화면의 본문(사용자가 손으로 고친 것 포함) — 이걸 원본으로 고친다
  //   instructions: 지금까지 준 지시 전부 (누적). 안 보내면 매번 처음으로 되돌아간다.
  base_html?: string;
  instructions?: string[];
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


// ─── 사이클 I4 — 문서 revision diff (슬롯 변경 이력) ───
export interface DocRevision {
  id: number;
  document_id: number;
  revision_number: number;
  body_snapshot: { form_data?: unknown; body_json?: unknown } | null;
  changed_fields: Record<string, { from: unknown; to: unknown }> | null;
  changed_by: number | null;
  change_note: string | null;
  created_at: string;
  changer?: { id: number; name: string } | null;
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

// i18n 키 매핑 (qdocs 네임스페이스). t(KIND_LABEL_KEYS[kind], { defaultValue: KIND_LABELS_KO[kind] }) 로 사용.
export const KIND_LABEL_KEYS: Record<DocKind, string> = {
  quote: 'docKind.quote',
  invoice: 'docKind.invoice',
  tax_invoice: 'docKind.taxInvoice',
  contract: 'docKind.contract',
  nda: 'docKind.nda',
  proposal: 'docKind.proposal',
  sow: 'docKind.sow',
  meeting_note: 'docKind.meetingNote',
  sop: 'docKind.sop',
  custom: 'docKind.custom',
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
