// services/guest_notify.js — 게스트 답글 알림의 **단일 착지점** (#259 A안, 설계 §13)
//
// ★ 처음 설계는 "메시지를 만드는 라우트 두 곳에서 부른다" 였다. 실제로 게스트에게 보이는
//   메시지를 만드는 곳은 **여덟 곳이 넘는다** — 대화 라우트 둘, Cue 자동응답, 청구서 발송,
//   문서·공유·서명 카드. 게다가 **초안 승인**은 생성이 아니라 update 로 "보이게" 된다.
//   부르는 곳을 세는 방식은 새 경로가 생길 때마다 조용히 빠진다. 그래서 착지점을
//   **Message 훅 한 곳**으로 둔다 — 보이게 된 순간이 곧 트리거다.
//
// ★ 훅은 트랜잭션 안에서 돈다. 여기서 DB·메일을 붙잡으면 저장이 통째로 느려진다
//   (실사례: 훅이 트랜잭션을 안 물어 매 저장 50초). 그래서 **커밋된 뒤**(afterCommit)
//   그리고 응답을 보낸 뒤(setImmediate) 움직인다. 실패해도 메시지 저장에는 영향이 없다.
const { Op } = require('sequelize');
const { isVisibleToClient } = require('../utils/messageVisibility');
const { NOTIFY_COOLDOWN_MS, personalTokenFor } = require('./guest_link');

// 지금 화면을 보고 있는 사람에게는 메일을 보내지 않는다. 폴링이 last_used_at 을 갱신하므로
//   이 값이 최근이면 그 사람은 지금 대화를 열고 있다.
const ACTIVE_WINDOW_MS = 3 * 60 * 1000;

/**
 * 이 메시지로 알림을 받을 개인 링크들에게 메일을 보낸다.
 *
 * 보내지 **않는** 경우 — 하나라도 걸리면 그 사람에게는 안 간다:
 *   · 고객에게 보이지 않는 메시지(삭제·내부 메모·미승인 초안) — 술어는 정본 하나
 *   · 보낸 사람이 게스트 — ★ 그렇지 않으면 링크를 아는 익명 아무나 글을 써서
 *     등록자 전원에게 메일을 강제로 쏠 수 있다(하루 96통 × 인원)
 *   · 확인 안 됨 / 수신거부 / 회수 / 만료
 *   · 15분 안에 이미 보냈음 / 방금 그 대화를 보고 있었음
 */
async function notifyGuestsOfReply(message) {
  const { GuestLink, User, Conversation, Business } = require('../models');
  try {
    if (!message || !message.conversation_id) return 0;
    if (!isVisibleToClient(message)) return 0;

    // 보낸 사람이 게스트면 알림 없음. 사람이 없는 발신(시스템 카드)은 sender_id 가 멤버다.
    const sender = await User.findByPk(message.sender_id, { attributes: ['id', 'is_guest'] });
    if (!sender || sender.is_guest === true) return 0;

    const now = Date.now();
    const links = await GuestLink.findAll({
      where: {
        conversation_id: message.conversation_id,
        kind: 'personal',
        revoked_at: null,
        email_verified_at: { [Op.ne]: null },
        unsubscribed_at: null,
        contact_email: { [Op.ne]: null },
        expires_at: { [Op.gt]: new Date() },
      },
      limit: 200,
    });
    if (!links.length) return 0;

    const conversation = await Conversation.findByPk(message.conversation_id);
    if (!conversation) return 0;
    // ★ 킬스위치는 **2단(플랫폼 → 워크스페이스)** 이고, 여기도 둘 다 봐야 한다.
    //   처음엔 워크스페이스만 봤다 — 플랫폼 스위치를 내려도 **메일은 계속 나갔다**(Fable 실측).
    //   그 메일 속 링크는 열리지 않으므로(읽는 문은 둘 다 본다) 사용자에게는
    //   "알림은 오는데 눌러도 안 열린다" 가 된다. 사고를 멈추려고 내린 스위치가
    //   사고를 한 겹 더 만드는 셈이다. 못 읽으면 "모름" 이고, 모르면 안 보낸다(fail-closed).
    const { PlatformSetting } = require('../models');
    const platform = await PlatformSetting.findOne({ attributes: ['guest_links_enabled'] });
    if (!platform || platform.guest_links_enabled !== true) return 0;
    const biz = await Business.findByPk(conversation.business_id, {
      attributes: ['id', 'name', 'brand_name', 'deleted_at', 'guest_links_enabled'],
    });
    // 워크스페이스가 사라졌거나 게스트 링크를 껐으면 메일도 나가지 않는다.
    if (!biz || biz.deleted_at || biz.guest_links_enabled === false) return 0;
    const wsName = biz.brand_name || biz.name || null;
    const appUrl = process.env.APP_URL || 'https://dev.planq.kr';

    const { sendGuestReplyNotifyEmail } = require('./emailService');
    let sent = 0;
    for (const link of links) {
      // 부모가 닫혔으면 자식도 닫힌 것이다 — 읽는 문과 같은 규칙(resolveGuestToken).
      if (link.parent_link_id) {
        const parent = await GuestLink.findByPk(link.parent_link_id);
        if (!parent || parent.revoked_at || new Date(parent.expires_at).getTime() < now) continue;
      }
      const lastNotified = link.last_notified_at ? new Date(link.last_notified_at).getTime() : 0;
      if (now - lastNotified < NOTIFY_COOLDOWN_MS) continue;
      const lastUsed = link.last_used_at ? new Date(link.last_used_at).getTime() : 0;
      if (now - lastUsed < ACTIVE_WINDOW_MS) continue;   // 지금 보고 있다

      // 그 사람의 링크는 **매번 다시 계산**한다(저장하지 않는다 — personalTokenFor 주석).
      //   키가 없거나 행이 어긋나면 null 이고, 그러면 **보내지 않는다.**
      //   주소 없는 알림은 "뭔가 왔다는데 열 수가 없다" 라서 안 보내느니만 못하다.
      const token = personalTokenFor(link);
      if (!token) continue;
      const openUrl = `${appUrl}/g/${token}`;
      const ok = await sendGuestReplyNotifyEmail({
        to: link.contact_email,
        workspaceName: wsName,
        openUrl,
        unsubscribeUrl: `${openUrl}?unsub=1`,
        businessId: conversation.business_id,
        conversationId: conversation.id,
        locale: link.locale || 'ko',
      });
      if (ok !== false) sent += 1;
      await link.update({ last_notified_at: new Date() }).catch(() => null);
    }
    return sent;
  } catch (e) {
    console.error('[guest_notify] 실패:', e.message);
    return 0;   // ★ 절대 throw 하지 않는다 — 메시지 저장 경로에 얹혀 있다
  }
}

/**
 * 이 대화에 알림 받을 사람이 있는가 — **훅이 매 메시지마다 묻는 질문**이라 싸야 한다.
 * 대부분의 대화에는 게스트가 없다. 그 "없다" 를 60초 캐시해서 저장 경로에 쿼리를 얹지 않는다.
 */
const _hasCache = new Map();   // conversationId → { v: boolean, until: number }
const HAS_TTL_MS = 60 * 1000;

async function hasVerifiedGuests(conversationId) {
  const hit = _hasCache.get(conversationId);
  if (hit && hit.until > Date.now()) return hit.v;
  const { GuestLink } = require('../models');
  const n = await GuestLink.count({
    where: {
      conversation_id: conversationId, kind: 'personal', revoked_at: null,
      unsubscribed_at: null, email_verified_at: { [Op.ne]: null },
    },
  });
  const v = n > 0;
  _hasCache.set(conversationId, { v, until: Date.now() + HAS_TTL_MS });
  // 캐시가 무한정 자라지 않게 — 대화 수가 많아도 상한을 둔다.
  if (_hasCache.size > 5000) _hasCache.clear();
  return v;
}

/** 등록·수신거부·삭제 직후에는 캐시를 즉시 버린다 — 켜자마자 60초 먹통이면 고장으로 보인다. */
function invalidateGuestCache(conversationId) { _hasCache.delete(conversationId); }

/**
 * Message 훅의 몸통. **커밋 뒤·응답 뒤**에 움직인다.
 *   훅 안에서 곧바로 일하면 트랜잭션이 메일 발송만큼 길어진다(실사례: 매 저장 50초).
 */
function scheduleGuestNotify(message, options) {
  const run = () => setImmediate(async () => {
    try {
      if (!(await hasVerifiedGuests(message.conversation_id))) return;
      await notifyGuestsOfReply(message);
    } catch (e) { console.error('[guest_notify] schedule 실패:', e.message); }
  });
  if (options?.transaction) options.transaction.afterCommit(run);
  else run();
}

module.exports = {
  notifyGuestsOfReply, scheduleGuestNotify, hasVerifiedGuests, invalidateGuestCache,
  ACTIVE_WINDOW_MS,
};
