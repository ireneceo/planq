// Contact inquiries — Enterprise 문의·랜딩 문의하기·일반 문의 공통 접수 엔드포인트.
// POST: 공개 (인증 optional · rate limit 적용). GET/PATCH: platform_admin 전용 (관리자 대시보드).
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const { ContactInquiry, User, Business } = require('../models');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { perUserLimiter } = require('../middleware/costGuard');

const VALID_KINDS = ['enterprise', 'general', 'landing'];

// 비용폭탄 C3 — 공개 문의폼이 임의 from_email 로 Irene SMTP 자동회신을 발송 → 스팸 릴레이·발신평판 파괴.
//   전역 600/분(IP) 위에 전용 엄격 limiter: IP당 3/시간 + 10/일. 익명 접수는 유지.
const INQUIRY_MSG = '문의가 너무 자주 접수되었습니다. 잠시 후 다시 시도해주세요.';
const inquiryHourLimiter = perUserLimiter('inquiry-h', { windowMs: 60 * 60 * 1000, max: 3, message: INQUIRY_MSG });
const inquiryDayLimiter = perUserLimiter('inquiry-d', { windowMs: 24 * 60 * 60 * 1000, max: 10, message: INQUIRY_MSG });

function isValidEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
}

// ─── POST /api/inquiries — 문의 접수 (공개) ───
// 인증 토큰 있으면 사용자/워크스페이스 자동 연결, 없어도 접수 가능 (랜딩 페이지 용).
// rate-limit 은 server.js 에서 setupSecurity 로 전역 /api 100/분 적용되며,
// 이 엔드포인트 전용 추가 제한은 middleware/security.js 에서 확장 가능.
router.post('/', inquiryHourLimiter, inquiryDayLimiter, async (req, res, next) => {
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
    let fromUserTimezone = null;
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findByPk(decoded.userId || decoded.id, { attributes: ['id', 'active_business_id', 'timezone'] });
        if (user) {
          fromUserId = user.id;
          businessId = user.active_business_id || null;
          // 문의자 timezone — 활성 워크스페이스 우선, 없으면 사용자 본인 timezone, 최종 fallback null.
          // admin 페이지에서 "관리자 시간 / 문의자 시간" 양쪽 표시에 사용.
          if (businessId) {
            const biz = await Business.findByPk(businessId, { attributes: ['timezone'] });
            fromUserTimezone = biz?.timezone || user.timezone || null;
          } else {
            fromUserTimezone = user.timezone || null;
          }
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
      from_user_timezone: fromUserTimezone,
      status: 'new',
    });

    // 자동 발송 — fan-out 비동기 (응답 지연 X). best-effort.
    setImmediate(() => sendInquiryNotifications(inquiry).catch(e => {
      console.warn('[inquiries] notify failed', inquiry.id, e.message);
    }));

    // 응답 최소화 — 내부 필드 노출 금지
    return successResponse(res, { id: inquiry.id, submitted_at: inquiry.created_at }, 'submitted', 201);
  } catch (err) { next(err); }
});

// 문의 접수 후 fan-out:
//   1) 문의자에게 자동 회신 (영업일 24h 내 회신 안내)
//   2) platform_admin 사용자들에게 새 문의 알림 (notification_prefs 매트릭스 적용)
async function sendInquiryNotifications(inquiry) {
  const emailService = require('../services/emailService');
  const { notifyPlatformAdmins, APP_URL } = require('../services/platformNotify');

  // 1) 문의자 자동 회신 — 같은 from_email 로 최근 24h 내 접수 이력 있으면 skip (접수·admin 알림은 유지).
  //    비용폭탄 C3: 임의 주소 반복 접수로 Irene 발신주소가 백스캐터 스팸 릴레이가 되는 것 차단.
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const priorSameEmail = await ContactInquiry.count({
    where: { from_email: inquiry.from_email, id: { [Op.ne]: inquiry.id }, created_at: { [Op.gte]: since24h } },
  }).catch(() => 0);
  if (priorSameEmail === 0) {
    await emailService.sendInquiryReceivedEmail({
      to: inquiry.from_email,
      name: inquiry.from_name,
      message: inquiry.message,
      inquiryId: inquiry.id,
    }).catch(() => null);
  }

  // 2) platform_admin 알림 — 표준 헬퍼 경유 (relatedEntityId 추적·EmailLog 일관성)
  await notifyPlatformAdmins({
    eventKind: 'inquiry',
    title: `새 문의 #${inquiry.id} — ${inquiry.from_name}`,
    body: `${inquiry.from_company ? `[${inquiry.from_company}] ` : ''}${inquiry.from_email}\n\n${(inquiry.message || '').slice(0, 400)}${(inquiry.message || '').length > 400 ? '…' : ''}`,
    link: `${APP_URL}/admin/inquiries?inquiry=${inquiry.id}`,
    ctaLabel: '문의 보기',
    relatedEntityId: inquiry.id,
  });
}

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

// ─── GET /api/inquiries/admin/counts — 상태별 카운트 (platform_admin badge) ───
// N+63 — 좌측 메뉴 admin inbox badge 용. miss 처리 (new + in_progress) 만 count.
router.get('/admin/counts', authenticateToken, requireRole('platform_admin'), async (req, res, next) => {
  try {
    const { sequelize } = require('../config/database');
    const [rows] = await sequelize.query(
      "SELECT status, COUNT(*) AS n FROM contact_inquiries GROUP BY status"
    );
    const counts = { new: 0, in_progress: 0, resolved: 0, spam: 0 };
    for (const r of rows) {
      if (counts[r.status] !== undefined) counts[r.status] = Number(r.n);
    }
    const pending = counts.new + counts.in_progress;  // badge 표시 대상
    return successResponse(res, { counts, pending });
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
