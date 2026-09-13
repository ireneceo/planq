// routes/client_links.js — 고객에 **연결된 것**을 읽는 라우트 (같은 `/api/clients` 접두어).
//
// ★ 왜 파일을 나눴나: `routes/clients.js` 가 500줄 계약(CLAUDE.md 파일 크기 기준)을 넘겼다.
//   고객 CRUD·초대와 "연결된 것 읽기" 는 성격이 다르므로 그 선에서 가른다.
// ★ 마운트는 clients.js **앞**이다 — `/:businessId/:clientId/qnotes` 가
//   clients.js 의 `/:businessId/:id` 보다 먼저 판정돼야 한다(memory `feedback_express_route_order`).
//   같은 파일 안 중복은 가드 `--category=duproute` 가 막지만 **파일이 다르면 못 본다** —
//   그래서 여기에는 고객 id 뒤에 고유한 꼬리가 붙은 경로만 둔다.
const express = require('express');
const router = express.Router();
const { Client } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

// GET /api/clients/:businessId/:clientId/qnotes — 이 고객에 연결된 Q Note 회의록
//
// ★ 2026-09-13 (Irene: *"Q note나 문서 등 고객이 연결되면 고객프로필에도 나와야 하는 거야."*)
//   프로젝트 히스토리가 쓰는 것과 **같은 브리지 한 함수**(services/qnoteByEntity)다 — 베끼면
//   한쪽만 L1 필터가 빠진다. 범위 판정은 q-note 가 한다(`visibility <> 'L1'`): 개인 노트는 안 온다.
//   (프로젝트 **노트 탭**은 Q Note 본체를 얹었으므로 q-note 를 직접 읽는다 — 여기를 쓰지 않는다.)
//   경로를 `/notes` 로 두지 않는다 — 이 파일에 그런 경로가 생기면 또 가려진다(가드 duproute).
router.get('/:businessId/:clientId/qnotes', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
    const businessId = Number(req.params.businessId);
    const clientId = Number(req.params.clientId);
    const client = await Client.findOne({ where: { id: clientId, business_id: businessId }, attributes: ['id'] });
    if (!client) return errorResponse(res, 'Client not found', 404);
    const { listQnoteByEntity } = require('../services/qnoteByEntity');
    const rows = await listQnoteByEntity({
      businessId, clientId,
      limit: Math.min(Math.max(Number(req.query.limit) || 50, 1), 100),
    });
    return successResponse(res, rows);
  } catch (error) { next(error); }
});

module.exports = router;
