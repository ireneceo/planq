// services/saleRegister — 미등록 문의를 **고객으로 등록(+초대)** 하는 한 벌
//
// ★ 같은 버튼을 두 화면이 갖는다: Q sale 상담 목록과 확인 필요(Todo)의 우측 패널.
//   각자 구현하면 반드시 갈라진다 — 한쪽만 초대 메일을 보내거나, 한쪽만 실패를 삼킨다
//   (memory feedback_copied_component_drifts_extract_shell).
// ★ 문구는 여기 두지 않는다. 화면이 자기 네임스페이스로 번역한다 — 서비스가 사용자 문장을 짓지 않는다.
import { apiFetch } from '../contexts/AuthContext';
import type { SaleInboxItem } from './sale';

/** 등록에 필요한 것만 — 상담 목록 행이든 확인 필요 payload 든 이 모양이면 된다 */
export type SaleRegisterInput = Pick<SaleInboxItem, 'ref' | 'who' | 'email' | 'company'>;

/** 등록은 됐지만 **초대는 못 간** 경우 — 조용히 넘어가지 않게 부르는 쪽에 돌려준다 */
export type SaleRegisterWarn = 'invite_failed' | 'invite_no_email';

export interface SaleRegisterResult {
  /** 등록(원장 생성) 자체의 성공 여부 */
  ok: boolean;
  clientId: number | null;
  /** ok=false 면 없음, ok=true 면 초대 단계의 경고 */
  warn?: SaleRegisterWarn;
  /** 서버가 준 문구 — 있으면 그대로 보여준다(우리가 지어내지 않는다) */
  message?: string | null;
}

export async function registerInquiryAsClient(
  businessId: number,
  it: SaleRegisterInput,
): Promise<SaleRegisterResult> {
  // 기존 라우트를 그대로 부른다(서버가 중복 연결·한도까지 판정한다)
  const body = it.ref.kind === 'guest_link'
    ? { from: 'guest_link', guest_link_id: it.ref.id }
    : { from: 'email_thread', email_thread_id: it.ref.id };
  const r = await apiFetch(`/api/sale/${businessId}/save-as-client`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || j?.success === false) {
    return { ok: false, clientId: null, message: j?.message || `HTTP ${r.status}` };
  }
  const clientId = j?.data?.client?.id ?? j?.data?.id ?? null;

  // ★ 2026-09-13 (Irene: "고객으로 등록 버튼 누르면 초대메일 보내져야지 왜 고객페이지로 가?")
  //   등록은 원장을 만드는 것이고, **초대는 그 사람에게 문을 여는 것**이다. 둘을 잇는다.
  //   ☐ 이메일이 없으면 보낼 수 없다 — 초대 라우트가 name·email 을 필수로 받는다.
  //     그때는 등록만 하고 패널의 [초대 보내기] 로 남긴다(경고로 알린다).
  const invitee = it.email;
  if (!clientId) return { ok: true, clientId: null };
  if (!invitee) return { ok: true, clientId, warn: 'invite_no_email' };

  const inv = await apiFetch(`/api/clients/${businessId}/invite`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: it.who || invitee, email: invitee, company_name: it.company?.name || null }),
  });
  if (!inv.ok) {
    const ij = await inv.json().catch(() => null);
    // 등록 자체는 성공했다 — 초대만 실패했음을 분명히 말한다(실패를 삼키지 않는다)
    return { ok: true, clientId, warn: 'invite_failed', message: ij?.message || null };
  }
  return { ok: true, clientId };
}
