// services/saleRegister — 미등록 문의를 **문의 고객 원장으로** 남기는 한 벌(첫 액션 자동 등록)
//
// ★ 같은 버튼을 두 화면이 갖는다: Q sale 상담 목록과 확인 필요(Todo)의 우측 패널.
//   각자 구현하면 반드시 갈라진다 — 한쪽만 초대 메일을 보내거나, 한쪽만 실패를 삼킨다
//   (memory feedback_copied_component_drifts_extract_shell).
// ★ 문구는 여기 두지 않는다. 화면이 자기 네임스페이스로 번역한다 — 서비스가 사용자 문장을 짓지 않는다.
import { apiFetch } from '../contexts/AuthContext';
import { getWebformText, SALE_PREFILL_EVENT, type SalePrefillDetail } from './sale';
import type { SaleInboxItem } from './sale';

/** 등록에 필요한 것만 — 상담 목록 행이든 확인 필요 payload 든 이 모양이면 된다 */
export type SaleRegisterInput = Pick<SaleInboxItem, 'ref' | 'who' | 'email' | 'company'>;

export interface SaleRegisterResult {
  /** 등록(원장 생성) 자체의 성공 여부 */
  ok: boolean;
  clientId: number | null;
  /** 서버가 준 문구 — 있으면 그대로 보여준다(우리가 지어내지 않는다) */
  message?: string | null;
}

/** 첫 액션 자동 등록 — 우측 패널에서 기록·업무를 처음 남길 때 **문의 고객(prospect) 원장만** 만든다. 메일은 보내지 않는다.
 *  ★ 2026-10-23 명시적 [고객으로 등록] 은 여기를 지나지 않는다 — 고객 추가 드로어(추가/초대)를 연다
 *    (docs/CLIENT_ADD_INVITE_DESIGN.md §4). 옛 «등록 = 문의 행 + 곧바로 초대 메일» 은 지웠다:
 *    «등록» 버튼이 사실상 «초대» 였고, 메일이 없으면 «등록했다» 고 믿는 문의 고객만 남았다. */
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
    // #449 D5 — 웹폼 릴레이(no-reply@…)는 서버 코드 `relay_sender_use_manual` 로 온다. 화면이 번역한다(위 머리말).
    //   등록 자체는 막되 **다음 행동을 대신 준비한다** — 마지막 수신 본문을 Q sales 문의 추가(Cue 바)로 넘긴다.
    if (j?.message === 'relay_sender_use_manual' && it.ref.kind === 'email_thread') {
      try {
        const w = await getWebformText(businessId, it.ref.id);
        window.dispatchEvent(new CustomEvent<SalePrefillDetail>(SALE_PREFILL_EVENT, { detail: { text: w.text, emailThreadId: it.ref.id } }));
      } catch { /* 본문을 못 읽어도 사유는 그대로 알린다 */ }
    }
    return { ok: false, clientId: null, message: j?.message || `HTTP ${r.status}` };
  }
  return { ok: true, clientId: j?.data?.client?.id ?? j?.data?.id ?? null };
}
