// routes/member_cards.js — 같은 워크스페이스 동료의 «기본 명함» 보기. 설계 docs/NAME_CARD_V2_DESIGN.md 결정 3 (Fable 2026-10-22)
//
//   GET /api/businesses/:businessId/members/:userId/card  (+ /photo · /vcf)
//   ★ 보는 사람 = 그 워크스페이스 멤버(checkBusinessAccess = memberOnly — 고객 403). 대상이 활성 멤버가 아니거나 기본 명함이 없으면 404.
//   ★ 공개 스위치와 무관하게 보인다(기본 지정 = «이 워크스페이스에 건다» 는 명시 행위 · /members 가 이미 같은 연락처를 준다).
//     단 이름이 비면 안 보인다. 익명 링크(url)는 공개 판정(closedReason)을 통과할 때만 싣는다 — 토큰은 그 url 로만.
//   ★ 응답 키 = 공개 화이트리스트(cardPublicView) + brands. id·user_id·label·토큰 칸 없음.
//   ★ /api/businesses 접두어를 businesses.js 와 나눈다 — «/:businessId/members/:userId/card…» 꼬리만(server.js 에서 앞에 붙는다).
//   POST /api/businesses/:businessId/name-card-messages — 대화에 명함 카드 보내기(v3 결정 4, docs/NAME_CARD_V3_STRATEGY.md 9절).
//     보낼 수 있는 것 = 내 명함 ∨ 이 워크스페이스 멤버의 기본 명함 — **공개 링크가 열린 것만**(보내는 순간 같은 판정으로 다시 본다).
//     카드에는 공개 주소와 요약만 싣는다(사진·vCard 바이트 없음). 주인이 링크를 끄면 그 주소는 404 — 의도.
const express = require('express');
const router = express.Router();
const { BusinessMember, NameCard, User } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const nc = require('../services/nameCard');

const APP_URL = process.env.APP_URL || 'https://dev.planq.kr';

async function memberCard(req) {
  const bizId = Number(req.params.businessId);
  const uid = Number(req.params.userId) || 0;
  const m = await BusinessMember.findOne({ where: { business_id: bizId, user_id: uid, removed_at: null, role: ['owner', 'admin', 'member'] }, attributes: ['default_card_id'] });
  if (!m || !m.default_card_id) return null;
  const card = await NameCard.findOne({ where: { id: m.default_card_id, user_id: uid } });
  if (!card || !card.name || !String(card.name).trim()) return null;
  return card;
}

router.get('/:businessId/members/:userId/card', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const card = await memberCard(req);
    if (!card) return errorResponse(res, 'not_found', 404);
    const owner = await User.findByPk(card.user_id, { attributes: nc.OWNER_ATTRS });
    res.set('Cache-Control', 'no-store');
    return successResponse(res, {
      card: await nc.cardPublicViewWithBrands(card),
      url: nc.closedReason(card, owner) ? null : `${APP_URL}/c/${card.public_token}`,
    });
  } catch (e) { return next(e); }
});

router.get('/:businessId/members/:userId/card/photo', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const card = await memberCard(req);
    const buf = card && card.has_photo ? nc.readIfExists(nc.cardPhotoPath(card.id)) : null;
    if (!buf) return errorResponse(res, 'not_found', 404);
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
    return res.send(buf);
  } catch (e) { return next(e); }
});

router.get('/:businessId/members/:userId/card/vcf', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const card = await memberCard(req);
    if (!card) return errorResponse(res, 'not_found', 404);
    const owner = await User.findByPk(card.user_id, { attributes: nc.OWNER_ATTRS });
    const view = await nc.cardPublicViewWithBrands(card);
    const photo = card.has_photo ? nc.readIfExists(nc.cardPhotoPath(card.id)) : null;
    res.set({ 'Content-Type': 'text/vcard; charset=utf-8', 'Content-Disposition': nc.vcardFilename(view), 'Cache-Control': 'no-store' });
    return res.send(nc.toVcard(view, { photo, url: nc.closedReason(card, owner) ? null : `${APP_URL}/c/${card.public_token}` }));
  } catch (e) { return next(e); }
});

// 보낼 수 있는 명함 목록 — 내 명함(링크 열린 것) + 이 워크스페이스 멤버의 기본 명함(링크 열린 것). 대화 [명함 보내기] 고르기 창이 읽는다.
//   응답에 토큰·주소는 싣지 않는다(보낼 때 서버가 다시 판정해 카드에 싣는다).
router.get('/:businessId/name-card-options', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const bizId = Number(req.params.businessId);
    if (!['owner', 'admin', 'member'].includes(req.businessRole)) return errorResponse(res, 'forbidden', 403);
    // 내 명함은 계정당 20장 상한(services/nameCard) · 동료는 멤버 수만큼 — 둘 다 limit 을 건다(목록 상한 규칙)
    const mineRows = await NameCard.findAll({ where: { user_id: req.user.id }, order: [['sort_order', 'ASC'], ['id', 'ASC']], limit: 50 });
    const me = await User.findByPk(req.user.id, { attributes: nc.OWNER_ATTRS });
    const mine = mineRows.filter((c) => !nc.closedReason(c, me)).map((c) => ({ id: c.id, label: c.label, name: c.name, job_title: c.job_title || null }));
    const members = await BusinessMember.findAll({
      where: { business_id: bizId, removed_at: null, role: ['owner', 'admin', 'member'], default_card_id: { [require('sequelize').Op.ne]: null } },
      attributes: ['user_id', 'default_card_id'], limit: 2000,
    });
    const others = members.filter((m) => m.user_id !== req.user.id);
    const cards = others.length ? await NameCard.findAll({ where: { id: others.map((m) => m.default_card_id) }, limit: 2000 }) : [];
    const owners = cards.length ? await User.findAll({ where: { id: cards.map((c) => c.user_id) }, attributes: nc.OWNER_ATTRS, limit: 2000 }) : [];
    const ownerById = new Map(owners.map((u) => [u.id, u]));
    const colleagues = [];
    for (const m of others) {
      const card = cards.find((c) => c.id === m.default_card_id && c.user_id === m.user_id);
      if (!card || nc.closedReason(card, ownerById.get(card.user_id) || null)) continue;
      colleagues.push({ user_id: m.user_id, name: card.name, job_title: card.job_title || null });
    }
    return successResponse(res, { mine, colleagues });
  } catch (e) { return next(e); }
});

router.post('/:businessId/name-card-messages', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const bizId = Number(req.params.businessId);
    if (!['owner', 'admin', 'member'].includes(req.businessRole)) return errorResponse(res, 'forbidden', 403);
    const body = req.body || {};
    const { Conversation } = require('../models');
    const conv = await Conversation.findOne({ where: { id: Number(body.conversation_id) || 0, business_id: bizId } });
    if (!conv) return errorResponse(res, 'invalid_conversation_id', 400);
    const { canAccessConversation, getUserScope } = require('../middleware/access_scope');
    const scope = await getUserScope(req.user.id, bizId, req.user.platform_role);
    if (!(await canAccessConversation(req.user.id, conv, scope))) return errorResponse(res, 'forbidden', 403);

    let card = null;
    if (body.card_id) {
      card = await NameCard.findOne({ where: { id: Number(body.card_id), user_id: req.user.id } });
    } else if (body.member_user_id) {
      card = await memberCard({ params: { businessId: bizId, userId: body.member_user_id } });
    }
    if (!card) return errorResponse(res, 'not_found', 404);
    const owner = await User.findByPk(card.user_id, { attributes: nc.OWNER_ATTRS });
    if (nc.closedReason(card, owner)) return errorResponse(res, 'card_not_public', 400);

    const view = await nc.cardPublicViewWithBrands(card);
    const org = view.company || (view.brands && view.brands[0] && view.brands[0].name) || null;
    // 부제(직함·회사) — 카드의 note 칸은 «보낸 사람 메모» 자리라(화면이 카드 아래 따로 그린다) 다른 이름을 쓴다
    const subtitle = [view.job_title, org].filter(Boolean).join(' · ') || null;
    const msg = await require('../services/chatPost').postCardMessage({
      conv, senderId: req.user.id, io: req.app.get('io'),
      content: subtitle ? `[${view.name}] ${subtitle}` : `[${view.name}]`,
      meta: { card_type: 'name_card', name_card_id: card.id, title: view.name, subtitle, url: `${APP_URL}/c/${card.public_token}`, has_photo: !!view.has_photo },
    });
    require('../services/auditService').logAudit(req, {
      action: 'name_card.sent_to_chat', targetType: 'conversation', targetId: conv.id, businessId: bizId,
      newValue: { name_card_id: card.id, owner_user_id: card.user_id, message_id: msg.id },
    });
    return successResponse(res, { message_id: msg.id }, 'sent', 201);
  } catch (e) { return next(e); }
});

module.exports = router;
