// components/Common/NotificationTypeIcon.tsx — 알림 종류 아이콘 단일 원천 (운영 #287)
//
// 왜 공용인가: 알림은 3개 표면에 나타난다 — 토스터 / 벨 드롭다운 / 전체 알림 페이지.
//   #287 이전 상태: 토스터만 아이콘이 있었고 그마저 이모지 6종이라 나머지 12종이 전부 'i' 로 뭉갰다.
//   실제 분포에서 가장 많은 종류가 mail(537건) 인데 그게 'i' 였다 — "뭐가 온 건지 모르겠다"(Irene).
//   드롭다운·전체 페이지에는 종류 아이콘이 **아예 없었다**.
//   → 여기 한 곳에서만 종류→그림을 정하고 세 표면이 같이 쓴다. 새 event_kind 가 생기면 여기만 고친다.
//
// 스타일: feather 계열 stroke 아이콘 (components/Dashboard/TodoList.tsx 의 인박스 아이콘과 같은 계열).
//   이모지를 쓰지 않는다 — UI_DESIGN_GUIDE §1.5 이모지/아이콘 금지 규칙.
//   색은 상속(currentColor) — 표면별 톤은 부모가 정한다.
import React from 'react';

// models/Notification.js 의 event_kind ENUM 과 1:1. 신규 종류 추가 시 양쪽 같이 갱신.
export type NotificationKind =
  | 'signature' | 'invoice' | 'tax_invoice' | 'task' | 'event' | 'invite'
  | 'message' | 'mention' | 'comment_mention' | 'share_expiry'
  | 'inquiry' | 'signup' | 'payment' | 'subscription' | 'trial' | 'feedback'
  | 'mail' | 'system';

type P = { size?: number };
const svg = (children: React.ReactNode, size: number) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

const IconChat = ({ size = 14 }: P) => svg(<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />, size);
const IconAt = ({ size = 14 }: P) => svg(<><circle cx="12" cy="12" r="4" /><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" /></>, size);
const IconMail = ({ size = 14 }: P) => svg(<><rect x="2" y="4" width="20" height="16" rx="2" /><polyline points="22,7 12,13 2,7" /></>, size);
const IconTask = ({ size = 14 }: P) => svg(<><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>, size);
const IconEvent = ({ size = 14 }: P) => svg(<><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>, size);
const IconPerson = ({ size = 14 }: P) => svg(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" /></>, size);
const IconBill = ({ size = 14 }: P) => svg(<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />, size);
const IconReceipt = ({ size = 14 }: P) => svg(<><path d="M14 2H6a2 2 0 0 0-2 2v16l3-2 3 2 3-2 3 2 3-2V8z" /><line x1="9" y1="10" x2="15" y2="10" /><line x1="9" y1="14" x2="15" y2="14" /></>, size);
const IconCard = ({ size = 14 }: P) => svg(<><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /><line x1="6" y1="15" x2="10" y2="15" /></>, size);
const IconRepeat = ({ size = 14 }: P) => svg(<><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></>, size);
const IconClock = ({ size = 14 }: P) => svg(<><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>, size);
const IconSign = ({ size = 14 }: P) => svg(<><path d="M12 19l7-7 3 3-7 7-3-3z" /><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" /><path d="M2 2l7.586 7.586" /><circle cx="11" cy="11" r="2" /></>, size);
const IconLinkExpiry = ({ size = 14 }: P) => svg(<><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>, size);
const IconHelp = ({ size = 14 }: P) => svg(<><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></>, size);
const IconMegaphone = ({ size = 14 }: P) => svg(<><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /></>, size);
const IconInfo = ({ size = 14 }: P) => svg(<><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></>, size);

/**
 * 알림 종류 아이콘. `kind` 는 Notification.event_kind.
 * 모르는 값이 와도 죽지 않고 정보 아이콘으로 떨어진다(ENUM 이 늘어난 뒤 프론트 배포 전 구간 대비).
 */
const NotificationTypeIcon: React.FC<{ kind?: string | null; size?: number }> = ({ kind, size = 14 }) => {
  switch (kind) {
    case 'message': return <IconChat size={size} />;
    case 'mention':
    case 'comment_mention': return <IconAt size={size} />;
    case 'mail': return <IconMail size={size} />;
    case 'task': return <IconTask size={size} />;
    case 'event': return <IconEvent size={size} />;
    case 'invite':
    case 'signup': return <IconPerson size={size} />;
    case 'invoice': return <IconBill size={size} />;
    case 'tax_invoice': return <IconReceipt size={size} />;
    case 'payment': return <IconCard size={size} />;
    case 'subscription': return <IconRepeat size={size} />;
    case 'trial': return <IconClock size={size} />;
    case 'signature': return <IconSign size={size} />;
    case 'share_expiry': return <IconLinkExpiry size={size} />;
    case 'inquiry': return <IconHelp size={size} />;
    case 'feedback': return <IconMegaphone size={size} />;
    default: return <IconInfo size={size} />;
  }
};

export default NotificationTypeIcon;
