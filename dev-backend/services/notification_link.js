// 알림 deep link 통합 helper (사이클 N+73 박제).
//
// 단일 source — backend notify() 와 frontend utils/notificationLink.ts 가 같은 매핑 mirror.
// notify() 호출 시 link 미전달이면 buildLink({ entity_type, entity_id, event_kind, business_id })
// 로 자동 생성. frontend 도 item.link 없으면 같은 매핑 fallback.
//
// 7 카테고리 + sub-type 통일 매트릭스:
//   message       → /talk?conv={conversation_id}     ★ link 필수 (entity_id=message_id 만으로는 conv 모름)
//   mention       → /talk?conv={conversation_id}     ★ link 필수
//   task          → /tasks?task={task_id}
//   comment_mention(task) → /tasks?task={task_id}
//   comment_mention(post) → /docs?post={post_id}
//   invoice       → /bills?invoice={invoice_id}
//   tax_invoice   → /bills?invoice={invoice_id}
//   signature     → /docs?post={post_id} (entity_type='post') or /signatures/received?sig={sig_id}
//   event         → /calendar?event={event_id}
//   invite        → /business/settings/members
//   inquiry / signup / payment / subscription / trial / feedback → /admin/* (platform_admin)
//
// 미일치 시 '/' 반환 (랜딩 fallback). 호출자가 entity_type 명시 누락이면 link 명시 권장.

const ENTITY_LINK = {
  conversation: (id) => `/talk?conv=${id}`,
  task: (id) => `/tasks?task=${id}`,
  post: (id) => `/docs?post=${id}`,
  file: (id) => `/files?file=${id}`,
  // SPA 라우트는 `/bills` — 옛 `/bill`(단수)은 존재한 적이 없어 catch-all 이 대시보드로
  //   튕겼다(청구서 알림 클릭 전건 사망). frontend utils/notificationLink.ts 와 쌍으로 유지.
  invoice: (id) => `/bills?invoice=${id}`,
  // ★ `/docs?sig=` 는 **읽는 곳이 0곳**이었다(잠복 죽은 링크 — 운영 생성 0건 실측).
  //   프론트 utils/notificationLink.ts 와 **같은 값**이어야 한다 — 두 벌이면 반드시 갈라진다.
  signature_request: (id) => `/signatures/received?sig=${id}`,
  calendar_event: (id) => `/calendar?event=${id}`,
  event: (id) => `/calendar?event=${id}`,
  kb_document: (id) => `/info?doc=${id}`,
  // Q sale — 고객의 영업 뷰. 고객 관리(/business/clients)가 아니라 여기로 보낸다(알림의 맥락이 영업이다).
  //   프론트 utils/notificationLink.ts 와 **같은 값**이어야 한다.
  client: (id) => `/sale/${id}`,
  client_interaction: (id) => `/sale/${id}`,
};

const EVENT_KIND_FALLBACK = {
  invite: () => `/business/settings/members`,
  inquiry: () => `/admin/inquiries`,
  signup: () => `/admin/users`,
  payment: () => `/admin/payments`,
  subscription: () => `/admin/subscriptions`,
  trial: () => `/admin/subscriptions`,
  feedback: () => `/admin/feedback`,
};

function buildLink({ entity_type, entity_id, event_kind } = {}) {
  // entity_type + entity_id 우선
  if (entity_type && entity_id && ENTITY_LINK[entity_type]) {
    return ENTITY_LINK[entity_type](entity_id);
  }
  // event_kind fallback (entity 없는 platform-wide 알림용)
  if (event_kind && EVENT_KIND_FALLBACK[event_kind]) {
    return EVENT_KIND_FALLBACK[event_kind]();
  }
  return '/';
}

// N+74-D — backend notify() 호출자가 절대 URL ('https://planq.kr/talk?conv=3') 을 link 인자로
// 전달하는 옛 코드 보호. frontend react-router navigate() 가 외부 link 처리되어 클릭 시 작동 안 됨.
// 같은 도메인이면 path 부분만 추출. 옛 호출자가 그대로 'https://planq.kr/...' 넘겨도 OK.
const SAME_DOMAINS = new Set(['planq.kr', 'www.planq.kr', 'dev.planq.kr', 'localhost', '127.0.0.1']);
function normalizeLink(link) {
  if (typeof link !== 'string' || !link) return null;
  if (link.startsWith('/') && link !== '/') return link;
  if (link.startsWith('http://') || link.startsWith('https://')) {
    try {
      const u = new URL(link);
      if (SAME_DOMAINS.has(u.hostname)) {
        const path = u.pathname + u.search + u.hash;
        return path && path !== '/' ? path : null;
      }
    } catch { /* invalid */ }
  }
  return null;
}

// ── 밖으로 나가는 링크(푸시·메일)에 워크스페이스를 싣는다 (2026-10-13) ──
//   Irene: *"알림을 누르면 다른 워크스페이스로 갈 경우 채팅방 제대로 안열리고 리스트로 열려 …
//           모든 경로가 워크스페이스 다른 경우 처음만 딱 다르게 제대로 디렉션 해줘."*
//   푸시·메일은 **모든 워크스페이스**의 알림이 한 기기·한 메일함에 온다(인앱 종은 현재 워크스페이스만).
//   링크가 경로뿐이면 앱은 지금 워크스페이스 안에서 그 id 를 찾다가 목록으로 떨어진다.
//   → `?ws=<business_id>` 를 붙이고, 화면 루트(App.tsx ModeGate · NativeBridge.deepLinkNav)가
//     **처음 한 번** 그 워크스페이스로 전환한 뒤 ws 를 뗀 주소로 연다(utils/workspaceLink.ts).
//   인앱 행(Notification.link)에는 싣지 않는다 — 그 목록은 이미 현재 워크스페이스 것뿐이다.
//   ★ 신뢰하지 않는다 — 화면은 ws 가 «내가 멤버인 워크스페이스» 일 때만 전환하고, 아니면 떼고 그대로 연다.
function withWorkspace(link, businessId) {
  const bid = Number(businessId);
  if (!link || typeof link !== 'string' || !Number.isInteger(bid) || bid <= 0) return link;
  try {
    const isPath = link.startsWith('/') && !link.startsWith('//');
    const u = new URL(link, 'https://planq.kr');
    if (!isPath && !SAME_DOMAINS.has(u.hostname)) return link;   // 남의 도메인 링크는 건드리지 않는다
    if (u.pathname === '/' || u.pathname.startsWith('/admin') || u.pathname.startsWith('/api/')) return link;
    u.searchParams.set('ws', String(bid));
    return isPath ? (u.pathname + u.search + u.hash) : u.href;
  } catch { return link; }
}

module.exports = { buildLink, normalizeLink, withWorkspace, ENTITY_LINK, EVENT_KIND_FALLBACK };
