// routes/sale_save.js — "고객으로 저장" (게스트 채팅·미매칭 메일·직접 등록). docs/Q_SALE_DESIGN.md §4.3
//   이메일·전화 **정확 일치** 고객이 있으면 새로 만들지 않고 그 고객에 연결한다(LLM 0).
//   /api/sale 아래 같은 접두어로 마운트된다.
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { Client, User, GuestLink, Conversation, EmailThread, EmailMessage, Message } = require('../models');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { perUserDaily } = require('../middleware/costGuard');
// 첫 상담 기록은 **상담 원장과 같은 문**으로 만든다(감사·실시간·last_touch 가 한 곳)
const { createInteraction } = require('../services/saleInteraction');
const { extractInquiry } = require('../services/saleExtract');
const { createAuditLog } = require('../services/auditService');
const { setStage } = require('../services/salesStage');
const planEngine = require('../services/plan');
const {
  writeChain, broadcast, trimOrNull, normEmail, normPhoneDigits, EMAIL_RE, SOURCES,
  CLIENT_INCLUDE, loadClientWithIncludes, touchClient, serializeClients,
} = require('../services/saleCommon');

async function findExistingByContact(businessId, { email, phone }) {
  if (email) {
    const { matchClientByAddresses } = require('../services/mailLink');
    const id = await matchClientByAddresses(businessId, [email]);
    if (id) return Client.findOne({ where: { id, business_id: businessId } });
    const byUser = await Client.findOne({
      where: { business_id: businessId },
      include: [{ model: User, as: 'user', attributes: ['id'], where: { email }, required: true }],
    });
    if (byUser) return byUser;
  }
  const digits = normPhoneDigits(phone);
  if (digits.length >= 8) {
    const rows = await Client.findAll({
      where: { business_id: businessId, phone: { [Op.ne]: null } },
      attributes: ['id', 'phone'], limit: 2000,
    });
    const hit = rows.find((r) => normPhoneDigits(r.phone) === digits);
    if (hit) return Client.findOne({ where: { id: hit.id, business_id: businessId } });
  }
  return null;
}

/** 게스트 표시명의 원천은 messages.meta.guest.name 박제다 — 서버가 새로 짓지 않는다. */
async function guestDisplayName(link) {
  if (link.contact_name) return link.contact_name;
  const msg = await Message.findOne({
    where: { conversation_id: link.conversation_id, sender_id: link.guest_user_id, is_deleted: false },
    order: [['createdAt', 'DESC']],
    attributes: ['meta'],
  });
  const name = msg?.meta?.guest?.name;
  return name ? String(name).slice(0, 100) : null;
}

async function respondExisting(res, businessId, clientId) {
  const existing = await loadClientWithIncludes(businessId, clientId);
  if (!existing) return null;
  const [out] = await serializeClients(businessId, [existing]);
  return successResponse(res, { client: out, linked_existing: true });
}

// ── 붙여넣은 글에서 문의 정보 뽑기 (AI) ─────────────────────────────────────
//   Irene 2026-09-12: "문의 추가에 AI 입력". **저장하지 않는다** — 값을 폼에 채우고 사람이 확인해 저장한다.
//   비용: 여기 rate-limit + 서비스 안 checkUsageLimit + capText (CLAUDE.md 운영 1번 3종 세트).
const extractLimit = perUserDaily('sale-extract', {
  perMin: 5, perDay: 50,
  message: 'AI 추출이 너무 잦습니다. 잠시 후 다시 시도하세요.',
});
router.post('/:businessId/inquiry/extract', ...writeChain, ...extractLimit, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const out = await extractInquiry(businessId, req.body?.text, { userId: req.user.id });
    if (!out.ok) {
      // 실패도 **이유를 말한다** — 조용한 무반응은 "AI 가 안 된다" 로만 읽힌다
      const http = out.reason === 'usage_limit' ? 429 : out.reason === 'empty' ? 400 : 503;
      return errorResponse(res, out.reason, http);
    }
    return successResponse(res, out.data);
  } catch (err) { next(err); }
});

// ── [문의 아님] — 사람이 분류를 정정한다 ───────────────────────────────────
//   Irene 2026-09-12: "메일이 문의가 아닌데 가져오고 있어. 이런 걸 왜 가져와?" (은행 거래 알림)
//   기계가 못 가르는 것(브랜드 주소로 오는 알림·명세서)은 **한 번 눌러 끝내는 길**이 답이다.
//   패턴을 계속 늘리면 진짜 문의를 떨어뜨린다(실측: 과한 기준이 상담 903건을 10건으로 잘랐다).
//   ★ 정정은 메일 분류 자체에 남긴다(`email_threads.triage='automated'`) — 그래야 Q mail 에서도
//     같은 판단이 보이고, 상담 목록은 그 값을 읽어 자연히 내려간다(목록 전용 플래그를 새로 만들지 않는다).
router.post('/:businessId/inbox/dismiss', ...writeChain, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const kind = String(req.body?.kind || '');
    const id = Number(req.body?.id || 0);
    if (kind !== 'email_thread' || !id) return errorResponse(res, 'unsupported_kind', 400);

    const { accessibleAccountIds } = require('../services/clientTimeline');
    const acctIds = await accessibleAccountIds(businessId, req.user.id);
    const thread = await EmailThread.findOne({
      where: { id, business_id: businessId, account_id: { [Op.in]: acctIds.length ? acctIds : [0] } },
    });
    if (!thread) return errorResponse(res, 'thread_not_found', 404);

    const before = thread.triage;
    await thread.update({ triage: 'automated', reply_needed: false });
    createAuditLog({
      userId: req.user.id, businessId, action: 'mail.triage_correct',
      targetType: 'email_thread', targetId: thread.id,
      oldValue: { triage: before }, newValue: { triage: 'automated', origin: 'sale_inbox_dismiss' },
    });
    broadcast(req, businessId, 'inbox:refresh', { business_id: businessId });
    return successResponse(res, { id: thread.id, triage: 'automated' }, 'dismissed');
  } catch (err) { next(err); }
});

// ─── 보관함에서 되돌리기 ─────────────────────────────────────────────
//   Irene 2026-09-13: *"문의아님 분류한거 다시 되돌리고 싶으면 어떻게 해?"*
//   [문의 아님]은 사람의 판단이고 사람은 틀린다. 되돌릴 길이 없으면 그건 삭제나 마찬가지다.
//   ★ 되돌림도 **기록으로 남긴다**(origin: sale_inbox_restore). 그래야 보관함 목록에서 빠진다 —
//     보관함은 "마지막 판단이 dismiss 인 것" 이므로, 지운 흔적이 아니라 **새 기록**으로 뒤집는다.
router.post('/:businessId/inbox/restore', ...writeChain, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const kind = String(req.body?.kind || '');
    const id = Number(req.body?.id || 0);
    if (kind !== 'email_thread' || !id) return errorResponse(res, 'unsupported_kind', 400);

    const { accessibleAccountIds } = require('../services/clientTimeline');
    const acctIds = await accessibleAccountIds(businessId, req.user.id);
    const thread = await EmailThread.findOne({
      where: { id, business_id: businessId, account_id: { [Op.in]: acctIds.length ? acctIds : [0] } },
    });
    if (!thread) return errorResponse(res, 'thread_not_found', 404);

    const before = thread.triage;
    await thread.update({ triage: 'human' });
    createAuditLog({
      userId: req.user.id, businessId, action: 'mail.triage_correct',
      targetType: 'email_thread', targetId: thread.id,
      oldValue: { triage: before }, newValue: { triage: 'human', origin: 'sale_inbox_restore' },
    });
    broadcast(req, businessId, 'inbox:refresh', { business_id: businessId });
    return successResponse(res, { id: thread.id, triage: 'human' }, 'restored');
  } catch (err) { next(err); }
});

router.post('/:businessId/save-as-client', ...writeChain, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const body = req.body || {};
    const from = String(body.from || '');
    let seed;          // { display_name, company_name, phone, email, sales_source, touchAt }
    let link = null;
    let thread = null;

    if (from === 'guest_link') {
      link = await GuestLink.findOne({ where: { id: Number(body.guest_link_id), business_id: businessId } });
      if (!link) return errorResponse(res, 'guest_link_not_found', 404);
      const parent = link.kind === 'personal' && link.parent_link_id
        ? await GuestLink.findOne({ where: { id: link.parent_link_id, business_id: businessId } })
        : null;
      const alreadyId = link.client_id || parent?.client_id || null;
      if (alreadyId) {
        const done = await respondExisting(res, businessId, alreadyId);
        if (done) return done;
      }
      seed = {
        display_name: await guestDisplayName(link),
        company_name: null,
        phone: null,
        email: normEmail(link.contact_email || link.requested_email),
        sales_source: 'guest_link',
        touchAt: link.last_used_at || link.createdAt,
      };
    } else if (from === 'email_thread') {
      const { accessibleAccountIds } = require('../services/clientTimeline');
      const acctIds = await accessibleAccountIds(businessId, req.user.id);
      thread = await EmailThread.findOne({
        where: { id: Number(body.email_thread_id), business_id: businessId, account_id: { [Op.in]: acctIds.length ? acctIds : [0] } },
      });
      if (!thread) return errorResponse(res, 'thread_not_found', 404);
      if (thread.client_id) {
        const done = await respondExisting(res, businessId, thread.client_id);
        if (done) return done;
      }
      const first = await EmailMessage.findOne({
        where: { business_id: businessId, thread_id: thread.id, direction: 'inbound' },
        order: [['sent_at', 'ASC']],
        attributes: ['from_email', 'from_name'],
      });
      if (!first || !first.from_email) return errorResponse(res, 'no_inbound_sender', 400);
      seed = {
        display_name: trimOrNull(first.from_name, 100) || normEmail(first.from_email),
        company_name: null,
        phone: null,
        email: normEmail(first.from_email),
        sales_source: 'email',
        touchAt: thread.last_message_at,
      };
    } else if (from === 'manual') {
      seed = {
        display_name: trimOrNull(body.display_name, 100),
        company_name: trimOrNull(body.company_name, 200),
        phone: trimOrNull(body.phone, 40),
        email: normEmail(body.email),
        sales_source: SOURCES.includes(body.sales_source) ? body.sales_source : 'manual',
        touchAt: null,
      };
      if (!seed.display_name && !seed.company_name) return errorResponse(res, 'name_required', 400);
      if (seed.email && !EMAIL_RE.test(seed.email)) return errorResponse(res, 'invalid_email', 400);
    } else {
      return errorResponse(res, 'invalid_from', 400);
    }

    let client = await findExistingByContact(businessId, seed);
    let linkedExisting = !!client;
    if (!client) {
      const planCan = await planEngine.can(businessId, 'add_prospect');
      if (!planCan.ok) return res.status(422).json(planEngine.buildQuotaError(planCan, businessId));
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
        assigned_member_id: req.user.id,
        last_touch_at: seed.touchAt || null,
      });
      // ★ 2026-09-13 (Irene: "단계 / 영업 외 → 문의 · saved_from:email_thread … 이해 안가게 표시하는 건
      //   전혀 없게 할 수 있어?") — `reason` 은 **화면에 나가는 값**이다. 개발자용 표식을 넣으면
      //   사용자가 그대로 읽는다. 어디서 왔는지는 사람 말로 남긴다.
      //   (뜻은 잃지 않는다 — 출처 구분이 필요하면 origin/sourceRef 로 남기지 reason 에 코드를 쓰지 않는다.)
      const FROM_LABEL = { email_thread: '메일 문의', guest_link: '게스트 문의', manual: '직접 등록' };
      await setStage(client, 'inquiry', {
        origin: 'manual', by: req.user.id,
        reason: FROM_LABEL[from] || '고객으로 등록',
      });
      // 한도 숫자는 30초 캐시라 방금 만든 문의가 화면에 안 늘어 보인다 — 만든 쪽이 비운다(files.js 와 같은 처방)
      planEngine.invalidateBusinessCache(businessId);
      linkedExisting = false;
    }

    // 부수효과 — 비어 있는 연결만 채운다(사람이 이미 건 연결을 덮지 않는다)
    if (link) {
      if (!link.client_id) await link.update({ client_id: client.id });
      if (link.kind === 'personal' && link.parent_link_id) {
        await GuestLink.update({ client_id: client.id },
          { where: { id: link.parent_link_id, business_id: businessId, client_id: null } });
      }
      await Conversation.update({ client_id: client.id },
        { where: { id: link.conversation_id, business_id: businessId, client_id: null } });
    }
    if (thread) {
      if (!thread.client_id) await thread.update({ client_id: client.id });
      // 같은 발신 주소의 미연결 스레드도 붙인다 — 과거 메일이 타임라인에 즉시 보이도록
      if (seed.email) {
        const msgs = await EmailMessage.findAll({
          where: { business_id: businessId, direction: 'inbound', from_email: seed.email },
          attributes: ['thread_id'], group: ['thread_id'], limit: 500, raw: true,
        });
        const ids = msgs.map((m) => m.thread_id).filter((id) => id !== thread.id);
        if (ids.length) {
          await EmailThread.update({ client_id: client.id },
            { where: { id: { [Op.in]: ids }, business_id: businessId, client_id: null } });
        }
      }
    }
    if (seed.touchAt) await touchClient(client, seed.touchAt);

    // 첫 상담 기록 — 전화·방문 내용은 문의를 **등록하는 그 순간**에만 손에 있다.
    //   여기서 안 받으면 사용자는 저장 후 상세로 들어가 한 번 더 쓴다(그리고 대개 안 쓴다).
    //   ★ 실패를 삼키지 않는다 — 응답에 담아 화면이 말하게 한다(기록만 실패하고 고객은 생긴 상태).
    let interactionError = null;
    if (body.interaction && (body.interaction.body || body.interaction.title)) {
      const made = await createInteraction({
        businessId, client, body: body.interaction, userId: req.user.id, req,
      });
      if (made.error) interactionError = made.error;
    }

    createAuditLog({
      userId: req.user.id, businessId,
      action: linkedExisting ? 'client.link_from_sale' : 'client.save_from_guest',
      targetType: 'client', targetId: client.id,
      newValue: { from, guest_link_id: link?.id || null, email_thread_id: thread?.id || null, linked_existing: linkedExisting },
    });
    broadcast(req, businessId, linkedExisting ? 'client:updated' : 'client:new', { id: client.id, business_id: businessId });

    const fresh = await Client.findOne({ where: { id: client.id, business_id: businessId }, include: CLIENT_INCLUDE });
    const [out] = await serializeClients(businessId, [fresh]);
    return successResponse(res, { client: out, linked_existing: linkedExisting, interaction_error: interactionError },
      linkedExisting ? 'linked' : 'created', linkedExisting ? 200 : 201);
  } catch (err) { next(err); }
});

module.exports = router;
