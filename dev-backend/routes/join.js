// 워크스페이스 참여 신청 — 신청자 쪽 (2026-11-06 · docs/SIGNUP_START_JOIN_DESIGN.md §5-2, Fable 설계)
//   GET    /api/join/suggestions       — 내 인증된 회사 메일 도메인으로 열린 워크스페이스
//   POST   /api/join/lookup {code}     — 참여 코드로 1건(없으면 한결같이 404)
//   POST   /api/join/requests          — 신청(같은 행 재신청)
//   GET    /api/join/requests/mine     — 내 신청
//   DELETE /api/join/requests/:id      — 내 대기 신청 취소
//
// ★ 공개 표면 없음 — 전부 로그인 + 이메일 인증. 이름 검색 없음. 응답은 이름·로고뿐(멤버 수·대표 이름 없음).
// ★ 신청은 열림 판정을 **다시** 본다(lookup·suggestions 결과를 믿지 않는다).
// ★ 워크스페이스 범위가 없는 «나» 의 자료 — X-Workspace-Id 를 보지 않는다.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { Op } = require('sequelize');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { perUserLimiter } = require('../middleware/costGuard');
const { Business, User, BusinessMember, WorkspaceJoinRequest } = require('../models');
const policy = require('../services/joinPolicy');
const JR = require('../services/joinRequests');

const MAX_SUGGESTIONS = 20;
const HOUR = 60 * 60 * 1000;
const lookupUserLimit = perUserLimiter('join-lookup', { windowMs: HOUR, max: 10, message: 'too_many_lookups' });
const lookupIpLimit = rateLimit({
  windowMs: HOUR, max: 30, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `join-lookup-ip${ipKeyGenerator(req.ip)}`,
  message: { success: false, message: 'too_many_lookups' },
});
const requestLimit = perUserLimiter('join-request', { windowMs: HOUR, max: 5, message: 'too_many_join_requests' });

/** 로그인 + 이메일 인증. 사람 행을 req.joinUser 에 싣는다. */
async function requireVerified(req, res, next) {
  try {
    const u = await User.findByPk(req.user.id, { attributes: [...policy.USER_ATTRS, 'name'] });
    if (!u || !u.email_verified_at) return errorResponse(res, 'email_not_verified', 403);
    req.joinUser = u;
    return next();
  } catch (e) { return next(e); }
}

const bizCard = (b) => ({ business_id: b.id, brand_name: b.brand_name || b.name, brand_logo_url: b.brand_logo_url || null });

/** 이미 들어가 있는 워크스페이스(활성 멤버 · 활성 고객) — 추천에서 뺀다. 고객은 신청할 수 있다(승인 때 멤버가 이긴다). */
async function memberBizIds(userId) {
  const rows = await BusinessMember.findAll({ where: { user_id: userId, removed_at: null }, attributes: ['business_id'] });
  return new Set(rows.map((r) => r.business_id));
}

async function myRequestMap(userId, bizIds) {
  if (!bizIds.length) return new Map();
  const rows = await WorkspaceJoinRequest.findAll({ where: { user_id: userId, business_id: bizIds } });
  return new Map(rows.map((r) => [r.business_id, r]));
}

router.get('/suggestions', authenticateToken, requireVerified, async (req, res, next) => {
  try {
    const domains = policy.companyDomainsOf(req.joinUser);
    if (!domains.length) return successResponse(res, { domains: [], workspaces: [] });
    const candidates = await Business.findAll({
      where: { join_by_domain: true, join_domain: { [Op.in]: domains }, deleted_at: null },
      attributes: ['id', 'name', 'brand_name', 'brand_logo_url', 'owner_id', 'join_by_domain', 'join_domain', 'deleted_at'],
      limit: MAX_SUGGESTIONS,
    });
    const mine = await memberBizIds(req.user.id);
    const open = [];
    for (const b of candidates) {
      if (mine.has(b.id)) continue;
      if (await policy.domainJoinOpen(b)) open.push(b);   // 켤 때·신청할 때와 같은 술어
    }
    const reqs = await myRequestMap(req.user.id, open.map((b) => b.id));
    return successResponse(res, {
      domains,
      workspaces: open.map((b) => ({ ...bizCard(b), request: JR.requestView(reqs.get(b.id)) })),
    });
  } catch (e) { next(e); }
});

router.post('/lookup', authenticateToken, requireVerified, lookupIpLimit, lookupUserLimit, async (req, res, next) => { // audit-exempt: 코드로 찾기(읽기) — 쓰기 없음
  try {
    const code = policy.normalizeCode(req.body?.code);
    if (!code) return errorResponse(res, 'join_code_not_found', 404);
    const b = await Business.findOne({ where: { join_code: code, deleted_at: null }, attributes: ['id', 'name', 'brand_name', 'brand_logo_url'] });
    if (!b) return errorResponse(res, 'join_code_not_found', 404);
    const reqs = await myRequestMap(req.user.id, [b.id]);
    const mine = await memberBizIds(req.user.id);
    return successResponse(res, { ...bizCard(b), already_member: mine.has(b.id), request: JR.requestView(reqs.get(b.id)) });
  } catch (e) { next(e); }
});

router.post('/requests', authenticateToken, requireVerified, requestLimit, async (req, res, next) => { // audit-exempt: 감사는 services/joinRequests.createOrReapply 가 쓴다(workspace.join_request)
  try {
    const businessId = Number(req.body?.business_id);
    const source = req.body?.source === 'code' ? 'code' : req.body?.source === 'domain' ? 'domain' : null;
    if (!Number.isInteger(businessId) || businessId <= 0 || !source) return errorResponse(res, 'invalid_join_request', 400);
    const b = await Business.findOne({
      where: { id: businessId, deleted_at: null },
      attributes: ['id', 'owner_id', 'join_by_domain', 'join_domain', 'join_code', 'deleted_at'],
    });
    // 열림 판정을 다시 본다 — 어긋나면 존재를 드러내지 않고 404
    if (!b) return errorResponse(res, 'join_not_open', 404);
    if (source === 'domain') {
      const ok = (await policy.domainJoinOpen(b)) && policy.companyDomainsOf(req.joinUser).includes(String(b.join_domain).toLowerCase());
      if (!ok) return errorResponse(res, 'join_not_open', 404);
    } else {
      const code = policy.normalizeCode(req.body?.code);
      if (!code || !b.join_code || b.join_code !== code) return errorResponse(res, 'join_not_open', 404);
    }
    const row = await JR.createOrReapply({
      businessId, user: req.joinUser, source, message: req.body?.message, io: req.app.get('io'), actorReq: req,
    });
    return successResponse(res, { id: row.id, status: 'pending', expires_at: row.expires_at }, 'Join requested', 201);
  } catch (e) {
    if (e instanceof JR.JoinError) return e.body ? res.status(e.status).json(e.body) : errorResponse(res, e.code, e.status);
    next(e);
  }
});

router.get('/requests/mine', authenticateToken, async (req, res, next) => {
  try {
    const now = Date.now();
    const rows = await WorkspaceJoinRequest.findAll({
      where: { user_id: req.user.id },
      include: [{ model: Business, required: true, where: { deleted_at: null }, attributes: ['id', 'name', 'brand_name', 'brand_logo_url'] }],
      order: [['requested_at', 'DESC']], limit: 50,
    });
    const out = [];
    for (const r of rows) {
      const live = JR.isLive(r, now);
      const decidedRecent = r.decided_at && now - new Date(r.decided_at).getTime() < JR.SHOW_DECIDED_MS;
      const expiredRecent = r.status === 'pending' && !live && now - new Date(r.expires_at).getTime() < JR.SHOW_EXPIRED_MS;
      if (!live && !decidedRecent && !expiredRecent) continue;
      if (r.status === 'canceled') continue;
      out.push({ ...bizCard(r.Business), request: JR.requestView(r, now) });
    }
    return successResponse(res, out);
  } catch (e) { next(e); }
});

router.delete('/requests/:id', authenticateToken, async (req, res, next) => { // audit-exempt: 감사는 services/joinRequests.cancel 이 쓴다(workspace.join_cancel)
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return errorResponse(res, 'join_request_not_found', 404);
    await JR.cancel({ requestId: id, userId: req.user.id, io: req.app.get('io'), actorReq: req });
    return successResponse(res, { id, status: 'canceled' });
  } catch (e) {
    if (e instanceof JR.JoinError) return errorResponse(res, e.code, e.status);
    next(e);
  }
});

module.exports = router;
