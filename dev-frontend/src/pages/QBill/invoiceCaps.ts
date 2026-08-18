// invoiceCaps — 청구서 화면의 **권한 판정 단일 착지점** (운영 #274, Fable 설계 2026-08-18)
//
// 왜 이 파일이 생겼나:
//   `InvoiceDetailDrawer` 가 버튼마다 `isOwner &&` 를 흩뿌리고 있었고, **8개 발행자 버튼 중 3개가
//   그 조건에서 빠져** 있었다(재발송·결제 독촉·청구서 취소). 그래서 청구서를 받은 고객 화면에
//   "결제 독촉 보내기"·"청구서 취소" 가 그대로 떴다 — Irene 신고 지점.
//   버튼 단위 조건은 다음에 버튼이 하나 추가될 때 또 빠진다. **판정을 한 곳에 모으고 블록으로 자른다.**
//
// 백엔드 정책 미러 (routes/invoices.js):
//   · owner-only  = send / preview / markPaid / unmarkPaid / delete / cancel / markReceipt
//                   (`assertInvoiceMutationOwner` 및 인라인 owner 검사와 1:1)
//   · member 허용 = editDraft / resend / remind / toggleOverdueNotify
//                   (돈을 움직이지 않는 발송 행위 — member 수금 업무를 죽이지 않기 위해 의도적 유지)
//   · recipient   = 발행자 액션 **전부 false** (fail-closed)
//
// ★ 프론트는 보이기만 막는다. 최종 방어는 백엔드다 — 여기 값을 근거로 서버 검사를 빼면 안 된다.

export type InvoiceViewer = 'owner' | 'member' | 'recipient';

interface ViewerUser {
  business_role?: string | null;
  platform_role?: string | null;
}

/** 로그인 사용자 → 뷰어 3분류. 판정 재료는 여기서만 읽는다. */
export function invoiceViewerOf(user?: ViewerUser | null): InvoiceViewer {
  if (!user) return 'recipient';                        // 모르면 가장 좁은 쪽 (fail-closed)
  if (user.business_role === 'client') return 'recipient';
  if (user.platform_role === 'platform_admin') return 'owner';
  if (user.business_role === 'owner') return 'owner';
  return 'member';
}

export interface InvoiceCaps {
  /** 발행자 액션바 블록 자체를 그릴지 — 버튼 단위가 아니라 **블록 단위** 분기의 근거 */
  showIssuerActions: boolean;
  canSend: boolean;
  canPreview: boolean;
  canEditDraft: boolean;
  canDelete: boolean;
  canMarkPaid: boolean;
  canUnmarkPaid: boolean;
  canResend: boolean;
  canRemind: boolean;
  canCancel: boolean;
  canMarkReceipt: boolean;
  canToggleOverdueNotify: boolean;
  /** 수신자(고객) 액션 */
  canOpenPayPage: boolean;
  canNotifyPaid: boolean;
  /** 상태이력·타임라인 등 내부 정보를 부를지 (recipient 는 403 이라 호출 자체를 안 한다) */
  canViewInternalHistory: boolean;
}

export function invoiceCapsOf(viewer: InvoiceViewer): InvoiceCaps {
  const isOwner = viewer === 'owner';
  const isStaff = viewer === 'owner' || viewer === 'member';
  const isRecipient = viewer === 'recipient';
  return {
    showIssuerActions: isStaff,
    canSend: isOwner,
    canPreview: isOwner,
    canEditDraft: isStaff,
    canDelete: isOwner,
    canMarkPaid: isOwner,
    canUnmarkPaid: isOwner,
    canResend: isStaff,
    canRemind: isStaff,
    canCancel: isOwner,
    canMarkReceipt: isOwner,
    canToggleOverdueNotify: isStaff,
    canOpenPayPage: isRecipient,
    canNotifyPaid: isRecipient,
    canViewInternalHistory: isStaff,
  };
}

/**
 * 입금자명에 넣을 **입금 코드**.
 *
 * 왜 서버 값을 우선하는가: 이 문자열을 드로어·공개 결제 페이지·발송 메일 **세 곳이 각자 조립**하고
 * 있었고 이미 서로 달랐다(공개 페이지만 수신처 라벨이 하나 더 붙었다). 같은 값의 공식이 여러 벌이면
 * 반드시 갈라진다 — 서버가 계산한 `payer_code` 를 정본으로 쓰고, 여기 폴백은 **서버가 아직 안 내려줄 때만**.
 *
 * 형식 `0042홍길동` (청구서 순번 끝 4자리 + 고객 표시명, 분할이면 `0042-2홍길동`):
 *   국내 은행 "받는 분 통장 표시" 는 한글 5~8자에서 **뒷부분이 잘린다**. 현행 `INV-2026-0042 상호명` 은
 *   번호만 13자라 이름이 나오기도 전에 잘렸다. 절단이 꼬리에서 일어나므로 **식별번호를 선두에** 둔다.
 */
export function payerCodeOf(
  invoice: { payer_code?: string | null; invoice_number?: string | null } | null | undefined,
  clientName?: string | null,
  installmentNo?: number | null,
): string {
  if (!invoice) return '';
  if (invoice.payer_code) return invoice.payer_code;   // 서버 계산이 정본
  const num = String(invoice.invoice_number || '');
  const seq = /-(\d+)$/.exec(num)?.[1] || num.replace(/\D/g, '').slice(-4);
  const head = installmentNo ? `${seq}-${installmentNo}` : seq;
  return `${head}${(clientName || '').trim()}`;
}
