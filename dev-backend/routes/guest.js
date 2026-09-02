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
// 카드 302 대상 주소를 만들 때 쓴다 — guest_admin 과 같은 원천.
const APP_URL = process.env.APP_URL || 'https://dev.planq.kr';

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

/** 고객에게 보여도 되는 메시지만.
 *  ★ **삭제된 메시지를 반드시 뺀다.** 처음에 이걸 빠뜨려서, 직원이 다른 고객 견적을 잘못 붙이고
 *    지웠는데 **멤버 화면에서만 사라지고 게스트 화면에는 그대로 남았다**(Fable 실증).
 *    PlanQ 의 삭제는 마스킹(soft delete)이라 행이 남는다 — 읽는 쪽이 걸러야 한다.
 *  ★ 나머지는 `conversations.js` 의 client 필터와 같은 술어다.
 */
const visibleToGuest = (m) => !m.is_deleted
  && !m.is_internal
  && !(m.is_ai && m.ai_mode_used === 'draft' && m.ai_draft_approved !== true);

/** 메시지 화이트리스트 — 내부 필드가 자동으로 따라 나가지 않게. */
const serializeMessage = (m, guestUserId, cardState) => ({
  id: m.id,
  kind: m.kind || 'text',
  content: m.content,
  created_at: m.created_at,
  is_mine: m.sender_id === guestUserId,
  // 카드(청구서·문서·업무…) — **주소는 넣지 않는다.** 누를 때 서버가 302 로만 준다.
  //   meta.share_url 은 발급 당시 스냅샷이라 이미 죽어 있는 경우가 많다(운영 8건 중 5건).
  card: m.kind === 'card' && cardState
    ? require('../services/cardResolver').summarizeCard(m.meta, cardState)
    : null,
  // 보내는 사람은 **표시명만**. 이메일·id 는 내보내지 않는다.
  //   게스트가 쓴 글은 그 행에 박제된 이름을 쓴다 — 그림자 User 이름은 "게스트" 로 고정이라
  //   이것을 안 보면 고객 화면에서 서로가 전부 "게스트" 로 보인다.
  sender_name: (m.sender?.is_guest === true && m.meta?.guest?.name) || m.sender?.name || null,
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
      // 계정 요청을 이미 보냈는가 — 화면이 배너를 "요청 보냄" 상태로 바꾼다.
      account_requested: !!link.account_requested_at,
      // 고객은 **선택**이다 (2026-09-02). 붙어 있으면 이름을 보여주고, 없으면 null —
      //   화면은 대화방 제목으로 떨어진다. 여기서 `client.display_name` 을 그냥 읽다가
      //   고객 없는 방에서 **500** 이 났다(읽는 곳 전수 확인을 빠뜨린 것).
      client_name: client ? (client.display_name || client.company_name || null) : null,
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
      // 쿼리에서 한 번, visibleToGuest 에서 또 한 번 — 둘 중 하나가 바뀌어도 안 샌다.
      where: { conversation_id: conversation.id, is_deleted: false },
      include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'is_guest'] }],
      order: [['created_at', 'DESC']],
      limit: 200,
    });
    const visible = rows.map((m) => (m.toJSON ? m.toJSON() : m))
      .filter(visibleToGuest)
      .reverse();
    // 카드 상태는 **행을 보고** 계산한다. 목록당 카드는 보통 한 자릿수라 N+1 부담이 없고,
    //   무엇보다 화면이 "왜 못 여는지" 를 말하려면 서버가 지금 상태를 알아야 한다.
    const { resolveCard } = require('../services/cardResolver');
    const states = new Map();
    for (const m of visible) {
      if (m.kind !== 'card') continue;
      const r = await resolveCard(m.meta, { businessId: conversation.business_id, appUrl: APP_URL });
      states.set(m.id, r.state);
    }
    const list = visible.map((m) => serializeMessage(m, guestUser.id, states.get(m.id)));
    return successResponse(res, list);
  } catch (err) { next(err); }
});

// ── POST /api/guest/:token/account-request ────────────────────────────────
//   게스트가 "계정 요청하기" 를 누른다. **가입 화면으로 보내지 않는다** —
//   초대 토큰 없이 가입하면 `routes/auth.js:216` 가 자기 워크스페이스를 새로 만들어
//   고객이 빈 화면에 떨어지고 이 대화는 못 본다(Fable 설계 판정 2026-09-02).
//   여기서는 **담당자에게 알림만** 보내고, 계정 생성은 멤버가 보내는 초대 메일 한 곳으로 몬다.
router.post('/:token/account-request',
  guestLimiter('guest-account-req', { windowMs: 60 * 60 * 1000, max: 5 }), attachGuest, async (req, res, next) => {
  try {
    const { link, conversation } = req.guest;
    // 링크당 1회. 24시간 지나면 다시 보낼 수 있다 — 담당자가 놓쳤을 수 있으므로 영구 차단은 아니다.
    const last = link.account_requested_at ? new Date(link.account_requested_at).getTime() : 0;
    if (last && Date.now() - last < 24 * 60 * 60 * 1000) {
      return successResponse(res, { account_requested: true }, 'already_requested');
    }
    // 이메일은 **선택**이고 힌트일 뿐이다 — 멤버가 초대할 때 바꿀 수 있다.
    //   무인증 입력이라 형식만 보고 길이를 자른다.
    let email = null;
    const rawEmail = String(req.body?.email || '').trim().slice(0, 200);
    if (rawEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) email = rawEmail;

    await link.update({ account_requested_at: new Date(), requested_email: email });

    try {
      const { notifyMany } = require('./notifications');
      const { ConversationParticipant } = require('../models');
      const parts = await ConversationParticipant.findAll({
        where: { conversation_id: conversation.id }, attributes: ['user_id', 'role'],
      });
      const memberIds = parts.filter((p) => p.role !== 'client' && p.user_id !== req.guest.guestUser.id).map((p) => p.user_id);
      if (memberIds.length) {
        await notifyMany({
          userIds: memberIds,
          businessId: conversation.business_id,
          eventKind: 'message',
          title: '고객이 계정을 요청했습니다',
          body: email
            ? `${conversation.title || '대화방'} — ${email} 로 초대해 주세요`
            : `${conversation.title || '대화방'} — 링크로 들어온 분이 계정을 요청했습니다`,
          link: `/talk?conv=${conversation.id}`,
          ctaLabel: '대화 열기',
          entityType: 'Conversation',
          entityId: conversation.id,
          ioApp: req.app,
        });
      }
    } catch (e) {
      // 알림이 실패해도 요청 자체는 기록됐다 — 게스트에게 실패로 보이면 계속 다시 누른다.
      console.error('[guest] account-request notify 실패:', e.message);
    }
    return successResponse(res, { account_requested: true }, 'requested');
  } catch (err) { next(err); }
});

// ── GET /api/guest/:token/cards/:messageId/open ───────────────────────────
//   카드를 **누를 때** 서버가 지금 주소를 해석해 302 로 보낸다.
//   응답 JSON 에 토큰을 실어 보내지 않는 이유는 cardResolver 파일 주석 참조.
//   실패는 전부 404 — 왜 실패했는지 게스트에게 알려 주면 그것이 곧 정찰 수단이 된다.
router.get('/:token/cards/:messageId/open',
  guestLimiter('guest-card-open', { windowMs: 60 * 1000, max: 60 }), attachGuest, async (req, res, next) => {
  try {
    const { link, conversation } = req.guest;
    const msg = await Message.findOne({
      where: { id: Number(req.params.messageId) || 0, conversation_id: conversation.id, is_deleted: false },
    });
    if (!msg || msg.kind !== 'card') return errorResponse(res, 'not_found', 404);
    // 목록에서 거른 것과 **같은 술어**를 다시 태운다 — 링크로 직접 두드리는 경로를 막는다.
    if (!visibleToGuest(msg.toJSON ? msg.toJSON() : msg)) return errorResponse(res, 'not_found', 404);

    const { resolveCard } = require('../services/cardResolver');
    const r = await resolveCard(msg.meta, { businessId: conversation.business_id, appUrl: APP_URL });
    if (r.state !== 'ok' || !r.url) return errorResponse(res, 'not_found', 404);

    // 사용 기록 — 열람도 사용이다(슬라이딩 만료가 뒤로 밀린다).
    await link.update({ last_used_at: new Date() }).catch(() => null);
    // 헤더만 보낸다 — Express 기본 302 본문(`Found. Redirecting to <url>`)에 토큰이 한 번 더 실린다.
    //   Location 과 같은 값이라 새 노출은 아니지만, 내보낼 이유도 없다.
    return res.status(302).set('Location', r.url).end();
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

    // ── 게스트가 스스로 정하는 표시명 (선택) ──────────────────────────────
    //   무인증 입력이다. 프론트 정화기를 믿지 않는다 — 본문과 같은 원칙.
    //   비어 있으면 null → 화면은 "게스트" 로 그린다.
    let guestDisplayName = null;
    const rawName = req.body?.guest_name;
    if (rawName != null) {
      const n = String(rawName)
        .replace(/<[^>]*>/g, '')             // 태그
        .replace(/[\u0000-\u001F\u007F]/g, '')  // 제어문자
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 30);                        // 30자 캡
      if (n) {
        // 사칭 차단 — 우리 쪽 사람으로 보이는 이름은 거절한다. 뱃지가 최종 방어지만
        //   "PlanQ 관리자" 가 이름으로 통과하면 뱃지를 못 본 사람에게는 통한다.
        const RESERVED = ['planq', 'cue', '관리자', 'admin', '운영자', '담당자'];
        const low = n.toLowerCase();
        if (RESERVED.some((w) => low.includes(w))) return errorResponse(res, 'name_reserved', 400);
        guestDisplayName = n;
      }
    }
    const msg = await Message.create({
      conversation_id: conversation.id,
      sender_id: guestUser.id,   // 그림자 User — sender_id 는 NOT NULL 이다
      content: cleaned,
      kind: 'text',
      is_ai: false,
      is_internal: false,        // ★ 게스트는 내부 메모를 만들 수 없다. 하드코딩이다
      // ★ 표시명은 **이 행에 박제**한다 (2026-09-02).
      //   한 링크를 여럿이 나눠 갖는 것이 이 기능의 전제라(설계 §2), 이름을 링크나 그림자 User 에
      //   두면 **나중 사람이 이름을 정하는 순간 과거 메시지의 이름까지 소급해서 바뀐다.**
      //   신원(누가 썼나) = 링크의 그림자 User, 라벨(뭐라고 보이나) = 이 값. 둘을 갈라 둔다.
      //   link_id 는 §8 승격(이 링크 발 메시지만 이관)의 열쇠이기도 하다.
      //   이름이 없으면 키 자체를 넣지 않는다 — JSON null 은 읽는 쪽에서 문자열 'null' 로
      //   새어 나갈 자리를 만든다(실측: 목록 미리보기에 "null" 이 이름으로 떴다).
      meta: { guest: guestDisplayName ? { link_id: link.id, name: guestDisplayName } : { link_id: link.id } },
    });
    await conversation.update({ last_message_at: new Date() });
    await link.increment('message_count');

    // 실시간 반영 — 멤버 Q Talk 이 즉시 본다 (CLAUDE.md 운영 안정성 §16).
    const full = await Message.findByPk(msg.id, {
      include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'email', 'name_localized', 'is_guest'] }],
    });
    const io = req.app.get('io');
    if (io && full) {
      const payload = full.toJSON();
      // 표시명은 REST 와 **같은 헬퍼**로 바꾼다 — 경로마다 따로 쓰면 반드시 갈라진다.
      require('../services/displayName').applyGuestDisplayName(payload);
      payload.via_guest_link = true;   // (옛 필드 — 뱃지 근거는 sender.is_guest 다)
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
          // link.guest_name 은 멤버 메모용이라 대개 비어 있다. 이 글을 쓴 사람의 이름을 쓴다.
          title: `${guestDisplayName || link.guest_name || '게스트'} (게스트)`,
          // 정화 전 raw 가 아니라 태그를 걷어낸 cleaned 를 넣는다 — 알림은 메일·inbox·push 로
          //   퍼지고 그중 하나만 HTML 로 렌더하면 무인증 입구가 그대로 통로가 된다 (#259).
          body: cleaned.length > 140 ? cleaned.slice(0, 140) + '…' : cleaned,
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
