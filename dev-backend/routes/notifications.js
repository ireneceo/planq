// 알림 prefs 라우트 (Phase E4)
// GET /api/notifications/prefs — 내 워크스페이스의 prefs 매트릭스 (없으면 기본 ON)
// PUT /api/notifications/prefs — 매트릭스 업데이트 (off 만 row 생성)
// 알림 발송 시점에 isAllowed(userId, businessId, eventKind, channel) 로 차단 검사

const express = require('express');
const router = express.Router();
const { NotificationPref } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

const EVENT_KINDS = [
  // 워크스페이스 멤버 알림
  'message', 'signature', 'invoice', 'tax_invoice', 'task', 'event', 'invite',
  'mention',          // 채팅 @멘션 (사이클 N+16-C 부터 채팅 전용)
  'comment_mention',  // 업무/문서 댓글 @멘션 (사이클 N+16-C 신규)
  'share_expiry',     // N+74-B — 외부 공유 링크 만료 임박 (D-3)
  'mail',             // #203 — Q Mail 새 메일 (받을 범위는 메일 계정별 notify_scope 로 따로 고른다)
  // 플랫폼 관리자 알림 (business_id NULL row 로 저장)
  'inquiry', 'signup', 'payment', 'subscription', 'trial', 'feedback',
  'system',           // 시스템 경고 (메일 계정 sync 실패 등) — 여태 목록에 없어 끌 방법이 없었다
];
const CHANNELS = ['inbox', 'chat', 'email', 'push']; // 사이클 J4 — push 채널 추가

// GET /api/notifications/prefs?business_id=X
router.get('/prefs', authenticateToken, async (req, res, next) => {
  try {
    const businessId = req.query.business_id ? Number(req.query.business_id) : null;
    // business_id 미지정 = 전역(platform-wide, NULL row 만) — 사용자 cross-workspace 매트릭스 mix 방지
    const where = { user_id: req.user.id, business_id: businessId };
    const rows = await NotificationPref.findAll({ where });
    // 매트릭스 형태로 변환 — 기본 ON, 명시적 row 만 반영
    const matrix = {};
    for (const ev of EVENT_KINDS) {
      matrix[ev] = {};
      for (const ch of CHANNELS) matrix[ev][ch] = true; // 기본 ON
    }
    for (const r of rows) {
      if (matrix[r.event_kind]) matrix[r.event_kind][r.channel] = r.enabled;
    }
    return successResponse(res, { matrix, business_id: businessId });
  } catch (err) { next(err); }
});

// PUT /api/notifications/prefs — body: { business_id?, event_kind, channel, enabled }
router.put('/prefs', authenticateToken, async (req, res, next) => {
  try {
    const businessId = req.body?.business_id ? Number(req.body.business_id) : null;
    const eventKind = String(req.body?.event_kind || '');
    const channel = String(req.body?.channel || '');
    const enabled = !!req.body?.enabled;
    if (!EVENT_KINDS.includes(eventKind)) return errorResponse(res, 'invalid_event_kind', 400);
    if (!CHANNELS.includes(channel)) return errorResponse(res, 'invalid_channel', 400);

    const [row] = await NotificationPref.findOrCreate({
      where: {
        user_id: req.user.id,
        business_id: businessId,
        event_kind: eventKind,
        channel,
      },
      defaults: { enabled },
    });
    if (row.enabled !== enabled) await row.update({ enabled });
    return successResponse(res, { event_kind: eventKind, channel, enabled, business_id: businessId });
  } catch (err) { next(err); }
});

// 알림 발송 시점 helper — false 면 차단 (다른 모듈에서 require 시 export)
async function isAllowed(userId, businessId, eventKind, channel) {
  try {
    const row = await NotificationPref.findOne({
      where: {
        user_id: userId,
        business_id: businessId || null,
        event_kind: eventKind,
        channel,
      },
    });
    if (!row) return true; // 기본 ON
    return !!row.enabled;
  } catch { return true; }
}

router.isAllowed = isAllowed;

// 사이클 J4 — 통합 알림 헬퍼
//   notify({ userId, businessId, eventKind, title, body, link, ctaLabel, workspaceName })
//     - inbox: TodoList 가 별도 fetch (별도 처리 X)
//     - email: isAllowed('email') 통과 시 sendNotificationEmail
//     - push:  isAllowed('push')  통과 시 web push
//
// 외부 client (NotificationPref 가 없는 사람) 메일 발송은 매트릭스와 무관 —
//   전용 helper (sendInvoiceEmail / sendSignatureRequestEmail / sendPostShareEmail) 사용.
//
// 시스템 메일 (인증 OTP, 비밀번호 재설정) 도 매트릭스 무관 —
//   전용 helper (sendVerificationCodeEmail / sendSignatureOtpEmail) 사용.
// 운영 #281 — `titleSpec: { feature, action, subject }` 을 주면 제목 규약
//   (`Q Mail · 답변 필요 · 홍길동`)으로 **수신자 언어에 맞춰** 여기서 만든다.
//   왜 여기인가: notifyMany 는 여러 명에게 같은 제목을 보내므로 호출부에서는 수신자별 언어를
//   맞출 수 없다. notifyMany 가 notify 를 1인씩 부르므로 이 지점이 유일한 공통 착지점이다.
//   ★ title 은 notifications.title 에 문자열로 박제되고 push payload 로 그대로 나간다 —
//     프론트 t() 로는 번역할 수 없어서 발송 시점 해석이 유일한 방법이다.
//   titleSpec 없이 title 만 주는 옛 호출부는 그대로 동작한다(점진 전환).
async function notify({ userId, businessId, eventKind, title, titleSpec, body, link, ctaLabel, workspaceName, tag, actorUserId, entityType, entityId, ioApp, skipChannels }) {
  if (!userId || !eventKind) return { inbox: false, email: false, push: false };
  // ★ 삭제된 워크스페이스로는 아무것도 발송하지 않는다 (Fable 중요 — 중앙 fan-out 무검사).
  //   여기 한 곳이 알림·메일·푸시의 공통 착지점이라, 여기서 막으면 발송 계열이 전부 닫힌다.
  //   businessId 가 없는 플랫폼 알림(가입·문의 등)은 대상이 아니므로 통과.
  if (businessId) {
    try {
      const { Business } = require('../models');
      const alive = await Business.findOne({ where: { id: businessId, deleted_at: null }, attributes: ['id'] });
      if (!alive) return { inbox: false, email: false, push: false, skipped: 'workspace_deleted' };
    } catch (e) { console.warn('[notify workspace check]', e.message); }
  }
  const results = { inbox: false, email: false, push: false };
  if (titleSpec && titleSpec.feature && titleSpec.action) {
    try {
      const { buildTitle, recipientLang, FEATURES, ACTIONS } = require('../services/notifyTitle');
      // ★ buildTitle 은 미지 feature/action 에 **throw 하지 않고 빈 문자열**을 돌려준다.
      //   그대로 대입하면 오타 하나로 제목 없는 알림이 조용히 나간다(catch 로는 못 잡는다).
      //   그래서 ① 표에 있는지 먼저 확인하고 ② 결과가 비면 기존 title 을 지키고 ③ 오타를 로그로 드러낸다.
      if (!FEATURES[titleSpec.feature] || !ACTIONS[titleSpec.action]) {
        // ★ 둘 중 하나만 미등록이어도 대입하지 않는다. feature 만 맞으면 buildTitle 이
        //   `Q Task · 대상` 처럼 **행위 라벨이 빠진 열화 제목**을 돌려주는데, 비어 있지 않아서
        //   `if (built)` 가드는 이걸 통과시킨다 — 폴백 title 이 열화본에 덮인다(Fable 실측).
        //   비었는지가 아니라 **키가 등록됐는지**로 판정해야 폴백 보장이 성립한다.
        console.warn('[notify titleSpec] 미등록 키 — services/notifyTitle.js 표에 추가할 것:',
          titleSpec.feature, titleSpec.action, '→ 기존 title 유지');
      } else {
        const built = buildTitle({ ...titleSpec, lang: await recipientLang(userId) });
        if (built && built.trim()) title = built;
      }
    } catch (e) { console.warn('[notify titleSpec]', e.message); }   // 실패해도 기존 title 로 진행
  }
  // #203 — 호출자가 특정 채널만 끌 수 있다(사용자 설정과 별개). 메일 알림은 '확인 권장' 을
  //   이메일로 보내지 않는다 — 하루 수십 건이 메일함으로 되돌아오면 그게 스팸이다.
  const skip = new Set(Array.isArray(skipChannels) ? skipChannels : []);

  // Cue AI 팀원(is_ai)은 사람이 아니므로 어떤 채널도 알림 대상이 아니다.
  // Cue 는 합성 주소(cue+{businessId}@system.planq.kr)라 email 발송 시 바운스
  // ("Address not found") + 발신평판 훼손 → 태스크 배정·채팅 참여로 notify 가 호출돼도 skip.
  try {
    const { User } = require('../models');
    const target = await User.findByPk(userId, { attributes: ['is_ai'] });
    if (target?.is_ai) return results;
  } catch { /* 조회 실패 시 정상 흐름 유지 (기존 채널 로직이 개별 가드) */ }

  // N+63 — inbox 채널 실 처리 (알림 feed, Activity Feed). 옛 hardcoded true → 실 Notification.create.
  // NotificationPref event_kind × channel='inbox' 토글로 사용자가 받을 종류 선택 (기본 ON).
  // socket emit 'notification:new' → 좌측 사이드바 종 모양 즉시 +1.
  // N+73 — link 자동 생성 (호출자가 link 미전달 시 entity_type+entity_id 매핑)
  // N+74-D — 호출자가 절대 URL 전달 시 path 로 정규화 (옛 코드의 'https://planq.kr/...' 차단)
  const { buildLink, normalizeLink } = require('../services/notification_link');
  const normalizedFromCaller = normalizeLink(link);
  const resolvedLink = normalizedFromCaller || buildLink({ entity_type: entityType, entity_id: entityId, event_kind: eventKind });

  if (await isAllowed(userId, businessId, eventKind, 'inbox')) {
    try {
      const { Notification } = require('../models');
      const row = await Notification.create({
        user_id: userId,
        business_id: businessId || null,
        event_kind: eventKind,
        title: title || '(no title)',
        body: body || null,
        link: resolvedLink,
        cta_label: ctaLabel || null,
        actor_user_id: actorUserId || null,
        entity_type: entityType || null,
        entity_id: entityId || null,
      });
      results.inbox = !!row.id;
      // N+73 — multi-device sync. socket emit 에 full row 포함 (옛: { id, kind } 만).
      //   Toaster 가 받으면 notification_id 까지 알아 닫기 시 mark-read 호출 가능.
      //   Dropdown 은 refresh API 호출로 갱신 — 이 payload 도 옵티미스틱 prepend 에 사용 가능.
      try {
        const io = ioApp || global.__planqIo || null;
        if (io) io.to(`user:${userId}`).emit('notification:new', {
          id: row.id,
          event_kind: eventKind,
          title: row.title,
          body: row.body,
          link: row.link,
          entity_type: row.entity_type,
          entity_id: row.entity_id,
          business_id: row.business_id,
          created_at: row.createdAt || row.created_at,
        });
      } catch { /* socket emit 실패해도 row 는 저장됨 */ }
    } catch (e) {
      console.error('[notify inbox]', e.message);
    }
  }

  // email 채널
  if (!skip.has('email') && await isAllowed(userId, businessId, eventKind, 'email')) {
    try {
      const { User } = require('../models');
      const user = await User.findByPk(userId, { attributes: ['email', 'is_guest'] });
      // ★ #259 — **게스트 그림자 계정에는 메일을 보내지 않는다.**
      //   그림자 주소(guest+cN@guest.planq.kr)는 실재하지 않는다. 그리로 보내면 전부 반송되고
      //   발신 평판이 깎인다. 게스트에게 가는 알림은 별도 경로(대화 알림 메일)가
      //   Client.invite_email 로 **링크를 실어** 보낸다 — 여기서 흉내내면 링크 없는 메일이 나간다.
      //   그리고 그 메일에 내부 메모 미리보기가 실리면 그게 곧 유출이다. 두 방향 다 막는다.
      if (user?.is_guest) {
        results.email = { skipped: 'guest_shadow_account' };
      } else if (user?.email) {
        const { sendNotificationEmail } = require('../services/emailService');
        results.email = await sendNotificationEmail({
          to: user.email,
          title, body, link, ctaLabel, workspaceName,
          businessId, eventKind, recipientUserId: userId,
        });
      }
    } catch (e) {
      console.error('[notify email]', e.message);
    }
  }

  // push 채널 — tag 로 OS 알림 그룹핑 (같은 대화방 연속 메시지는 마지막 것으로 대체)
  if (!skip.has('push') && await isAllowed(userId, businessId, eventKind, 'push')) {
    try {
      const { sendPushToUser } = require('../services/push_service');
      // badge — 인박스(확인 필요) + 채팅 unread 합산. frontend useGlobalBadge 와 동일 정의.
      // 모든 알림 위치(dock 뱃지·사이드바·인박스 페이지) 가 이 합산값으로 통일.
      // 실패해도 push 는 발송 (badge 는 활성 클라이언트가 정확하게 덮어씀).
      let badge;
      try {
        if (businessId) {
          const { sequelize } = require('../config/database');
          // 1. 채팅 unread total (모든 conversation)
          const [chatRows] = await sequelize.query(
            `SELECT COUNT(m.id) AS cnt
               FROM messages m
               LEFT JOIN conversation_participants cp
                 ON cp.conversation_id = m.conversation_id AND cp.user_id = :uid
              INNER JOIN conversations c ON c.id = m.conversation_id AND c.business_id = :bid
              WHERE m.sender_id != :uid
                AND (m.is_deleted IS NULL OR m.is_deleted = 0)
                AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)`,
            { replacements: { uid: userId, bid: businessId } }
          );
          const chatUnread = Number(chatRows[0]?.cnt || 0);
          // 2. 인박스 total — /api/dashboard/todo 와 같은 정의 (cross-workspace 합산)
          //    여기선 single biz 컨텍스트라 그 biz 의 인박스 항목만 fetch.
          let inboxTotal = 0;
          try {
            // dashboard 의 todo endpoint 호출 — 같은 backend 라 localhost loopback.
            // **timeout 1.5s 강제** — hang 시 push 발송 전체가 지연되던 회귀 차단.
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 1500);
            try {
              const fetchRes = await fetch(`http://localhost:${process.env.PORT || 3003}/api/dashboard/todo?business_id=${businessId}`, {
                signal: controller.signal,
                headers: { Authorization: `Bearer ${require('jsonwebtoken').sign({id:userId,email:'sys@planq',platform_role:'business_member'}, process.env.JWT_SECRET, {expiresIn:'10s'})}` }
              });
              const j = await fetchRes.json();
              if (j.success) inboxTotal = Number(j.data?.total || 0);
            } finally {
              clearTimeout(timer);
            }
          } catch (e) { /* timeout / fetch 실패 — chatUnread 만 사용 */ }
          badge = chatUnread + inboxTotal;
        }
      } catch { /* badge 계산 실패해도 push 자체는 보냄 */ }
      const r = await sendPushToUser(userId, {
        title: title || 'PlanQ',
        body: body || '',
        link: resolvedLink,  // N+73 — inbox 채널과 같은 link (호출자 미전달 시 buildLink 적용됨)
        tag: tag || `${eventKind}:${userId}`,
        ...(badge !== undefined ? { badge } : {}),
      });
      results.push = r;
    } catch (e) {
      console.error('[notify push]', e.message);
    }
  }
  return results;
}

// 멀티 수신자용 (워크스페이스 멤버 N 명에게 한 번에)
async function notifyMany({ userIds, businessId, eventKind, title, titleSpec, body, link, ctaLabel, workspaceName, excludeUserId, tag, actorUserId, entityType, entityId, ioApp, skipChannels }) {
  const filtered = (userIds || []).filter((id) => id && id !== excludeUserId);
  const results = await Promise.all(
    filtered.map((uid) => notify({ userId: uid, businessId, eventKind, title, titleSpec, body, link, ctaLabel, workspaceName, tag, actorUserId, entityType, entityId, ioApp, skipChannels }))
  );
  return results;
}

// ─────────────────────────────────────────────
// N+63 — 인앱 알림 feed 라우트 (Notification 테이블)
// ─────────────────────────────────────────────

// GET /api/notifications?unread_only=true&limit=20&before=ISO
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const { Notification, User } = require('../models');
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const where = { user_id: req.user.id };
    if (String(req.query.unread_only) === 'true') where.read_at = null;
    if (req.query.before) {
      const d = new Date(req.query.before);
      if (!isNaN(d.getTime())) where.created_at = { [require('sequelize').Op.lt]: d };
    }
    const rows = await Notification.findAll({
      where,
      include: [{ model: User, as: 'actor', attributes: ['id', 'name', 'name_localized'], required: false }],
      order: [['created_at', 'DESC']],
      limit,
    });
    return successResponse(res, rows.map(r => r.toJSON()));
  } catch (err) { next(err); }
});

// GET /api/notifications/unread-count
router.get('/unread-count', authenticateToken, async (req, res, next) => {
  try {
    const { Notification } = require('../models');
    const n = await Notification.count({ where: { user_id: req.user.id, read_at: null } });
    return successResponse(res, { count: n });
  } catch (err) { next(err); }
});

// PATCH /api/notifications/:id/read
router.patch('/:id/read', authenticateToken, async (req, res, next) => {
  try {
    const { Notification } = require('../models');
    const row = await Notification.findOne({ where: { id: req.params.id, user_id: req.user.id } });
    if (!row) return errorResponse(res, 'not_found', 404);
    if (!row.read_at) {
      await row.update({ read_at: new Date() });
      // multi-device 동기화 — 다른 디바이스 즉시 -1
      try {
        const io = req.app.get('io');
        if (io) io.to(`user:${req.user.id}`).emit('notification:read', { id: row.id });
      } catch { /* skip */ }
    }
    return successResponse(res, { id: row.id, read_at: row.read_at });
  } catch (err) { next(err); }
});

// POST /api/notifications/read-all
router.post('/read-all', authenticateToken, async (req, res, next) => {
  try {
    const { Notification } = require('../models');
    const [affected] = await Notification.update(
      { read_at: new Date() },
      { where: { user_id: req.user.id, read_at: null } }
    );
    try {
      const io = req.app.get('io');
      if (io) io.to(`user:${req.user.id}`).emit('notification:read-all');
    } catch { /* skip */ }
    return successResponse(res, { affected });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.isAllowed = isAllowed;
module.exports.notify = notify;
module.exports.notifyMany = notifyMany;
