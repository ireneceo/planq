// services/actions/client_actions.js — «문의 고객으로 저장» 의 행동 계층 (2026-11-27 · Fable 설계 D · docs/QSALE_CLIENT_TOUCHPOINT_DESIGN.md)
//
// 왜 생겼나: 외부 AI(Claude·ChatGPT)가 Q sale 에 고객·문의를 추가해야 한다(create_client_inquiry).
//   등록 규칙(중복 판정 → 문의 한도 → 행 만들기 → 단계 → 출처 연결 → 지난 메일 연결 → 첫 상담 기록 → 감사·신호)은
//   `routes/sale_save.js POST save-as-client` 안에만 있었다. AI 도구가 모델을 직접 쓰면 그중 하나가 조용히 빠진다
//   → 화면과 AI 가 **같은 함수**를 부른다. 값·순서·감사 action 이름은 옛 라우트 그대로(동작 무변경).
//   라우트에는 `from` 별 seed 만들기·이미 붙은 출처의 조기 반환만 남는다. /managed·/invite 는 옮기지 않았다.
const { Client } = require('../../models');

/**
 * @param {object} p
 *   businessId, userId(행위자 = 첫 담당), from('guest_link'|'email_thread'|'inquiry'|'manual'),
 *   seed { display_name, company_name, phone, email, sales_source, touchAt },
 *   link?, thread?, inquiry?(WorkspaceInquiry 행), interaction?({kind,title,body,occurred_at,direction,…}),
 *   verifiedSource?(createInteraction 에 넘길 서버 판정 출처), req?(없으면 전역 io), channel?, via?(감사 꼬리 — 'agent:<provider>')
 * @returns {Promise<{ok:true, client, linkedExisting:boolean, interactionError:string|null, interactionRow:object|null}
 *                 | {ok:false, code:'quota', quota:object, can:object}>}
 */
async function saveInquiryClient(p) {
  const { businessId, userId, from, seed, link = null, thread = null, inquiry = null, req = null } = p;
  const { findExistingByContact, touchClient, broadcast } = require('../saleCommon');
  const { setStage } = require('../salesStage');
  const planEngine = require('../plan');
  const { createInteraction } = require('../saleInteraction');
  const { createAuditLog } = require('../auditService');

  let client = await findExistingByContact(businessId, seed);
  let linkedExisting = !!client;
  if (!client) {
    const planCan = await planEngine.can(businessId, 'add_prospect');
    if (!planCan.ok) return { ok: false, code: 'quota', can: planCan, quota: planEngine.buildQuotaError(planCan, businessId) };
    client = await Client.create({
      business_id: businessId,
      display_name: seed.display_name,
      company_name: seed.company_name,
      phone: seed.phone,
      invite_email: seed.email,
      kind: 'customer',
      status: 'prospect',
      sales_source: seed.sales_source,
      // 저장한 사람이 첫 담당이다 — 누구의 것도 아닌 문의는 조용히 쌓인다
      assigned_member_id: userId,
      last_touch_at: seed.touchAt || null,
    });
    // ★ reason 은 **코드**로 남기고 화면이 번역한다(qsale `stageReason.<code>` — 2026-10-08 0-I).
    const FROM_REASON = { email_thread: 'mail_inquiry', guest_link: 'guest_inquiry', manual: 'manual_add', inquiry: 'web_inquiry' };
    await setStage(client, 'inquiry', { origin: 'manual', by: userId, reason: FROM_REASON[from] || 'client_added' });
    // 한도 숫자는 30초 캐시라 방금 만든 문의가 화면에 안 늘어 보인다 — 만든 쪽이 비운다
    planEngine.invalidateBusinessCache(businessId);
    linkedExisting = false;
  }

  // 부수효과 — 비어 있는 연결만 채운다(사람이 이미 건 연결을 덮지 않는다). 연결 코드는 services/clientLinkSource 한 벌.
  const resolvedSource = link ? { kind: 'guest_link', link }
    : thread ? { kind: 'email_thread', thread, senderEmail: null }
      : null;
  await require('../clientLinkSource').attachSourceToClient({
    businessId, actorUserId: userId, client, resolved: resolvedSource, req, email: seed.email,
  });
  // 그 주소의 지난 메일을 이 고객에 붙인다(Fable 설계 B) — 붙인 수는 응답에 싣지 않는다(감사에만)
  await require('../mailLink').afterClientAddressesChanged(businessId, client.id, { actorUserId: userId, req, reason: 'save_as_client' });
  if (seed.touchAt) await touchClient(client, seed.touchAt);

  // 첫 상담 기록 — ★ 실패를 삼키지 않는다(기록만 실패하고 고객은 생긴 상태 — 응답에 담아 화면/AI 가 말하게 한다).
  let interactionError = null;
  let interactionRow = null;
  if (inquiry) {
    if (!inquiry.client_id) {
      const made = await createInteraction({
        businessId, client, userId, req,
        body: { kind: 'memo', title: inquiry.service_name || null, body: inquiry.message, occurred_at: inquiry.created_at },
      });
      if (made.error) interactionError = made.error;
    }
    await inquiry.update({ client_id: client.id, status: 'handled', handled_by: userId, handled_at: new Date() });
    if (req && req.app) require('../workspaceInquiry').emitSignal(req.app, businessId, inquiry.id);
  }
  const it = p.interaction;
  if (it && (it.body || it.title)) {
    const made = await createInteraction({
      businessId, client, body: it, userId, req, channel: p.channel, verifiedSource: p.verifiedSource || null,
    });
    if (made.error) interactionError = made.error;
    else interactionRow = made.row || null;
  }

  createAuditLog({
    userId, businessId,
    action: linkedExisting ? 'client.link_from_sale' : 'client.save_from_guest',
    targetType: 'client', targetId: client.id,
    newValue: {
      from, guest_link_id: link?.id || null, email_thread_id: thread?.id || null, inquiry_id: inquiry?.id || null,
      linked_existing: linkedExisting, ...(p.via ? { via: p.via } : {}),
    },
  });
  broadcast(req, businessId, linkedExisting ? 'client:updated' : 'client:new', { id: client.id, business_id: businessId });
  return { ok: true, client, linkedExisting, interactionError, interactionRow };
}

module.exports = { saveInquiryClient };
