// routes/guest_inquiry.js — 창구 링크(scope='workspace')로 들어온 **문의 폼 접수** (2026-11-20)
//
//   설계: docs/WORKSPACE_PUBLIC_PAGE_DESIGN.md §5 · §10 P2
//
// ★ **인증이 없는 표면이다.** guest.js 와 같은 규칙 — 토큰은 guest_common.attachGuest 하나로 푼다(실패 = 404).
//   창구 링크(공유·개인)만 받는다 — 대화방·프로젝트 링크로는 404(여는 것의 상한 = scope).
// ★ 판정·저장은 services/workspaceInquiry.submit **한 함수**(P3 공개 주소 문과 같은 것).
// ★ IP 한도는 랜딩 문의와 같은 값(시간당 3 · 하루 10) — 실패한 시도도 센다.
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { guestLimiter, attachGuest } = require('./guest_common');
const { submit, InquiryError } = require('../services/workspaceInquiry');

const ipHour = rateLimit({
  windowMs: 60 * 60 * 1000, max: 3, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (r) => `wsinq-h-${ipKeyGenerator(r.ip)}`,
  message: { success: false, message: 'too_many_requests' },
});
const ipDay = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (r) => `wsinq-d-${ipKeyGenerator(r.ip)}`,
  message: { success: false, message: 'too_many_requests' },
});

// ── POST /:token/inquiries ─────────────────────────────────────────────────
// audit-exempt: 감사는 접수 함수 안에서 한다 — services/workspaceInquiry.submit 의 createAuditLog(inquiry.receive). 두 문(창구·공개 주소)이 같은 곳을 지난다
router.post('/:token/inquiries',
  guestLimiter('guest-inquiry', { windowMs: 60 * 60 * 1000, max: 30 }), ipHour, ipDay, attachGuest,
  async (req, res, next) => {
    try {
      const { link, business } = req.guest;
      if (link.scope !== 'workspace') return errorResponse(res, 'not_found', 404);
      await submit({
        business, via: 'entry_link', input: req.body,
        ip: req.ip, locale: req.body && req.body.locale, ioApp: req.app,
      });
      // 봇이어도 같은 모양으로 답한다 — 봇에게 «걸렸다» 는 신호를 주지 않는다(id 없음)
      return successResponse(res, { received: true }, 'received', 201);
    } catch (e) {
      if (e instanceof InquiryError) return errorResponse(res, e.code, e.status);
      return next(e);
    }
  });

module.exports = router;
