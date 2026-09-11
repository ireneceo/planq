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
  // SPA 라우트는 `/bills` — 옛 `/bill`(단수)은 존재한 적이 없어 catch-all 이 대시보드로
  //   튕겼다. 즉 청구서 알림 클릭이 전부 죽어 있었다. 백엔드 미러도 같이 교정.
  invoice: (id) => `/bills?invoice=${id}`,
  // ★ `?sig=` 는 **읽는 곳이 0곳**이었다(잠복 죽은 링크 — 운영·dev 실측 생성 0건).
  //   소비자를 새로 만드는 대신, 실제로 있는 화면으로 보낸다. 받은 서명 목록에서 찾을 수 있다.
  //   (id 는 남겨 둔다 — 나중에 그 화면이 하이라이트에 쓸 수 있게)
  signature_request: (id) => `/signatures/received?sig=${id}`,
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

/**
 * 알림을 **눌러서 열 때** 쓰는 경로 — 대화 링크에 일회용 표식(`jump`)을 붙인다.
 *
 * 2026-09-11 Irene: "채팅 알림 있어서 누르면 데스크탑 앱에서도 새로 온 거 위에 전에 이미 본 기준으로 위치가 잡혀."
 *   탭 모드는 keep-alive 라 그 대화가 **이미 열려 있으면** 같은 주소로 가는 것이라 아무 일도 일어나지 않는다
 *   (QTalkPage 의 conv 동기화도, ChatPanel 의 진입 바닥 고정도 "대화가 바뀔 때" 만 돈다) → 전에 올려 둔 자리에 선다.
 *   표식이 주소를 매번 다르게 만들어 QTalkPage 가 "알림으로 들어왔다" 를 알고 최신 메시지로 내린다. 받은 쪽이 지운다.
 * 대화가 아닌 링크는 그대로 돌려준다.
 */
export function withJumpToLatest(path: string): string {
  if (!/^\/(talk|chat)(\/\d+|\?|$)/.test(path)) return path;
  const [base, query = ''] = path.split('?');
  const sp = new URLSearchParams(query);
  sp.set('jump', String(Date.now()));
  return `${base}?${sp.toString()}`;
}

export function notificationRowToToastLink(row: NotificationFullRow): string {
  return resolveNotificationLink({
    link: row.link,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    event_kind: row.event_kind,
  });
}
