// routes/file_usage.js — 파일 «연결된 곳» 읽기 (2026-11-25 · 설계 docs/FILE_USAGE_DESIGN.md)
//   GET  /api/files/:businessId/:id/usage      파일 상세 «연결된 곳» 칸
//   POST /api/files/:businessId/usage-summary  지우기(여러 개·폴더째)·범위 바꾸기 확인창 — body {file_ids} | {folder_id}
// 읽기만 한다. 판정은 services/fileUsage 한 곳. 호출자가 못 읽는 파일은 404(단건) / 조용히 제외(묶음).
const express = require('express');
const { Op } = require('sequelize');
const { File, FileFolder } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { getUserScope, canDownloadFile } = require('../middleware/access_scope');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const fileUsage = require('../services/fileUsage');

const router = express.Router();
const viewerOf = (req) => ({ id: req.user.id, platform_role: req.user.platform_role });

router.get('/:businessId/:id/usage', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const file = await File.findOne({ where: { id: Number(req.params.id) || 0, business_id: businessId, purged_at: null } });
    if (!file) return errorResponse(res, 'not_found', 404);
    const scope = await getUserScope(req.user.id, businessId, req.user.platform_role);
    if (!(await canDownloadFile(scope, req.user.id, file))) return errorResponse(res, 'not_found', 404);   // 존재 은닉
    successResponse(res, await fileUsage.listUsage(file, viewerOf(req), scope));
  } catch (e) { next(e); }
});

/** 폴더와 그 아래 폴더 전부의 id (같은 워크스페이스만, 깊이 상한 20) */
async function folderTreeIds(businessId, rootId) {
  const ids = [rootId];
  let frontier = [rootId];
  for (let d = 0; d < 20 && frontier.length; d += 1) {
    const kids = await FileFolder.findAll({ where: { business_id: businessId, parent_id: { [Op.in]: frontier } }, attributes: ['id'] });
    frontier = kids.map((k) => k.id).filter((id) => !ids.includes(id));
    ids.push(...frontier);
  }
  return ids;
}

router.post('/:businessId/usage-summary', authenticateToken, checkBusinessAccess, async (req, res, next) => { // audit-exempt: 읽기만 한다(POST 는 file_ids 목록을 본문으로 받기 위해서)
  try {
    const businessId = Number(req.params.businessId);
    const scope = await getUserScope(req.user.id, businessId, req.user.platform_role);
    let where = null;
    if (req.body && req.body.folder_id) {
      const folder = await FileFolder.findOne({ where: { id: Number(req.body.folder_id) || 0, business_id: businessId } });
      if (!folder) return errorResponse(res, 'not_found', 404);
      where = { business_id: businessId, deleted_at: null, folder_id: { [Op.in]: await folderTreeIds(businessId, folder.id) } };
    } else {
      const ids = [...new Set((Array.isArray(req.body?.file_ids) ? req.body.file_ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
      if (!ids.length) return errorResponse(res, 'file_ids required', 400);
      where = { business_id: businessId, deleted_at: null, id: { [Op.in]: ids.slice(0, 1000) } };
    }
    const rows = await File.findAll({ where, limit: 1000 });
    const readable = [];
    for (const f of rows) if (await canDownloadFile(scope, req.user.id, f)) readable.push(f);
    successResponse(res, await fileUsage.summarize(readable, viewerOf(req), scope));
  } catch (e) { next(e); }
});

module.exports = router;
