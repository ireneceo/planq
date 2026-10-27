// PUT /api/businesses/:businessId/me/table-prefs
// 표 열 설정(순서·폭·숨김) — 이 워크스페이스에서 내가 고른 값(2026-10-27, Irene «권고대로» 계정별).
// body: { table_id: 'qtask-list', prefs: { order, widths, hidden } | null } — 표 하나씩 바꾼다(null = 그 표 기본으로).
//   표마다 따로 보내므로 두 표를 거의 같이 저장해도 서로 덮지 않게 행을 잠그고 합친다.
// 멤버만(고객은 서버 저장 없음 — 화면이 이 브라우저에 둔다). 숨김은 권한이 아니다(services/tablePrefs).
// 읽기는 /api/auth/me 의 table_prefs.
//
// ★ /api/businesses 에 businesses.js 보다 **앞에** 붙는다 — 이 파일에는 «/:businessId/me/table-prefs» 한 경로만 둔다.
const express = require('express');
const router = express.Router();
const { BusinessMember } = require('../models');
const { sequelize } = require('../config/database');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { mergeTablePrefs } = require('../services/tablePrefs');

// audit-exempt: 개인 화면 설정(표 열 순서·폭·숨김) — 권한·데이터 변경 아님
router.put('/:businessId/me/table-prefs', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
    const tableId = req.body?.table_id;
    const raw = req.body?.prefs;
    if (raw === undefined) return errorResponse(res, 'invalid_table_prefs', 400);
    if (JSON.stringify(raw ?? null).length > 8000) return errorResponse(res, 'invalid_table_prefs', 400);
    let out;
    await sequelize.transaction(async (transaction) => {
      const bm = await BusinessMember.findOne({
        where: { user_id: req.user.id, business_id: businessId, removed_at: null },
        transaction, lock: transaction.LOCK.UPDATE,
      });
      if (!bm) { out = { status: 403 }; return; }
      let next;
      try { next = mergeTablePrefs(bm.table_prefs, tableId, raw); } catch (e) { out = { status: 400, code: e.message }; return; }
      await bm.update({ table_prefs: next }, { transaction });
      out = { status: 200, data: next };
    });
    if (out.status === 403) return errorResponse(res, 'forbidden', 403);
    if (out.status === 400) return errorResponse(res, out.code || 'invalid_table_prefs', 400);
    return successResponse(res, { table_prefs: out.data });
  } catch (err) { next(err); }
});

module.exports = router;
