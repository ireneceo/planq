// 문의·피드백 접수 확인 — 고정 문구 알림 한 곳 (2026-11-15)
//
// Irene: «문의랑 피드백을 고객에게 자동으로 먼저 답변하게 할 수 있어?» → Fable 설계 docs/FEEDBACK_AUTOREPLY_BOARD_DESIGN.md §1
//   (PurpleHere 같은 글 «권고대로» ① 적용: 고정 문구 접수 확인만 자동 · AI 답 자동 발송은 만들지 않는다).
//
// ★ 기존 notify() 한 번 — 종 알림 + 그 사람 알림 설정대로(메일·푸시 강제 없음). 새 알림 종류·메일 틀 없음.
// ★ 답글(admin_response)·responded_*·reply_seen_at·status·감사 로그를 건드리지 않는다 — respondToFeedback 을 거치지 않는다.
//   (그래야 «새 답변» 칩·추가 문의 조건 parent_not_answered·1-B «답했나» 판단이 그대로다.)
// ★ 고객 원문을 인용하지 않는다(제목만 — 본인이 쓴 제목).
const { Op } = require('sequelize');

const DAILY_CAP = 5; // 같은 사람 24시간 접수 확인 상한 — 제출 한도가 없어서 둔다(제출 자체는 막지 않는다)

const TEXT = {
  ko: {
    title: (item) => `${item.kind === 'inquiry' ? '문의' : '피드백'} 접수 — ${item.title}`,
    body: '보내 주신 내용을 잘 받았습니다. 1~2일 안에 검토해서 답을 드릴게요. 답변은 개인 > 문의·피드백에서 볼 수 있어요. (자동 안내)',
    cta: '내역 보기',
  },
  en: {
    title: (item) => `${item.kind === 'inquiry' ? 'Inquiry' : 'Feedback'} received — ${item.title}`,
    body: "We've received your message. We'll review it and reply within 1–2 days. You'll find the reply under Personal > Support & feedback. (Automated message)",
    cta: 'View my feedback',
  },
};
const L = (lang) => (lang === 'en' ? 'en' : 'ko');

/**
 * 보내지 않는 이유(없으면 null) — 판정 한 곳.
 * @returns {Promise<string|null>}
 */
async function skipReason(item, { FeedbackItem, User }) {
  if (!item || !item.id || !item.user_id) return 'no_item';
  if (item.parent_id) return 'followup';
  if (item.ack_sent_at) return 'already_sent';
  const u = await User.findByPk(item.user_id, { attributes: ['id', 'platform_role', 'is_guest', 'is_ai'] });
  if (!u) return 'no_user';
  if (u.platform_role === 'platform_admin') return 'platform_admin';
  if (u.is_guest || u.is_ai) return 'not_person';
  const n = await FeedbackItem.count({
    where: { user_id: item.user_id, ack_sent_at: { [Op.gte]: new Date(Date.now() - 24 * 3600 * 1000) } },
  });
  if (n >= DAILY_CAP) return 'daily_cap';
  return null;
}

/**
 * 접수 확인 1건. 실패해도 던지지 않는다(제출은 이미 성공).
 * 두 번 불러도 한 번만 — ack_sent_at 을 조건부 UPDATE 로 먼저 잡고, 알림이 안 나가면 되돌린다.
 * @returns {Promise<{sent:boolean, reason?:string}>}
 */
async function sendFeedbackAck(item, { ioApp, notifyFn } = {}) {
  const { FeedbackItem, User } = require('../models');
  try {
    const reason = await skipReason(item, { FeedbackItem, User });
    if (reason) return { sent: false, reason };
    // ★ 메일 인증 안 한 계정에는 메일 없이(종 알림·푸시만) — 가입은 인증 전에 토큰을 주므로, 아무 주소로 가입해
    //   제목(200자 자유 문구)을 실은 PlanQ 메일을 남의 주소로 보낼 수 있었다(2026-11-15 Fable 완료 검증 FAIL 실측).
    const owner = await User.findByPk(item.user_id, { attributes: ['id', 'email_verified_at'] });
    const skipChannels = owner && owner.email_verified_at ? [] : ['email'];
    const now = new Date();
    const [claimed] = await FeedbackItem.update({ ack_sent_at: now }, { where: { id: item.id, ack_sent_at: null }, silent: true });
    if (!claimed) return { sent: false, reason: 'already_sent' };
    let result = null;
    try {
      const notify = notifyFn || require('../routes/notifications').notify;
      result = await notify({
        userId: item.user_id,
        businessId: item.business_id || null,
        eventKind: 'feedback',
        title: (lang) => TEXT[L(lang)].title(item),
        body: (lang) => TEXT[L(lang)].body,
        link: '/me/feedback',
        ctaLabel: (lang) => TEXT[L(lang)].cta,
        actorUserId: null,
        entityType: 'feedback_item',
        entityId: item.id,
        skipChannels,
        ioApp,
      });
    } catch (e) {
      await FeedbackItem.update({ ack_sent_at: null }, { where: { id: item.id }, silent: true }).catch(() => null);
      console.warn('[feedbackAck] notify 실패', item.id, e.message);
      return { sent: false, reason: 'notify_failed' };
    }
    // «나갔나» = 종 알림 행이 생김 · 메일 true · 푸시 sent > 0 (push 는 {sent:0} 같은 객체라 그냥 참으로 보면 안 된다)
    const ch = {
      inbox: !!(result && result.inbox === true),
      email: !!(result && result.email === true),
      push: !!(result && result.push && Number(result.push.sent) > 0),
    };
    const delivered = ch.inbox || ch.email || ch.push;
    if (!delivered) {
      await FeedbackItem.update({ ack_sent_at: null }, { where: { id: item.id }, silent: true }).catch(() => null);
      return { sent: false, reason: (result && result.skipped) || 'not_delivered' };
    }
    item.ack_sent_at = now;
    return { sent: true, channels: ch, emailSkipped: skipChannels.includes('email') };
  } catch (e) {
    console.warn('[feedbackAck] 실패', item && item.id, e.message);
    return { sent: false, reason: 'error' };
  }
}

module.exports = { sendFeedbackAck, skipReason, DAILY_CAP, TEXT };
