// routes/sale_inquiries.js — Q sale «신규 문의»(공개 페이지·창구 문의 폼) 팀 처리 (2026-11-20)
//
//   설계: docs/WORKSPACE_PUBLIC_PAGE_DESIGN.md §5.4 (Irene 결정 ③ — 신규 문의함에 쌓고 한 번 눌러 고객 등록)
//
// ★ 권한 체인은 Q sale 한 벌(services/saleCommon readChain·writeChain — 고객 역할 차단 + 메뉴 권한).
// ★ 모든 조회·변경은 `business_id = :businessId` 로 좁힌다 — id 만 믿으면 남의 워크스페이스 문의를 연다.
// ★ 고객 등록은 여기가 아니라 `POST /:businessId/save-as-client {from:'inquiry'}` 한 문(routes/sale_save.js) —
//   중복 판정(findExistingByContact)·문의 고객 한도·단계 전이가 다른 등록과 같은 함수를 지난다.
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { WorkspaceInquiry } = require('../models');
const { successResponse, errorResponse, parsePagination, paginatedResponse } = require('../middleware/errorHandler');
const { createAuditLog } = require('../services/auditService');
const { readChain, writeChain } = require('../services/saleCommon');
const { emitSignal } = require('../services/workspaceInquiry');

const STATUSES = ['new', 'handled', 'held', 'spam'];
// 화면에 내보내는 칸 — 화이트리스트(ip_hash·message_hash 는 판정용이라 싣지 않는다)
const serialize = (r) => ({
  id: r.id, status: r.status, via: r.via,
  name: r.name, email: r.email, phone: r.phone, company: r.company,
  message: r.message, service_id: r.service_id, service_name: r.service_name,
  locale: r.locale, held_reason: r.held_reason,
  client_id: r.client_id, handled_by: r.handled_by, handled_at: r.handled_at,
  // underscored 모델의 시각은 인스턴스 속성 createdAt 이다(r.created_at 은 undefined — Fable 재검증 비차단)
  created_at: r.createdAt || r.get('created_at'),
});

async function countsOf(businessId) {
  const rows = await WorkspaceInquiry.findAll({
    where: { business_id: businessId }, attributes: ['status', [WorkspaceInquiry.sequelize.fn('COUNT', '*'), 'n']],
    group: ['status'], raw: true,
  });
  const out = { new: 0, handled: 0, held: 0, spam: 0 };
  for (const r of rows) out[r.status] = Number(r.n) || 0;
  return out;
}

// ── GET /:businessId/inquiries?status=new ───────────────────────────────────
router.get('/:businessId/inquiries', ...readChain, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const status = STATUSES.includes(req.query.status) ? req.query.status : 'new';
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 50, maxLimit: 200 });
    const { rows, count } = await WorkspaceInquiry.findAndCountAll({
      where: { business_id: businessId, status }, order: [['created_at', 'DESC']], limit, offset,
    });
    return paginatedResponse(res, rows.map(serialize), count, { limit, page, offset });
  } catch (err) { next(err); }
});

// ── GET /:businessId/inquiry-counts ─ 칩 숫자(상태별) ─────────────────────
router.get('/:businessId/inquiry-counts', ...readChain, async (req, res, next) => {
  try { return successResponse(res, await countsOf(Number(req.params.businessId))); } catch (err) { next(err); }
});

// ── GET /:businessId/inquiries/:id ─────────────────────────────────────────
router.get('/:businessId/inquiries/:id', ...readChain, async (req, res, next) => {
  try {
    const row = await WorkspaceInquiry.findOne({ where: { id: Number(req.params.id) || 0, business_id: Number(req.params.businessId) } });
    if (!row) return errorResponse(res, 'not_found', 404);
    return successResponse(res, serialize(row));
  } catch (err) { next(err); }
});

// ── POST /:businessId/inquiries/:id/status {status} — 처리함·스팸·되돌리기 ──
router.post('/:businessId/inquiries/:id/status', ...writeChain, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const to = String(req.body?.status || '');
    if (!['new', 'handled', 'spam'].includes(to)) return errorResponse(res, 'invalid_status', 400);
    const row = await WorkspaceInquiry.findOne({ where: { id: Number(req.params.id) || 0, business_id: businessId } });
    if (!row) return errorResponse(res, 'not_found', 404);
    const before = row.status;
    await row.update({
      status: to,
      handled_by: to === 'new' ? null : req.user.id,
      handled_at: to === 'new' ? null : new Date(),
    });
    createAuditLog({
      userId: req.user.id, businessId, action: 'inquiry.status',
      targetType: 'workspace_inquiry', targetId: row.id, oldValue: { status: before }, newValue: { status: to },
    });
    emitSignal(req.app, businessId, row.id);
    return successResponse(res, serialize(row));
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.serializeInquiry = serialize;
