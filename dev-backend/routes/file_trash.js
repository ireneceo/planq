// routes/file_trash.js — 파일 휴지통 (목록 · 복구 · 영구삭제 · 비우기)
//
// files.js 에서 갈라 나왔다. 그 파일은 이미 1400줄이 넘어 god-file 래칫에 걸려 있었고,
// 휴지통은 "삭제된 것" 이라는 뚜렷한 축이라 섞어 둘 이유가 없다.
//
// ★ 여기에 권한·가시성 술어를 **새로 짜지 않는다.** 목록은 일반 파일 목록과 같은
//   fileListWhereByLevel, 복구·삭제 권한은 files.js 와 같은 canMutateFile 을 쓴다.
//   따로 짜면 개인 파일이 휴지통을 통해 남에게 보이는 계열의 사고가 난다.
const express = require('express');
const fs = require('fs');
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { File, User } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { attachWorkspaceScope, fileListWhereByLevel } = require('../middleware/access_scope');
const { successResponse, errorResponse, parsePagination, paginatedResponse } = require('../middleware/errorHandler');
const { purgeFile } = require('../services/filePurge');
const { canMutateFile, getOrCreateUsage, applyMemberDisplayName, broadcastFile, isRestorable, TRASH_RETENTION_DAYS } = require('./files');
const planEngine = require('../services/plan');

const router = express.Router();

// ─── 휴지통 ─────────────────────────────────────────────────────────
//
// 왜 필요한가: 여태 삭제는 되돌릴 방법이 **없었다.** DB 에 deleted_at 을 찍어 "soft delete"
//   라고 불렀지만 같은 함수가 바이트까지 지웠고, 복구 라우트도 화면도 0건이었다.
//   사용자 입장에서는 그냥 영구 삭제다(2026-08-28 정정 기록).
//
// 목록의 가시성 술어는 일반 목록과 **완전히 같은 것**을 쓴다(fileListWhereByLevel).
//   여기서만 따로 짜면 개인 파일이 휴지통을 통해 남에게 보인다 — 실제로 겪은 계열의 사고다.
router.get('/:businessId/trash', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
    const where = {
      ...fileListWhereByLevel(req.scope),
      deleted_at: { [Op.ne]: null },
      // 휴지통은 **되돌릴 수 있는 것**의 목록이다. 바이트가 이미 사라진 옛 삭제분(운영 수백 건)을
      //   섞으면 목록이 눌러도 안 되는 항목으로 채워진다. 그건 휴지통이 아니라 감사 기록이다.
      purged_at: null,
    };
    if (req.query.project_id) where.project_id = req.query.project_id;

    const { limit, page, offset } = parsePagination(req, { defaultLimit: 200, maxLimit: 500 });
    const { rows, count } = await File.findAndCountAll({
      where,
      include: [
        { model: User, as: 'uploader', attributes: ['id', 'name'] },
        { model: User, as: 'deleter', attributes: ['id', 'name'] },
      ],
      order: [['deleted_at', 'DESC']],
      limit, offset,
      distinct: true,
    });
    const items = rows.map((r) => {
      const j = r.toJSON();
      // 복구 가능 여부를 **행마다 정직하게** 실는다. 옛 삭제분은 바이트가 이미 사라졌다 —
      //   눌러도 안 되는 버튼을 주지 않기 위해 화면이 이 값으로 버튼을 끈다.
      j.restorable = isRestorable(r);
      j.purge_after = r.deleted_at
        ? new Date(new Date(r.deleted_at).getTime() + TRASH_RETENTION_DAYS * 86400000).toISOString()
        : null;
      return j;
    });
    await applyMemberDisplayName(items, req.params.businessId, ['uploader', 'deleter']);
    return paginatedResponse(res, items, count, { limit, page, offset, retention_days: TRASH_RETENTION_DAYS });
  } catch (error) { next(error); }
});

// 복구 — 권한은 삭제와 **같은 술어**(canMutateFile). 지울 수 있었던 사람이 되돌릴 수 있다.
router.post('/:businessId/:id/restore', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
  try {
    const file = await File.findOne({
      where: { id: req.params.id, business_id: req.params.businessId, deleted_at: { [Op.ne]: null } },
    });
    if (!file) return errorResponse(res, 'File not found', 404);
    if (!(await canMutateFile(file, req))) {
      return errorResponse(res, '본인 업로드 · 오너 · 프로젝트 PM 만 복구할 수 있습니다', 403);
    }
    // 컬럼과 디스크를 **둘 다** 본다 — 어느 한쪽만 믿으면 거짓 복구가 된다.
    if (file.purged_at || !isRestorable(file)) {
      // 되살릴 바이트가 없다. 되는 척하지 않는다.
      return errorResponse(res, 'file_bytes_gone', 410);
    }

    const t = await sequelize.transaction();
    try {
      // 쿼터를 다시 채운다 — 삭제 때 반환했으므로 복구하면 되돌려야 한다.
      //   한도를 넘기면 복구를 막는다: 넘긴 채로 되살리면 업로드 게이트를 우회하는 뒷문이 된다.
      if (file.storage_provider === 'planq') {
        const usage = await getOrCreateUsage(file.business_id, t);
        const { plan } = await planEngine.getBusinessPlan(file.business_id);
        const quota = plan.limits.storage_bytes;
        const next = Number(usage.bytes_used) + Number(file.file_size || 0);
        if (quota !== Infinity && quota != null && next > quota) {
          await t.rollback();
          return errorResponse(res, 'storage_quota_exceeded', 413);
        }
        usage.bytes_used = next;
        usage.file_count = usage.file_count + 1;
        await usage.save({ transaction: t });
      }
      file.deleted_at = null;
      file.deleted_by = null;
      await file.save({ transaction: t });
      await t.commit();
    } catch (e) { await t.rollback(); throw e; }

    require('../services/auditService').logAudit(req, {
      action: 'file.restore',
      targetType: 'file',
      targetId: file.id,
      newValue: { name: file.file_name, size: Number(file.file_size) || 0 },
    });
    // 목록에 되살아난 것이 **다른 사람 화면에도** 즉시 보여야 한다 (CLAUDE.md §16).
    broadcastFile(req, { id: file.id, business_id: file.business_id, project_id: file.project_id }, 'file:new');
    successResponse(res, { id: file.id }, 'File restored');
  } catch (error) { next(error); }
});

// 영구 삭제 — 여기서 비로소 바이트가 사라진다.
router.delete('/:businessId/:id/purge', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
  try {
    const file = await File.findOne({
      where: { id: req.params.id, business_id: req.params.businessId, deleted_at: { [Op.ne]: null } },
    });
    if (!file) return errorResponse(res, 'File not found', 404);
    if (!(await canMutateFile(file, req))) {
      return errorResponse(res, '본인 업로드 · 오너 · 프로젝트 PM 만 영구 삭제할 수 있습니다', 403);
    }
    const snapshot = { name: file.file_name, size: Number(file.file_size) || 0 };
    const t = await sequelize.transaction();
    try {
      await purgeFile(file, t);
      await t.commit();
    } catch (e) { await t.rollback(); throw e; }
    require('../services/auditService').logAudit(req, {
      action: 'file.purge', targetType: 'file', targetId: file.id, oldValue: snapshot,
    });
    successResponse(res, null, 'File purged');
  } catch (error) { next(error); }
});

// 휴지통 비우기 — 내가 영구 삭제할 수 있는 것만 지운다(남의 것을 쓸어담지 않는다).
router.post('/:businessId/trash/empty', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
  try {
    const files = await File.findAll({
      where: { ...fileListWhereByLevel(req.scope), deleted_at: { [Op.ne]: null } },
      limit: 500,
    });
    let purged = 0; const skipped = [];
    for (const f of files) {
      if (!(await canMutateFile(f, req))) { skipped.push(f.id); continue; }
      const t = await sequelize.transaction();
      try { await purgeFile(f, t); await t.commit(); purged++; }
      catch (e) { await t.rollback(); console.error('[files] purge failed', f.id, e.message); }
    }
    require('../services/auditService').logAudit(req, {
      action: 'file.trash_empty', targetType: 'file', targetId: null,
      businessId: Number(req.params.businessId),
      oldValue: { purged, skipped: skipped.length },
    });
    successResponse(res, { purged, skipped: skipped.length }, `${purged} files purged`);
  } catch (error) { next(error); }
});


module.exports = router;
