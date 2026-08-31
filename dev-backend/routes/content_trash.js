// routes/content_trash.js — 문서(Q docs) · 정보(Q info) 휴지통 (목록 · 복원 · 영구삭제)
//
// 왜 필요한가 (Irene 2026-08-31)
//   "모든 이메일 노트 문서 인포 파일 삭제들이 휴지통에 존재할 수 있게 가능해? …
//    혹시라도 잘못해서 삭제하고 문제되면 책임여부 문제고"
//   여태 파일만 휴지통이 있었고 **문서·정보는 지우면 즉시 영구 삭제**였다(하드 DELETE).
//   되돌릴 방법이 없었다.
//
// 설계 — 파일 휴지통(routes/file_trash.js)과 **같은 계약**을 쓴다:
//   · 목록의 가시성 술어는 **일반 목록과 완전히 같은 것**을 쓴다. 여기서만 따로 짜면
//     남의 개인 자원이 휴지통을 통해 보이는 계열의 사고가 난다(실제로 겪은 적 있다).
//   · 삭제 권한과 복원·영구삭제 권한을 같게 둔다 — 지울 수 있었던 사람이 되돌릴 수 있다.
//   · 보관 기간 30일. 지난 것은 목록에 남기되 "만료" 로 표시한다(조용히 사라지지 않게).
const express = require('express');
const { Op } = require('sequelize');
const { Post, KbDocument, User, BusinessMember } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { getUserScope, postListWhereByLevel } = require('../middleware/access_scope');
const { successResponse, errorResponse, parsePagination, paginatedResponse } = require('../middleware/errorHandler');

const router = express.Router();

/** 파일 휴지통과 같은 보관 기간 — 두 값이 갈라지면 사용자가 규칙을 두 개 외워야 한다. */
const TRASH_RETENTION_DAYS = 30;

function isRestorable(deletedAt) {
  if (!deletedAt) return false;
  return (Date.now() - new Date(deletedAt).getTime()) < TRASH_RETENTION_DAYS * 86400 * 1000;
}

/** 삭제·복원·영구삭제 권한 — posts 의 DELETE 라우트와 **같은 규칙**(작성자 또는 owner/admin). */
async function canMutatePost(post, userId, platformRole) {
  if (platformRole === 'platform_admin') return true;
  if (String(post.author_id) === String(userId)) return true;
  const bm = await BusinessMember.findOne({
    where: { business_id: post.business_id, user_id: userId, removed_at: null }, attributes: ['role'],
  });
  return bm?.role === 'owner' || bm?.role === 'admin';
}

/** Q info — kb 라우트와 같은 규칙(멤버 이상). kb 는 작성자 축을 따로 두지 않는다. */
async function canMutateKb(doc, userId, platformRole) {
  if (platformRole === 'platform_admin') return true;
  const bm = await BusinessMember.findOne({
    where: { business_id: doc.business_id, user_id: userId, removed_at: null }, attributes: ['role'],
  });
  return !!bm;
}

// ─── GET /api/content-trash/:businessId — 문서·정보 휴지통 목록 ───────────
router.get('/:businessId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const scope = await getUserScope(req.user.id, businessId, req.user.platform_role);
    if (scope.isClient) return errorResponse(res, 'forbidden', 403);
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 100, maxLimit: 300 });

    // ★ 가시성 술어는 일반 문서 목록과 같은 것 — 휴지통이 우회로가 되면 안 된다.
    const posts = await Post.findAll({
      where: { ...postListWhereByLevel(scope), business_id: businessId, deleted_at: { [Op.ne]: null } },
      paranoid: false,
      include: [{ model: User, as: 'author', attributes: ['id', 'name'], required: false }],
      order: [['deleted_at', 'DESC']],
      limit, offset,
    });
    const kb = await KbDocument.findAll({
      where: { business_id: businessId, deleted_at: { [Op.ne]: null } },
      paranoid: false,
      order: [['deleted_at', 'DESC']],
      limit, offset,
    });

    const items = [
      ...posts.map((p) => ({
        kind: 'post', id: p.id, title: p.title || '(제목 없음)',
        deleted_at: p.deleted_at, author: p.author ? { id: p.author.id, name: p.author.name } : null,
        restorable: isRestorable(p.deleted_at),
      })),
      ...kb.map((d) => ({
        kind: 'kb', id: d.id, title: d.title || '(제목 없음)',
        deleted_at: d.deleted_at, author: null,
        restorable: isRestorable(d.deleted_at),
      })),
    ].sort((a, b) => new Date(b.deleted_at) - new Date(a.deleted_at));

    return paginatedResponse(res, items, items.length, { limit, page, offset });
  } catch (err) { next(err); }
});

/** 대상 로드 + 권한 — 복원·영구삭제가 같은 관문을 쓰게 한다(두 벌로 갈라지지 않게). */
async function loadTarget(req, res) {
  const businessId = Number(req.params.businessId);
  const kind = String(req.params.kind);
  const id = Number(req.params.id);
  if (!['post', 'kb'].includes(kind)) { errorResponse(res, 'invalid_kind', 400); return null; }
  const Model = kind === 'post' ? Post : KbDocument;
  const row = await Model.findOne({ where: { id, business_id: businessId }, paranoid: false });
  if (!row) { errorResponse(res, 'not_found', 404); return null; }
  if (!row.deleted_at) { errorResponse(res, 'not_deleted', 400); return null; }
  const ok = kind === 'post'
    ? await canMutatePost(row, req.user.id, req.user.platform_role)
    : await canMutateKb(row, req.user.id, req.user.platform_role);
  if (!ok) { errorResponse(res, 'forbidden', 403); return null; }
  return { kind, row };
}

// ─── POST /:businessId/:kind/:id/restore — 복원 ───────────────────────────
router.post('/:businessId/:kind/:id/restore', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const t = await loadTarget(req, res); if (!t) return;
    if (!isRestorable(t.row.deleted_at)) return errorResponse(res, 'retention_expired', 400);
    await t.row.restore();
    require('../services/auditService').logAudit(req, {
      action: t.kind === 'post' ? 'post.restore' : 'kb.document_restore',
      targetType: t.kind, targetId: t.row.id, businessId: Number(req.params.businessId),
      newValue: { title: t.row.title },
    });
    return successResponse(res, { kind: t.kind, id: t.row.id }, 'restored');
  } catch (err) { next(err); }
});

// ─── DELETE /:businessId/:kind/:id/purge — 영구 삭제 ──────────────────────
router.delete('/:businessId/:kind/:id/purge', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const t = await loadTarget(req, res); if (!t) return;
    const snapshot = { title: t.row.title };
    await t.row.destroy({ force: true });
    require('../services/auditService').logAudit(req, {
      action: t.kind === 'post' ? 'post.purge' : 'kb.document_purge',
      targetType: t.kind, targetId: t.row.id, businessId: Number(req.params.businessId),
      oldValue: snapshot,
    });
    return successResponse(res, null, 'purged');
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.TRASH_RETENTION_DAYS = TRASH_RETENTION_DAYS;
