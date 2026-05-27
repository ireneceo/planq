// 알림 deep link 통합 helper — backend services/notification_link.js 의 mirror.
// 사이클 N+73 박제.
//
// 단일 source of truth — Notification.link 가 null 이거나 정확하지 않을 때
// entity_type + entity_id + event_kind 로 안전한 path 생성.
//
// NotificationToaster + NotificationDropdown + NotificationsPage 모두 같은 helper 사용.
// backend notify() 가 link 미전달 시에도 같은 매핑으로 자동 생성 → DB row 의 link 와 frontend resolve 결과가 항상 일치.

export interface NotificationLinkContext {
  link?: string | null;
  entity_type?: string | null;
  entity_id?: number | string | null;
  event_kind?: string | null;
}

const ENTITY_LINK: Record<string, (id: string | number) => string> = {
  conversation: (id) => `/talk?conv=${id}`,
  task: (id) => `/tasks?task=${id}`,
  post: (id) => `/docs?post=${id}`,
  file: (id) => `/files?file=${id}`,
  invoice: (id) => `/bill?invoice=${id}`,
  signature_request: (id) => `/docs?sig=${id}`,
  calendar_event: (id) => `/calendar?event=${id}`,
  event: (id) => `/calendar?event=${id}`,
  kb_document: (id) => `/info?doc=${id}`,
};

const EVENT_KIND_FALLBACK: Record<string, () => string> = {
  invite: () => `/business/settings/members`,
  inquiry: () => `/admin/inquiries`,
  signup: () => `/admin/users`,
  payment: () => `/admin/payments`,
  subscription: () => `/admin/plans`,
  trial: () => `/admin/plans`,
  feedback: () => `/admin/feedback`,
};

// N+74-D fix — backend 옛 notify 호출자가 'https://planq.kr/talk?conv=3' 같은 절대 URL 을
// link 에 저장한 경우 react-router navigate() 가 외부 link 처리 → 클릭 시 작동 안 됨.
// 같은 도메인 (planq.kr / dev.planq.kr / localhost) 이면 path 부분만 추출.
function normalizeLink(link: string): string | null {
  if (typeof link !== 'string' || !link) return null;
  // 이미 path 형식 + 의미 있는 경로
  if (link.startsWith('/') && link !== '/') return link;
  // 절대 URL — 같은 도메인이면 path 추출
  if (link.startsWith('http://') || link.startsWith('https://')) {
    try {
      const u = new URL(link);
      const sameDomain = ['planq.kr', 'www.planq.kr', 'dev.planq.kr', 'localhost', '127.0.0.1'].includes(u.hostname);
      if (sameDomain) {
        const path = u.pathname + u.search + u.hash;
        return path && path !== '/' ? path : null;
      }
    } catch { /* invalid URL */ }
  }
  return null;
}

export function resolveNotificationLink(ctx: NotificationLinkContext): string {
  // 1) DB Notification.link 가 유효한 path 또는 같은 도메인 URL 이면 path 로 정규화
  if (ctx.link) {
    const normalized = normalizeLink(ctx.link);
    if (normalized) return normalized;
  }
  // 2) entity_type + entity_id 매핑
  if (ctx.entity_type && ctx.entity_id && ENTITY_LINK[ctx.entity_type]) {
    return ENTITY_LINK[ctx.entity_type](ctx.entity_id);
  }
  // 3) event_kind fallback (platform-wide 알림)
  if (ctx.event_kind && EVENT_KIND_FALLBACK[ctx.event_kind]) {
    return EVENT_KIND_FALLBACK[ctx.event_kind]();
  }
  // 4) 미일치 — /notifications 페이지로 (랜딩 X)
  return '/notifications';
}

// notification:new socket payload 에서 받은 full row 를 toast 객체로 변환.
// Toaster 가 옛 raw event (message:new, task:new) 와 신규 notification:new 둘 다 처리하려면
// 같은 dedup key (notification_id) 필요. notification_id 있으면 우선.
export interface NotificationFullRow {
  id: number;
  event_kind: string;
  title: string;
  body?: string | null;
  link?: string | null;
  entity_type?: string | null;
  entity_id?: number | null;
  business_id?: number | null;
}

export function notificationRowToToastLink(row: NotificationFullRow): string {
  return resolveNotificationLink({
    link: row.link,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    event_kind: row.event_kind,
  });
}
