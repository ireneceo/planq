// routes/signatures_sent.js — 보낸 서명(개인) · 서명 관리(워크스페이스 owner/admin) 목록 (2026-10-23)
//
//   Irene: «받은 서명 메뉴는 있는데 보낸서명 리스트는 어딨어?» · «전체 워크스페이스 설정에서 받은/보낸서명 관리가 있어서 다 정보가 리스트업 … 보낸담당자 누군지도»
//   설계 docs/SIGNATURE_MANAGE_DESIGN.md (Fable DESIGN-CHANGE 반영):
//     GET /api/signatures/sent?business_id=        — requester_user_id = 나 ∧ 지금 워크스페이스(받은 서명만 교차 예외)
//     GET /api/signatures/manage/:businessId       — 그 워크스페이스 전체 · owner/admin/platform_admin(활동 기록과 같은 403 owner_only)
//   ★ 읽기 전용이다. 취소·재알림·회차 닫기는 기존 문(DELETE /signatures/:id · …/reminder · …/close-round)이 그대로 하고,
//     권한은 services/signatureList.canManageRows 한 술어. 하드 삭제 문은 없다(서명 행은 증빙).
//   ★ 읽을 수 없는 문서(나만 보기 등)의 행은 빼지 않고 가린다(hiddenRow) — 제목·링크·IP·메모 없음 · 이메일 가림.
//   ★ 검색(q)은 **읽을 수 있는 문서 안에서만** 제목·서명자를 찾는다 — 가린 행의 제목·이메일을 검색으로 떠볼 수 없게.
//   ★ token·sign_url 은 싣지 않는다(withLink 없음 — 받는 본인만).
//   서버 마운트: app.use('/api', require('./routes/signatures_sent')) — signatures 보다 앞. 꼬리 경로 고유(sent · manage/:id).
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { SignatureRequest, Post, User, BusinessMember } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { errorResponse, parsePagination, paginatedResponse } = require('../middleware/errorHandler');
const { getUserScope, postListWhereByLevel, assertMemberOrAbove } = require('../middleware/access_scope');
const { requestScope, staleResponse } = require('../middleware/workspaceContext');
const { applyMemberDisplayName } = require('../services/displayName');
const L = require('../services/signatureList');

const OPEN = ['pending', 'sent', 'viewed'];

/** 필터 → where. 기본 «이전 회차» 는 뺀다(include_superseded=1 일 때만). */
function statusWhere(q) {
  const now = new Date();
  const st = String(q.status || 'all');
  const conds = [];
  if (st === 'open') conds.push({ status: { [Op.in]: OPEN } }, { [Op.or]: [{ expires_at: null }, { expires_at: { [Op.gt]: now } }] });
  else if (st === 'expired') conds.push({ [Op.or]: [{ status: 'expired' }, { status: { [Op.in]: OPEN }, expires_at: { [Op.lte]: now } }] });
  else if (['signed', 'rejected', 'canceled', 'confirmed'].includes(st)) conds.push({ status: st });
  if (q.include_superseded !== '1' && st !== 'superseded') conds.push({ status: { [Op.ne]: 'superseded' } });
  if (q.kind === 'sign' || q.kind === 'confirm') conds.push({ kind: q.kind });
  return conds;
}

/** 검색 — 보는 사람이 읽을 수 있는 문서(문서 목록 술어) 안에서 제목 ∨ 서명자 이름·이메일 */
async function searchWhere(user, businessId, q) {
  const text = String(q || '').trim().slice(0, 100);
  if (!text) return null;
  const like = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const scope = await getUserScope(user.id, businessId, user.platform_role);
  const readable = { [Op.and]: [postListWhereByLevel(scope), { business_id: businessId }] };
  const [byTitle, readableIds] = await Promise.all([
    Post.findAll({ where: { [Op.and]: [readable, { title: { [Op.like]: like } }] }, attributes: ['id'], raw: true }),
    Post.findAll({ where: { [Op.and]: [readable, { id: { [Op.in]: require('sequelize').literal(`(SELECT DISTINCT entity_id FROM signature_requests WHERE business_id = ${Number(businessId)} AND entity_type = 'post')`) } }] }, attributes: ['id'], raw: true }),
  ]);
  return {
    entity_type: 'post',
    [Op.or]: [
      { entity_id: { [Op.in]: byTitle.map((r) => r.id) } },
      { [Op.and]: [
        { entity_id: { [Op.in]: readableIds.map((r) => r.id) } },
        { [Op.or]: [{ signer_name: { [Op.like]: like } }, { signer_email: { [Op.like]: like } }] },
      ] },
    ],
  };
}

/** 행 → 응답. 문서 문(docAccessMap) · 관리 가능(canManageRows — 문서마다 한 번) · 요청자 표시명 */
async function shape(user, businessId, rows) {
  const posts = await L.loadPosts(rows);
  const postById = new Map(posts.map((p) => [p.id, p]));
  const docMap = await L.docAccessMap(user, posts);
  const postManage = new Map();
  for (const p of posts) {
    if (docMap.get(p.id)?.can_read) postManage.set(p.id, await L.canManageRows(user, p, []));
  }
  const reqIds = [...new Set(rows.map((r) => r.requester_user_id).filter(Boolean))];
  const users = reqIds.length ? await User.findAll({ where: { id: reqIds }, attributes: ['id', 'name'], raw: true }) : [];
  const userById = new Map(users.map((u) => [u.id, u]));
  const items = rows.map((s) => {
    const post = s.entity_type === 'post' ? postById.get(s.entity_id) : null;
    const doc = post ? docMap.get(post.id) : null;
    const u = userById.get(s.requester_user_id);
    const requester = u ? { id: u.id, name: u.name } : null;
    if (!post || !doc?.can_read) return { ...L.hiddenRow(s), requester };
    const mine = Number(s.requester_user_id) === Number(user.id);
    return {
      ...L.serialize(s),
      entity_title: post.title || null,
      hidden: false,
      doc,
      can_manage: mine || !!postManage.get(post.id),
      requester,
    };
  });
  await applyMemberDisplayName(items, businessId, ['requester']);
  return items;
}

async function list(req, res, baseWhere, businessId) {
  const { limit, page, offset } = parsePagination(req, { defaultLimit: 50, maxLimit: 200 });
  const conds = [baseWhere, ...statusWhere(req.query)];
  const sw = await searchWhere(req.user, businessId, req.query.q);
  if (sw) conds.push(sw);
  const { rows, count } = await SignatureRequest.findAndCountAll({
    where: { [Op.and]: conds },
    attributes: { exclude: ['signature_image_b64', 'item_images', 'token', 'otp_code_hash', 'content_snapshot', 'attachments_snapshot'] },
    order: [['created_at', 'DESC'], ['id', 'DESC']],
    limit, offset,
  });
  const items = await shape(req.user, businessId, rows);
  return { items, count, limit, page, offset };
}

// GET /api/signatures/sent?business_id=&status=&kind=&include_superseded=&q=&limit=&offset=
router.get('/signatures/sent', authenticateToken, async (req, res, next) => {
  try {
    const ws = requestScope(req, req.query.business_id);
    if (ws.stale) return staleResponse(res, ws);
    const businessId = ws.businessId;
    if (!businessId) return errorResponse(res, 'business_id_required', 400);
    if (!(await assertMemberOrAbove(req.user.id, businessId, req.user.platform_role))) return errorResponse(res, 'forbidden', 403);
    const out = await list(req, res, { business_id: businessId, requester_user_id: req.user.id }, businessId);
    return paginatedResponse(res, out.items, out.count, { limit: out.limit, page: out.page, offset: out.offset });
  } catch (err) { next(err); }
});

// GET /api/signatures/manage/:businessId?requester_user_id=&status=&kind=&include_superseded=&q=&limit=&offset=
router.get('/signatures/manage/:businessId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const isOwnerAdmin = req.businessRole === 'owner' || req.businessRole === 'admin'
      || req.user.platform_role === 'platform_admin';
    if (!isOwnerAdmin) return errorResponse(res, 'owner_only', 403);
    const businessId = parseInt(req.params.businessId, 10);
    const base = { business_id: businessId };
    const rq = parseInt(req.query.requester_user_id, 10);
    if (rq > 0) base.requester_user_id = rq;
    const out = await list(req, res, base, businessId);
    // 요청자 고르기 칸 — 이 워크스페이스에서 요청을 보낸 적 있는 사람(표시명)
    const ids = (await SignatureRequest.findAll({ where: { business_id: businessId }, attributes: ['requester_user_id'], group: ['requester_user_id'], raw: true }))
      .map((r) => r.requester_user_id).filter(Boolean);
    const us = ids.length ? await User.findAll({ where: { id: ids }, attributes: ['id', 'name'], raw: true }) : [];
    const requesters = us.map((u) => ({ requester: { id: u.id, name: u.name } }));
    await applyMemberDisplayName(requesters, businessId, ['requester']);
    // 지금 멤버가 아닌 요청자(내보낸 멤버)도 고르는 칸에 남긴다 — 화면이 «내보낸 멤버» 를 붙인다
    const memberIds = new Set((await BusinessMember.findAll({ where: { business_id: businessId, user_id: ids }, attributes: ['user_id'], raw: true })).map((m) => m.user_id));
    return paginatedResponse(res, out.items, out.count, {
      limit: out.limit, page: out.page, offset: out.offset,
      requesters: requesters.map((r) => ({ user_id: r.requester.id, display_name: r.requester.display_name || r.requester.name, is_member: memberIds.has(r.requester.id) })),
    });
  } catch (err) { next(err); }
});

module.exports = router;
