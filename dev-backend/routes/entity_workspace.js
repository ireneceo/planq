// GET /api/entity-workspace/:kind/:id — 이 항목이 **내가 멤버인 어느 워크스페이스** 것인가 (Q6 판정 전용)
//
// docs/WORKSPACE_SCOPE_DESIGN.md Q6 · 2026-09-11
//   캘린더·메일·Q info·파일·청구서·고객 상세는 URL 에 **현재 워크스페이스**를 넣어 불러온다
//   (`/api/businesses/:bid/…/:id`). 그래서 다른 워크스페이스 항목은 새지 않는 대신 **404** 가 되고,
//   화면은 "찾을 수 없음" 또는 아무 반응 없음으로 보인다 — 알림·검색·공유 링크로 들어온 사용자에게는 거짓말이다.
//   화면이 404 를 받았을 때 **이 한 곳**에 묻는다: 내 다른 워크스페이스 항목이면 그 business_id 를 주고,
//   화면은 내용을 그리지 않고 "○○ 로 전환해서 열기" 를 보인다(DetailFallback other_workspace).
//
// ★ 돌려주는 것은 **business_id 하나뿐**이다. 제목·상태 등 내용은 절대 싣지 않는다.
// ★ 그 워크스페이스의 **멤버 이상**일 때만 답한다. 아니면(비소속·고객 계정·없는 id·지운 항목) 전부 같은 404 —
//   남의 워크스페이스에 그 id 가 있는지 없는지를 구별할 수 없어야 한다.
// ★ 메일은 워크스페이스 멤버라도 **접근 가능한 메일 계정**의 스레드일 때만 답한다(개인 메일 존재 노출 차단).
//   목록 라우트(email_threads.js)와 같은 함수(services/mailIdentity.accessibleAccountIds)를 쓴다.
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { assertWorkspaceAccess, isMemberOrAbove } = require('../middleware/access_scope');
const { CalendarEvent, EmailThread, KbDocument, File, Invoice, Client } = require('../models');
const { accessibleAccountIds } = require('../services/mailIdentity');

// kind → 조회 방법. 지운 항목은 없는 것으로 친다(File 은 soft delete 컬럼, KbDocument 는 paranoid).
const KINDS = {
  event: (id) => CalendarEvent.findByPk(id, { attributes: ['id', 'business_id'] }),
  email_thread: (id) => EmailThread.findByPk(id, { attributes: ['id', 'business_id', 'account_id'] }),
  kb_doc: (id) => KbDocument.findByPk(id, { attributes: ['id', 'business_id'] }),
  file: (id) => File.findOne({ where: { id, deleted_at: null }, attributes: ['id', 'business_id'] }),
  invoice: (id) => Invoice.findByPk(id, { attributes: ['id', 'business_id'] }),
  client: (id) => Client.findByPk(id, { attributes: ['id', 'business_id'] }),
};

router.get('/:kind/:id', authenticateToken, async (req, res, next) => {
  try {
    const find = KINDS[req.params.kind];
    const id = Number(req.params.id);
    if (!find || !Number.isInteger(id) || id <= 0) return errorResponse(res, 'not_found', 404);
    const row = await find(id);
    const businessId = row ? Number(row.business_id) : 0;
    if (!businessId) return errorResponse(res, 'not_found', 404);
    const scope = await assertWorkspaceAccess(req.user.id, businessId, req.user.platform_role);
    if (!scope || !isMemberOrAbove(scope)) return errorResponse(res, 'not_found', 404);
    if (req.params.kind === 'email_thread') {
      const acctIds = await accessibleAccountIds(businessId, req.user.id);
      if (!acctIds.map(Number).includes(Number(row.account_id))) return errorResponse(res, 'not_found', 404);
    }
    return successResponse(res, { business_id: businessId });
  } catch (err) { next(err); }
});

module.exports = router;
