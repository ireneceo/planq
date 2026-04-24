// Contact inquiries — Enterprise 문의·랜딩 문의하기·일반 문의 공통 접수 엔드포인트.
// POST: 공개 (인증 optional · rate limit 적용). GET/PATCH: platform_admin 전용 (관리자 대시보드).
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { ContactInquiry, User, Business } = require('../models');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

const VALID_KINDS = ['enterprise', 'general', 'landing'];

function isValidEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
}

// ─── POST /api/inquiries — 문의 접수 (공개) ───
// 인증 토큰 있으면 사용자/워크스페이스 자동 연결, 없어도 접수 가능 (랜딩 페이지 용).
// rate-limit 은 server.js 에서 setupSecurity 로 전역 /api 100/분 적용되며,
// 이 엔드포인트 전용 추가 제한은 middleware/security.js 에서 확장 가능.
router.post('/', async (req, res, next) => {
  try {
    const { kind, source, from_name, from_email, from_company, from_phone, message } = req.body || {};

    // 검증
    if (!from_name || !String(from_name).trim()) return errorResponse(res, 'name_required', 400);
    if (!isValidEmail(from_email)) return errorResponse(res, 'valid_email_required', 400);
    if (!message || !String(message).trim()) return errorResponse(res, 'message_required', 400);
    if (String(message).length > 5000) return errorResponse(res, 'message_too_long', 400);

    const normalizedKind = VALID_KINDS.includes(kind) ? kind : 'general';

    // 선택적 인증 (토큰 있으면 연결, 없거나 유효하지 않아도 통과)
    let fromUserId = null;
    let businessId = null;
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findByPk(decoded.userId || decoded.id, { attributes: ['id', 'active_business_id'] });
        if (user) {
          fromUserId = user.id;
          businessId = user.active_business_id || null;
        }
      } catch { /* 토큰 무효는 무시하고 익명 접수 */ }
    }

    const inquiry = await ContactInquiry.create({
      kind: normalizedKind,
      source: source ? String(source).slice(0, 50) : null,
      business_id: businessId,
      from_user_id: fromUserId,
      from_name: String(from_name).trim().slice(0, 100),
      from_email: String(from_email).trim().toLowerCase().slice(0, 200),
      from_company: from_company ? String(from_company).trim().slice(0, 200) : null,
      from_phone: from_phone ? String(from_phone).trim().slice(0, 50) : null,
      message: String(message).trim(),
      status: 'new',
    });

    // 응답 최소화 — 내부 필드 노출 금지
    return successResponse(res, { id: inquiry.id, submitted_at: inquiry.created_at }, 'submitted', 201);
  } catch (err) { next(err); }
});

// ─── GET /api/inquiries/admin — 관리자 대시보드용 (platform_admin 전용) ───
router.get('/admin', authenticateToken, requireRole('platform_admin'), async (req, res, next) => {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.kind) where.kind = req.query.kind;

    const items = await ContactInquiry.findAll({
      where,
      include: [
        { model: User, as: 'fromUser', attributes: ['id', 'name', 'email'], required: false },
        { model: Business, attributes: ['id', 'brand_name', 'name'], required: false },
        { model: User, as: 'repliedBy', attributes: ['id', 'name'], required: false },
      ],
      order: [['created_at', 'DESC']],
      limit: 200,
    });
    return successResponse(res, items.map(i => i.toJSON()));
  } catch (err) { next(err); }
});

// ─── PATCH /api/inquiries/admin/:id — 상태/답변 업데이트 (platform_admin) ───
router.patch('/admin/:id', authenticateToken, requireRole('platform_admin'), async (req, res, next) => {
  try {
    const inquiry = await ContactInquiry.findByPk(req.params.id);
    if (!inquiry) return errorResponse(res, 'not_found', 404);

    const patch = {};
    if (req.body.status && ['new', 'in_progress', 'resolved', 'spam'].includes(req.body.status)) {
      patch.status = req.body.status;
    }
    if (req.body.reply_note !== undefined) {
      patch.reply_note = String(req.body.reply_note || '').slice(0, 10000);
      patch.replied_at = new Date();
      patch.replied_by_user_id = req.user.id;
    }
    await inquiry.update(patch);
    return successResponse(res, inquiry.toJSON());
  } catch (err) { next(err); }
});

module.exports = router;
