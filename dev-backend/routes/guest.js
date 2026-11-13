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
const { Op } = require('sequelize');
const express = require('express');
const router = express.Router();
const { Message, User, Conversation, Project } = require('../models');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
// 카드 302 대상 주소를 만들 때 쓴다 — guest_admin 과 같은 원천.
const APP_URL = process.env.APP_URL || 'https://dev.planq.kr';

const { guestLimiter, attachGuest, requireRoom } = require('./guest_common');

/** 고객에게 보여도 되는 메시지만 — **정의는 services/guest_link.js 한 곳**이다.
 *  ★ 여기 있던 술어를 서비스로 옮겼다. 답글 알림(services/guest_notify.js)이 같은 판단을
 *    해야 하는데, 베껴 두면 반드시 갈라진다 — 갈라지는 순간 **지운 메시지·내부 메모로
 *    알림 메일이 나간다.** 주석으로 "같은 술어" 라고 쓰는 것은 검증되지 않는다(실사례 있음).
 */
const { visibleToGuest } = require('../services/guest_link');

/** 메시지 화이트리스트 — 내부 필드가 자동으로 따라 나가지 않게. */
const serializeMessage = (m, guestUserId, cardState, partyNames) => ({
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
  //   게스트가 아닌 사람(멤버·고객)은 services/guestParty.js **한 술어**로 — 워크스페이스가 멤버 이름을
  //   숨기면 워크스페이스 이름이 나간다(§A). 옛 `m.sender.name` 은 스위치를 모른다.
  sender_name: m.sender?.is_guest === true
    ? (m.meta?.guest?.name || m.sender.name || null)
    : ((m.sender && partyNames) ? (partyNames.get(m.sender.id) || null) : null),
  attachments: Array.isArray(m.attachments) ? m.attachments.map(require('../services/guestAttachment').serializeGuestAttachment) : [],
});

// 답글 알림 신청 (#259 A안) — 별도 파일. `/:token/notify/*` 만 가져간다.
router.use(require('./guest_subscribe'));
// 첨부 — 사진·PDF 보내기(`/:token/messages/upload`)와 토큰 아래 미리보기(`/:token/attachments/:id/preview`). docs/GUEST_UPLOAD_DESIGN.md
router.use(require('./guest_attachments'));
// 프로젝트 탭(업무·문서·파일) — scope='project' 링크만 여는 라우트. 파일이 갈라져 있어야
//   "어느 라우트가 무엇을 여는가" 가 눈에 보인다(무인증 표면).
router.use(require('./guest_project'));
// 인증이 필요한 유일한 게스트 라우트 — Smart Routing(앱에서 열기). 파일로 갈라 둔다.
router.use(require('./guest_auth'));
// 상담 예약(창구 P2) — `/:token/booking/*` 만 가져간다. 판정은 services/booking.js 한 곳.
router.use(require('./guest_booking'));

const SYMBOL_PATH = /^\/api\/businesses\/symbol\/[0-9a-f-]+\.(png|jpe?g|gif|webp|svg)$/i;
const workspaceOf = (b) => (b ? {
  name: b.brand_name || b.name || null,
  logo_url: b.brand_logo_url && SYMBOL_PATH.test(b.brand_logo_url) ? b.brand_logo_url : null,
} : null);

/** 외부 주소는 https 만, 길이 제한. 공개 화면에 임의 스킴(`javascript:`·`data:`)을 그리지 않는다. */
const httpsUrl = (v) => {
  const s = String(v || '').trim().slice(0, 500);
  if (!s) return null;
  try { return new URL(s).protocol === 'https:' ? s : null; } catch { return null; }
};

/**
 * 워크스페이스 창구(scope='workspace')의 **안내 탭** 자료 — §4.2.
 *
 * ★ **화이트리스트다.** 여기 적힌 것만 나간다. 담는 것은 워크스페이스가 이미 고객에게
 *   내보내고 있는 값들이다 — 전화·이메일·주소·홈페이지는 청구서·계약서에 인쇄되어
 *   고객 손에 들어가는 것과 **같은 컬럼**이다(models/Business.js 법인 정보 블록).
 * ★ **담지 않는 것과 이유**(무인증 응답이다):
 *   · `legal_name`·`tax_id`·`representative`·`biz_type`·`biz_item` — 증빙용이고 창구에 쓸 데가 없다
 *   · `slug`·`id`·요금제·멤버 수 — 열거·정찰 재료
 *   · `work_hours` — 컬럼에 **정해진 모양이 없다**(`routes/businesses.js:744` 가 `req.body` 를
 *     그대로 저장하고, 읽는 곳이 0곳이다). 원문을 무인증으로 내보내면 멤버가 적어 넣은
 *     아무 JSON 이 그대로 나간다. 모양은 **P2(예약 슬롯 계산)가 정의**하고 그때 같이 싣는다.
 */
function entryOf(b) {
  if (!b) return null;
  const p = b.permissions && typeof b.permissions === 'object' ? b.permissions : {};
  const ce = p.customer_entry && typeof p.customer_entry === 'object' ? p.customer_entry : {};
  const str = (v, max) => {
    const s2 = typeof v === 'string' ? v.trim() : '';
    return s2 ? s2.slice(0, max) : null;
  };
  return {
    tagline: str(b.brand_tagline, 200),
    intro: str(ce.intro, 2000),
    services: Array.isArray(ce.services)
      ? ce.services.map((s2) => str(s2, 120)).filter(Boolean).slice(0, 6)
      : [],
    contact: {
      phone: str(b.phone, 50),
      email: str(b.email, 200),
      website: httpsUrl(b.website),
      address: str(b.address, 500),
    },
    // 상담 예약 탭을 보일지·한 번 길이 — **두 값만.** 담당 멤버·하루 상한·리드타임은 싣지 않는다
    //   (무인증 응답이고, 화면은 슬롯 API 가 준 시각만 있으면 된다).
    booking: (() => {
      const bk = require('../services/booking').bookingOf(b);
      return { enabled: bk.enabled, duration_minutes: bk.duration };
    })(),
  };
}

// ── GET /api/guest/:token — 대화방 컨텍스트 ────────────────────────────────
router.get('/:token', guestLimiter('guest-ctx', { windowMs: 60 * 1000, max: 60 }), attachGuest, async (req, res, next) => {
  try {
    const { link, conversation, guestUser, client, business } = req.guest;
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

        // ── 진행 상황 — **프로젝트 링크(scope='project')일 때만** ────────────────
        //   ★ scope 를 안 보면 **이미 나가 있는 채팅 링크가 조용히 넓어진다**
        //     (docs/PROJECT_EXTERNAL_VIEW_DESIGN.md §2.2). 채팅 링크는 예나 지금이나
        //     프로젝트 이름·설명·상태·기간 5필드만 본다 — 그 화면의 문구가 다시 참이 된다.
        //   숫자와 라벨만 내보낸다. 업무 제목·담당자는 업무 탭 라우트(/tasks)의 몫이다.
        if (link.scope === 'project') {
          const { ProjectStage, Task } = require('../models');

          // 거래 단계 — 라벨·종류·상태만. linked_entity_id 같은 내부 키는 내보내지 않는다.
          const stageRows = await ProjectStage.findAll({
            where: { project_id: p.id },
            attributes: ['order_index', 'kind', 'label', 'status'],
            order: [['order_index', 'ASC']],
            limit: 30,
          });
          project.stages = stageRows.map((s2) => ({
            kind: s2.kind, label: s2.label, status: s2.status,
          }));

          // 업무 — 개요에는 **숫자만**.
          const [taskTotal, taskDone] = await Promise.all([
            // 업무 탭(guest_project)과 같은 집합이어야 숫자가 목록과 맞는다 — 공개 범위·보안등급 같은 조건.
            Task.count({ where: { project_id: p.id, business_id: link.business_id, security_level: 'general', [Op.and]: [require('../middleware/access_scope').taskRelationOpenWhere()] } }),
            Task.count({ where: { project_id: p.id, business_id: link.business_id, security_level: 'general', status: 'completed', [Op.and]: [require('../middleware/access_scope').taskRelationOpenWhere()] } }),
          ]);
          project.task_summary = { total: taskTotal, completed: taskDone };
        }
      }
    }
    return successResponse(res, {
      // ★ 화면이 이 값으로 프로젝트 페이지와 채팅 페이지를 가른다. 없으면 옛 링크가 옛 화면으로 간다.
      scope: link.scope || 'conversation',
      guest_name: link.guest_name,
      can_write: !!link.can_write,
      // 사진·PDF 보내기 — 화면은 이 값만 쓴다(숫자 하드코딩 금지). 방이 있고 쓸 수 있고 스위치가 켜져 있을 때만.
      upload: require('./guest_attachments').uploadInfo(req.guest),
      // 계정 요청을 이미 보냈는가 — 화면이 배너를 "요청 보냄" 상태로 바꾼다.
      account_requested: !!link.account_requested_at,
      // 고객은 **선택**이다 (2026-09-02). 붙어 있으면 이름을 보여주고, 없으면 null —
      //   화면은 대화방 제목으로 떨어진다. 여기서 `client.display_name` 을 그냥 읽다가
      //   고객 없는 방에서 **500** 이 났다(읽는 곳 전수 확인을 빠뜨린 것).
      client_name: client ? (client.display_name || client.company_name || null) : null,
      // ★ 워크스페이스 창구(scope='workspace')의 공유 링크에는 방이 **없다** — null 이다.
      //   방은 이메일을 확인한 뒤 개인 링크마다 생긴다. 화면은 이 값으로 «대화를 쓸 수 있는가» 를 안다.
      conversation: conversation ? { id: conversation.id, title: conversation.title || null } : null,
      project,
      // 누가 보낸 링크인가 — 게스트 화면 밴드1 에 이름·로고(docs/CLIENT_ENTRY_DESIGN.md P0-①).
      //   ★ **두 필드만.** `business_id`·slug·법인·연락처·요금은 싣지 않는다(무인증 응답이다).
      //   로고는 우리 심볼 경로(이미 무인증 공개, UUID)일 때만 — 임의 외부 주소를 공개 화면에
      //   그대로 그리면 보는 사람의 IP 가 제3자에게 간다.
      workspace: workspaceOf(business),
      // ★ 창구(scope='workspace')에서만 «안내 탭» 자료가 실린다. 다른 scope 에서는 **키 자체가 없다** —
      //   옛 채팅·프로젝트 링크의 응답이 바이트 그대로여야 한다(설계 §5 P1 양성 대조군).
      ...(link.scope === 'workspace' ? { entry: entryOf(business) } : {}),
    });
  } catch (err) { next(err); }
});

// ── GET /api/guest/:token/messages ────────────────────────────────────────
router.get('/:token/messages', guestLimiter('guest-msgs', { windowMs: 60 * 1000, max: 120 }), attachGuest, requireRoom, async (req, res, next) => {
  try {
    const { conversation, guestUser } = req.guest;
    const rows = await Message.findAll({
      // 쿼리에서 한 번, visibleToGuest 에서 또 한 번 — 둘 중 하나가 바뀌어도 안 샌다.
      where: { conversation_id: conversation.id, is_deleted: false },
      include: [
        { model: User, as: 'sender', attributes: ['id', 'name', 'is_guest'] },
        // 첨부 — 모양은 services/guestAttachment 화이트리스트(영구 공개 주소를 싣지 않는다, docs/GUEST_UPLOAD_DESIGN.md §1)
        { model: require('../models').MessageAttachment, as: 'attachments', attributes: ['id', 'file_name', 'file_size', 'mime_type', 'file_path', 'storage_provider', 'external_id'], required: false },
      ],
      order: [['created_at', 'DESC'], ['id', 'DESC']],   // 같은 초(전달 묶음)는 id 로
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
    const senderIds = visible.filter((m) => m.sender && m.sender.is_guest !== true).map((m) => m.sender.id);
    const partyNames = await require('../services/guestParty')
      .guestPartyLabels(conversation.business_id, senderIds, { surface: 'chat' });
    const list = visible.map((m) => serializeMessage(m, guestUser.id, states.get(m.id), partyNames));
    return successResponse(res, list);
  } catch (err) { next(err); }
});

// ── POST /api/guest/:token/account-request ────────────────────────────────
//   게스트가 "계정 요청하기" 를 누른다. **가입 화면으로 보내지 않는다** —
//   초대 토큰 없이 가입하면 `routes/auth.js:216` 가 자기 워크스페이스를 새로 만들어
//   고객이 빈 화면에 떨어지고 이 대화는 못 본다(Fable 설계 판정 2026-09-02).
//   여기서는 **담당자에게 알림만** 보내고, 계정 생성은 멤버가 보내는 초대 메일 한 곳으로 몬다.
router.post('/:token/account-request',
  guestLimiter('guest-account-req', { windowMs: 60 * 60 * 1000, max: 5 }), attachGuest, requireRoom, async (req, res, next) => {
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
      // 스코프 — 이 방(conversation)은 **링크가 정한다**(attachGuest 가 토큰 → link → 방).
      //   링크에는 business_id 가 박혀 있으므로 이 목록은 그 워크스페이스 안이다.
      //   참가자 테이블에는 business_id 컬럼이 없어 조건으로 다시 걸 수 없다 — 아래 알림도
      //   conversation.business_id 로 보낸다.
      const parts = await ConversationParticipant.findAll({
        where: { conversation_id: conversation.id }, attributes: ['user_id', 'role'],
      });
      const memberIds = parts.filter((p) => p.role !== 'client' && p.user_id !== req.guest.guestUser.id).map((p) => p.user_id);
      if (memberIds.length) {
        await notifyMany({
          userIds: memberIds,
          businessId: conversation.business_id,
          eventKind: 'message',
          // ★ 제목은 수신자 언어로 발송 시점에 만든다(notifyTitle 규약, 2026-10-08 0-I) — 옛: 한국어 문장 박제.
          titleSpec: { feature: 'chat', action: 'chat_account_request', subject: conversation.title || '' },
          body: email || null,
          link: `/talk?conv=${conversation.id}`,
          entityType: 'Conversation',
          entityId: conversation.id,
          ioApp: req.app,
          // 계정 요청은 «글이 올라왔다» 가 아니라 처리할 일이다 — 대화방 알림을 꺼도 온다(docs/QTALK_MUTE_DESIGN.md §3-3).
          ignoreMute: true,
        });
      }
      // Q sale — 이 링크에 고객이 붙어 있으면 **담당자에게** 영업 알림으로도 간다(대화방 참가자 알림과 별개).
      //   담당이 없거나 떠난 사람이면 owner·admin 에게 — services/saleNotify 가 귀속 규칙을 쥔다.
      if (link.client_id) {
        const { notifyAccountRequestedByClientId } = require('../services/saleNotify');
        await notifyAccountRequestedByClientId({
          businessId: conversation.business_id,
          clientId: link.client_id,
          requestedEmail: email,
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
  guestLimiter('guest-card-open', { windowMs: 60 * 1000, max: 60 }), attachGuest, requireRoom, async (req, res, next) => {
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
router.post('/:token/messages', guestLimiter('guest-send', { windowMs: 60 * 1000, max: 10 }), attachGuest, requireRoom, async (req, res, next) => {
  try {
    const { link } = req.guest;
    if (!link.can_write) return errorResponse(res, 'read_only_link', 403);
    // 정화·표시명·생성·소켓·알림은 사진 보내기와 **한 함수**(services/guestMessage) — 베끼면 갈라진다.
    const { createGuestMessage, cleanGuestContent, cleanGuestName } = require('../services/guestMessage');
    const raw = String(req.body?.content || '').trim();
    if (!raw) return errorResponse(res, 'content_required', 400);
    if (raw.length > 4000) return errorResponse(res, 'content_too_long', 400);
    const cleaned = cleanGuestContent(raw);
    if (!cleaned.trim()) return errorResponse(res, 'content_required', 400);
    const nm = cleanGuestName(req.body?.guest_name);
    if (nm.error) return errorResponse(res, nm.error, 400);
    const { msg } = await createGuestMessage({ guest: req.guest, content: cleaned, guestName: nm.name, app: req.app });
    return successResponse(res, { id: msg.id, created_at: msg.created_at }, 'sent', 201);
  } catch (err) { next(err); }
});

module.exports = router;
// P3 로그인 고객 홈이 **같은 화이트리스트**를 쓴다(routes/client_home.js) — 베끼면 갈라진다.
module.exports.entryOf = entryOf;
module.exports.workspaceOf = workspaceOf;
