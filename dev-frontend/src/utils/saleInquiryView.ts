// utils/saleInquiryView — 상담(미등록 문의) 한 줄 → **패널이 그리는 값** 한 벌
//
// ★ 두 곳이 같은 문의를 연다: Q sale 상담 목록과 확인 필요(Todo).
//   변환을 각자 두면 반드시 갈라진다 — 한쪽에만 이메일 인증 표시가 붙거나,
//   한쪽의 [보기] 만 엉뚱한 곳으로 간다(memory feedback_copied_component_drifts_extract_shell).
//   여기가 그 한 벌이다.
//
// ★ **목록이 받은 것에서만** 만든다. 화면이 따로 모으지 않는다 —
//   서버가 이미 실어 보낸 값을 다시 조회하면 두 값이 어긋날 자리가 생긴다.
import type { SaleInboxItem } from '../services/sale';
import type { TodoItem } from '../services/dashboard';
import type { InquiryView } from '../components/QSale/ClientPanel';

export function inquiryViewOf(it: SaleInboxItem): InquiryView {
  return {
    who: it.who,
    email: it.email,
    company: it.company,
    title: it.title,
    preview: it.preview,
    at: it.at,
    needsReply: it.needs_reply,
    source: it.source,
    // 서버(routes/sale_save)가 받는 것은 게스트 링크·메일 스레드뿐 — 링크 없는 순수 대화방은 못 받는다
    canRegister: it.ref.kind !== 'conversation',
    emailVerified: !!(it.meta as { email_verified?: boolean })?.email_verified,
    openPath: it.open_path,
  };
}

/** 확인 필요(Todo) 의 drawer payload → **상담 목록 행과 같은 모양**.
 *
 *  ★ 서버(services/todo/saleBucket)가 목록과 같은 필드를 통째로 실어 보낸다 —
 *    여기서 다시 조회하지 않는다. 조회하면 같은 문의가 두 화면에서 다르게 보일 자리가 생긴다.
 *  ★ 모양이 안 맞으면 **null 을 돌려준다**(억지로 반쪽 객체를 만들지 않는다) —
 *    받는 쪽은 패널을 열지 않는다. 빈 패널이 뜨는 것보다 안 열리는 게 낫다.
 */
export function inquiryItemOfDrawer(d: NonNullable<TodoItem['drawer']>): SaleInboxItem | null {
  if (d.kind !== 'inquiry' || !d.inquiry || !d.ref) return null;
  const q = d.inquiry;
  return {
    source: q.source as SaleInboxItem['source'],
    id: String(d.id),
    ref: d.ref as SaleInboxItem['ref'],
    who: q.who,
    email: q.email,
    company: q.company,
    title: q.title,
    preview: q.preview,
    at: q.at,
    needs_reply: q.needs_reply,
    meta: q.meta || {},
    open_path: q.open_path,
  };
}
