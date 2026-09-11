// 플랫폼 문의 제출 — PlanSettings Enterprise 문의, 랜딩 "문의하기" 등에서 공통 사용.
// 인증 optional. 응답: { id, submitted_at }.
import { apiFetch } from '../contexts/AuthContext';

export interface InquiryPayload {
  kind?: 'enterprise' | 'general' | 'landing';
  source?: string;
  from_name: string;
  from_email: string;
  from_company?: string;
  from_phone?: string;
  message: string;
  /** 보낸 워크스페이스 — 서버가 멤버십을 확인한 뒤에만 적는다 */
  business_id?: number | null;
}

export async function submitInquiry(payload: InquiryPayload): Promise<{ id: number; submitted_at: string } | null> {
  try {
    const r = await apiFetch('/api/inquiries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.message || 'failed');
    return j.data;
  } catch (e) {
    console.warn('[inquiry] submit failed', e);
    return null;
  }
}
