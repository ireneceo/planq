// 청구서 발송 상태 표시 — 서버(services/invoiceDelivery.js)와 **같은 값 목록**을 쓴다.
//
// 왜 유틸로 빼나: 발송 상태를 그리는 자리가 목록·상세·발행 모달 셋이다. 각자 삼항으로 적으면
// 새 상태가 생길 때 어떤 화면은 기본값으로 조용히 떨어진다 — 사용자에게는 "안 열린다" 로 보인다
// (CLAUDE.md 상태값 규약).
import type { DeliveryStatus, InvoiceDelivery } from '../services/invoices';

export type DeliveryTone = 'progress' | 'good' | 'bad' | 'muted';

/** 진행 중인가 — 스피너를 돌릴지 판단하는 단일 술어 */
export function isDeliveryInFlight(d?: InvoiceDelivery | null): boolean {
  return d?.status === 'queued' || d?.status === 'sending';
}

export function deliveryTone(status?: DeliveryStatus | string | null): DeliveryTone {
  switch (status) {
    case 'queued':
    case 'sending': return 'progress';
    case 'sent': return 'good';
    case 'failed': return 'bad';
    case 'skipped': return 'muted';
    default: return 'muted';   // 모르는 값도 자리는 준다 — 라벨은 값 자체를 보여준다
  }
}

/**
 * 화면 문구. t 는 호출부에서 넘긴다(네임스페이스가 화면마다 다르다).
 * ★ 모르는 상태값은 **그 값을 그대로** 돌려준다. 기본값("대기")으로 떨어뜨리면
 *   무엇이 잘못됐는지 아무도 모른다.
 */
export function deliveryLabel(
  d: InvoiceDelivery | null | undefined,
  t: (key: string, def: string) => string,
): string | null {
  if (!d?.status) return null;
  switch (d.status) {
    case 'queued': return t('delivery.queued', '보내는 중…');
    case 'sending': return t('delivery.sending', '보내는 중…');
    case 'sent': return t('delivery.sent', '보냈습니다');
    case 'skipped': return t('delivery.skipped', '보내지 않음');
    case 'failed': return `${t('delivery.failed', '실패')}${d.reason ? ` · ${deliveryReason(d.reason, t)}` : ''}`;
    default: return String(d.status);
  }
}

/** 실패 사유를 사람 말로. 모르는 사유는 원문을 보여준다 — 감추면 고칠 수가 없다. */
export function deliveryReason(reason: string, t: (key: string, def: string) => string): string {
  switch (reason) {
    case 'no_recipient_email': return t('delivery.reason.noEmail', '받는 사람 이메일이 없습니다');
    case 'no_conversation': return t('delivery.reason.noConv', '연결된 대화방이 없습니다');
    case 'no_target': return t('delivery.reason.noTarget', '고객·프로젝트가 지정되지 않았습니다');
    case 'smtp_rejected': return t('delivery.reason.smtp', '메일 서버가 거부했습니다');
    case 'timeout_no_result': return t('delivery.reason.timeout', '시간 안에 끝나지 않았습니다');
    default: return reason;
  }
}
