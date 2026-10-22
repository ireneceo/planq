// routes/member_cards.js — 같은 워크스페이스 동료의 «기본 명함» 보기. 설계 docs/NAME_CARD_V2_DESIGN.md 결정 3 (Fable 2026-10-22)
//
//   GET /api/businesses/:businessId/members/:userId/card  (+ /photo · /vcf)
//   ★ 보는 사람 = 그 워크스페이스 멤버(checkBusinessAccess = memberOnly — 고객 403). 대상이 활성 멤버가 아니거나 기본 명함이 없으면 404.
//   ★ 공개 스위치와 무관하게 보인다(기본 지정 = «이 워크스페이스에 건다» 는 명시 행위 · /members 가 이미 같은 연락처를 준다).
//     단 이름이 비면 안 보인다. 익명 링크(url)는 공개 판정(closedReason)을 통과할 때만 싣는다 — 토큰은 그 url 로만.
//   ★ 응답 키 = 공개 화이트리스트(cardPublicView) + brands. id·user_id·label·토큰 칸 없음.
//   ★ /api/businesses 접두어를 businesses.js 와 나눈다 — «/:businessId/members/:userId/card…» 꼬리만(server.js 에서 앞에 붙는다).
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

module.exports = router;
