// 청구서 첨부(파일·문서) API — 서버 routes/invoice_attachments.js · 판정 services/invoiceAttachments.js
//   설계 docs/INVOICE_ATTACHMENTS_DESIGN.md
import { apiFetch } from '../contexts/AuthContext';

/** 숨김 이유 — 'internal'(내부용) · 'deleted' · 'private'(나만 보기 파일) · 'confidential'(보안등급) · 'post_not_shared'(문서 외부 공유 안 됨) */
export type AttachPublicReason = 'internal' | 'deleted' | 'private' | 'confidential' | 'post_not_shared';

export interface InvoiceAttachmentRow {
  id: number;
  kind: 'file' | 'post';
  file_id: number | null;
  post_id: number | null;
  name: string | null;
  size?: number;
  mime_type?: string | null;
  category?: string | null;
  client_visible: boolean;
  /** 'shown' = 고객에게 보인다 · 그 외 = 안 보이는 이유 */
  public_state: 'shown' | AttachPublicReason;
  /** null = «고객에게 보이기» 를 켤 수 있다 · 그 외 = 못 켜는 이유 */
  shareable_reason: Exclude<AttachPublicReason, 'internal'> | null;
  deleted?: boolean;
  locked?: boolean;
}

/** 고객(비멤버)이 받는 모양 — 밖으로 나가는 것만 */
export interface InvoicePublicAttachment {
  id: number;
  kind: 'file' | 'post';
  name: string;
  size?: number;
  mime_type?: string | null;
  download_url?: string | null;
  url?: string;
}

/** 발행 창이 아직 저장 전에 들고 있는 한 줄 */
export interface PendingAttachment {
  kind: 'file' | 'post';
  file_id: number | null;
  post_id: number | null;
  name: string;
  size?: number;
  mime_type?: string | null;
  client_visible: boolean;
  shareable_reason: Exclude<AttachPublicReason, 'internal'> | null;
}

async function json<T>(r: Response): Promise<T> {
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.success) {
    const e = new Error(j?.message || `HTTP ${r.status}`) as Error & { code?: string; status?: number };
    e.code = j?.message; e.status = r.status;
    throw e;
  }
  return j.data as T;
}

const JSON_HDR = { 'Content-Type': 'application/json' };

export async function listInvoiceAttachments(businessId: number, invoiceId: number): Promise<Array<InvoiceAttachmentRow | InvoicePublicAttachment>> {
  return json(await apiFetch(`/api/invoices/${businessId}/${invoiceId}/attachments`));
}

export async function addInvoiceAttachments(businessId: number, invoiceId: number, body: { file_ids?: number[]; post_ids?: number[] }): Promise<{ added: number; attachments: InvoiceAttachmentRow[] }> {
  return json(await apiFetch(`/api/invoices/${businessId}/${invoiceId}/attachments`, { method: 'POST', headers: JSON_HDR, body: JSON.stringify(body) }));
}

export async function setInvoiceAttachmentVisible(businessId: number, invoiceId: number, attId: number, clientVisible: boolean): Promise<{ attachments: InvoiceAttachmentRow[] }> {
  return json(await apiFetch(`/api/invoices/${businessId}/${invoiceId}/attachments/${attId}`, { method: 'PATCH', headers: JSON_HDR, body: JSON.stringify({ client_visible: clientVisible }) }));
}

export async function removeInvoiceAttachment(businessId: number, invoiceId: number, attId: number): Promise<{ attachments: InvoiceAttachmentRow[] }> {
  return json(await apiFetch(`/api/invoices/${businessId}/${invoiceId}/attachments/${attId}`, { method: 'DELETE' }));
}

/** 저장 전(발행 창) — 고른 자료의 이름·켤 수 있는가. 아무것도 저장하지 않는다. */
export async function previewInvoiceAttachments(businessId: number, list: Array<{ file_id?: number; post_id?: number }>): Promise<PendingAttachment[]> {
  const rows = await json<Array<Omit<PendingAttachment, 'client_visible'>>>(await apiFetch(`/api/invoices/${businessId}/attachments-preview`, { method: 'POST', headers: JSON_HDR, body: JSON.stringify({ attachments: list }) }));
  return rows.map((r) => ({ ...r, client_visible: false }));
}
