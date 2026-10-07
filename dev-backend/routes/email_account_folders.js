// routes/email_account_folders.js — 업체 보낸편지함·스팸함 가져오기 켜기/끄기 (계정 설정 화면 토글)
//   설계: docs/MAIL_SENT_SPAM_SYNC_DESIGN.md. email_accounts.js 와 같은 마운트 경로를 쓴다(그 파일이 router.use 로 붙인다).
//   ★ 접근 술어(accessibleWhere·canManageAccount)는 **email_accounts.js 의 것을 받아 쓴다** — 베끼면 두 벌이 된다.
const express = require('express');
const { EmailAccount, EmailAccountFolder } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { createAuditLog } = require('../middleware/audit');
const { EXTRA_FOLDER_ROLES, serializeExtraFolders } = require('../services/mailExtraFolders');

module.exports = function buildEmailAccountFoldersRouter({ accessibleWhere, canManageAccount }) {
  const router = express.Router();

  // PUT /folders/:role — 업체 보낸편지함·스팸함 가져오기 켜기/끄기 (계정 설정 화면 토글)
  //   관리 권한은 계정 편집과 같다(canManageAccount). 끄면 그 폴더 수집만 멈춘다 — 이미 들어온 메일은 그대로다.
  router.put('/:businessId/email-accounts/:id/folders/:role', authenticateToken, checkBusinessAccess, async (req, res, next) => {
    try {
      const role = String(req.params.role);
      if (!EXTRA_FOLDER_ROLES.includes(role)) return errorResponse(res, 'invalid_role', 400);
      if (typeof (req.body || {}).enabled !== 'boolean') return errorResponse(res, 'invalid_enabled', 400);
      const acc = await EmailAccount.findOne({
        where: { id: req.params.id, business_id: req.params.businessId, ...accessibleWhere(req) },
      });
      if (!acc) return errorResponse(res, 'not_found', 404);
      if (!canManageAccount(req, acc)) return errorResponse(res, 'forbidden', 403);
      const enabled = req.body.enabled;
      const [row] = await EmailAccountFolder.findOrCreate({
        where: { account_id: acc.id, role },
        defaults: { account_id: acc.id, role, enabled },
      });
      const before = !!row.enabled;
      if (before !== enabled) await row.update({ enabled });
      if (before !== enabled) {
        await createAuditLog({
          userId: req.user.id, businessId: Number(req.params.businessId),
          action: 'email_account.folder_toggle', targetType: 'EmailAccount', targetId: acc.id,
          oldValue: { role, enabled: before }, newValue: { role, enabled },
        });
      }
      const rows = await EmailAccountFolder.findAll({ where: { account_id: acc.id } });
      successResponse(res, serializeExtraFolders(rows));
    } catch (err) { next(err); }
  });

  return router;
};
