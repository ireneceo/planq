// routes/guest.js — 무로그인 게스트 공개 라우트 (운영 #259)
//
// ★ **인증이 없는 표면이다.** 여기 있는 모든 라우트는 토큰 하나로 열린다.
//   그래서 규칙이 셋이다:
//     ① 토큰 해석은 services/guest_link.js 의 resolveGuestToken **하나만** 쓴다.
//        여기서 직접 조회하면 만료·회수·킬스위치 검사 중 하나를 빠뜨린 곳이 생긴다.
//     ② 내보내는 필드는 **화이트리스트**다. exclude 목록이 아니라 include 목록 —
//        나중에 컬럼이 늘어도 자동으로 새지 않는다.
//     ③ 못 찾겠으면 전부 404. 403 을 주면 "그 토큰은 있는데 권한이 없다" 가 새어 나간다.
//
// 설계: docs/GUEST_LINK_DESIGN.md
const express = require('express');
const router = express.Router();
const { Message, User, Conversation, Project } = require('../models');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const rateLimit = require('express-rate-limit');
const { resolveGuestToken } = require('../services/guest_link');

// 게스트 rate-limit — **토큰을 키로 쓴다.** 인증이 없어 req.user 가 없고, IP 는 NAT·모바일망에서
//   여러 고객이 한 덩어리로 뭉친다(한 사람이 남을 잠근다).
//   ★ costGuard 의 perUserLimiter 는 keyGenerator 를 **인자로 받지 않는다** — 넘겨도 조용히
//     무시되고 IP 키로 떨어진다. 그래서 여기서 직접 만든다.
const guestLimiter = (name, { windowMs, max }) => rateLimit({
  windowMs,
  max,
  keyGenerator: (req) => `${name}-${String(req.params.token || '').slice(0, 32)}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'too_many_requests' },
});

/** 토큰을 풀어 req.guest 에 담는다. 실패하면 **무조건 404**. */
async function attachGuest(req, res, next) {
  const ctx = await resolveGuestToken(req.params.token, {
    touch: true,
    ip: req.headers['x-forwarded-for'] || req.ip,
  });
  if (!ctx) return errorResponse(res, 'not_found', 404);
  req.guest = ctx;
  next();
}

/** 고객에게 보여도 되는 메시지만. `conversations.js:619-623` 과 **같은 술어**다. */
const visibleToGuest = (m) => !m.is_internal
  && !(m.is_ai && m.ai_mode_used === 'draft' && m.ai_draft_approved !== true);

/** 메시지 화이트리스트 — 내부 필드가 자동으로 따라 나가지 않게. */
const serializeMessage = (m, guestUserId) => ({
  id: m.id,
  content: m.content,
  created_at: m.created_at,
  is_mine: m.sender_id === guestUserId,
  // 보내는 사람은 **표시명만**. 이메일·id 는 내보내지 않는다.
  sender_name: m.sender?.name || null,
});

// ── GET /api/guest/:token — 대화방 컨텍스트 ────────────────────────────────
router.get('/:token', guestLimiter('guest-ctx', { windowMs: 60 * 1000, max: 60 }), attachGuest, async (req, res, next) => {
  try {
    const { link, conversation, guestUser, client } = req.guest;
    // ★ 이미지 신원 — 보안 Stage 2 가 켜지면 이미지 접근이 canAccessConversation 판정이 된다.
    //   게스트는 **열람만 해도** 신원이 있어야 그 문을 지난다. 여기서 쿠키를 준다.
    try { require('../services/authTokens').setImageCookie(res, { id: guestUser.id }); } catch { /* 이미지 없이도 화면은 떠야 한다 */ }

    let project = null;
    if (link.project_id) {
      const p = await Project.findByPk(link.project_id);
      // 다른 워크스페이스 프로젝트면 없는 것으로 친다(테넌트 이중 검증).
      if (p && p.business_id === link.business_id) {
        // ★ 화이트리스트 — loadProjectDetail 을 재사용하지 않는다. 그건 멤버 이메일까지 담는다.
        project = {
          name: p.name,
          description: p.description || null,
          status: p.status || null,
          start_date: p.start_date || null,
          end_date: p.end_date || null,
        };
      }
    }
    return successResponse(res, {
      guest_name: link.guest_name,
      can_write: !!link.can_write,
      client_name: client.display_name || client.company_name || null,
      conversation: { id: conversation.id, title: conversation.title || null },
      project,
    });
  } catch (err) { next(err); }
});

// ── GET /api/guest/:token/messages ────────────────────────────────────────
router.get('/:token/messages', guestLimiter('guest-msgs', { windowMs: 60 * 1000, max: 120 }), attachGuest, async (req, res, next) => {
  try {
    const { conversation, guestUser } = req.guest;
    const rows = await Message.findAll({
      where: { conversation_id: conversation.id },
      include: [{ model: User, as: 'sender', attributes: ['id', 'name'] }],
      order: [['created_at', 'DESC']],
      limit: 200,
    });
    const list = rows.map((m) => (m.toJSON ? m.toJSON() : m))
      .filter(visibleToGuest)
      .reverse()
      .map((m) => serializeMessage(m, guestUser.id));
    return successResponse(res, list);
  } catch (err) { next(err); }
});

// ── POST /api/guest/:token/messages ───────────────────────────────────────
//   게스트가 글을 쓴다. **텍스트만** — 파일 업로드는 2단계(쿼터·악성파일 축이 별도 설계).
router.post('/:token/messages', guestLimiter('guest-send', { windowMs: 60 * 1000, max: 10 }), attachGuest, async (req, res, next) => {
  try {
    const { link, conversation, guestUser } = req.guest;
    if (!link.can_write) return errorResponse(res, 'read_only_link', 403);
    const raw = String(req.body?.content || '').trim();
    if (!raw) return errorResponse(res, 'content_required', 400);
    if (raw.length > 4000) return errorResponse(res, 'content_too_long', 400);

    // ★ 무인증 표면이다 — 기존 메시지 라우트는 문자열을 그대로 저장하지만(프론트가 렌더 시 정화),
    //   여기는 아무나 쓸 수 있으므로 **태그를 아예 걷어낸다.** 게스트는 서식이 필요 없다.
    //   프론트 정화기를 믿고 원문을 넣으면, 그 정화기가 한 번 무너질 때 이 입구가 통로가 된다.
    const cleaned = raw.replace(/<[^>]*>/g, '').slice(0, 4000);
    if (!cleaned.trim()) return errorResponse(res, 'content_required', 400);
    const msg = await Message.create({
      conversation_id: conversation.id,
      sender_id: guestUser.id,   // 그림자 User — sender_id 는 NOT NULL 이다
      content: cleaned,
      kind: 'text',
      is_ai: false,
      is_internal: false,        // ★ 게스트는 내부 메모를 만들 수 없다. 하드코딩이다
    });
    await conversation.update({ last_message_at: new Date() });
    await link.increment('message_count');

    // 실시간 반영 — 멤버 Q Talk 이 즉시 본다 (CLAUDE.md 운영 안정성 §16).
    const full = await Message.findByPk(msg.id, {
      include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'email', 'name_localized'] }],
    });
    const io = req.app.get('io');
    if (io && full) {
      const payload = full.toJSON();
      payload.via_guest_link = true;   // 화면이 "게스트" 뱃지를 그릴 근거
      io.to(`conv:${conversation.id}`).emit('message:new', payload);
      io.to(`business:${conversation.business_id}`).emit('message:new', payload);
    }

    // 멤버에게 알림 — 게스트가 글을 썼는데 아무도 모르면 이 기능은 무용지물이다.
    try {
      const { notifyMany } = require('./notifications');
      const { ConversationParticipant } = require('../models');
      const parts = await ConversationParticipant.findAll({
        where: { conversation_id: conversation.id },
        attributes: ['user_id', 'role'],
      });
      const memberIds = parts.filter((p) => p.role !== 'client' && p.user_id !== guestUser.id).map((p) => p.user_id);
      if (memberIds.length) {
        await notifyMany({
          userIds: memberIds,
          businessId: conversation.business_id,
          eventKind: 'message',
          title: `${link.guest_name} (게스트)`,
          body: raw.length > 140 ? raw.slice(0, 140) + '…' : raw,
          link: `/talk?conv=${conversation.id}`,
          ctaLabel: '대화 열기',
          entityType: 'Conversation',
          entityId: conversation.id,
          ioApp: req.app,
        });
      }
    } catch (e) { console.warn('[guest] notify 실패:', e.message); }

    return successResponse(res, { id: msg.id, created_at: msg.created_at }, 'sent', 201);
  } catch (err) { next(err); }
});

module.exports = router;
