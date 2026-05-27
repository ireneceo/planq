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
//   invoice       → /bill?invoice={invoice_id}
//   tax_invoice   → /bill?invoice={invoice_id}
//   signature     → /docs?post={post_id} (entity_type='post') or /docs?sig={sig_id} (entity_type='signature_request')
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
  invoice: (id) => `/bill?invoice=${id}`,
  signature_request: (id) => `/docs?sig=${id}`,
  calendar_event: (id) => `/calendar?event=${id}`,
  event: (id) => `/calendar?event=${id}`,
  kb_document: (id) => `/info?doc=${id}`,
};

const EVENT_KIND_FALLBACK = {
  invite: () => `/business/settings/members`,
  inquiry: () => `/admin/inquiries`,
  signup: () => `/admin/users`,
  payment: () => `/admin/payments`,
  subscription: () => `/admin/plans`,
  trial: () => `/admin/plans`,
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

module.exports = { buildLink, ENTITY_LINK, EVENT_KIND_FALLBACK };
