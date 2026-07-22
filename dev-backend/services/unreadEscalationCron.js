// 미읽음 알림 이메일 에스컬레이션 — push silent-drop 안전망 (운영: Irene 미팅 누락 사고).
//
// 배경: web push 는 OS/브라우저/푸시중계서버 구간에서 statusCode 201 을 주면서도 실제 기기엔
//   조용히 전달 안 하는 경우가 있다 (구독이 겉으론 살아있는데 stale). 서버 코드로 100% 막을 수 없음.
//   → 안전망: 일정 시간 미읽음인 "놓치면 안 되는" 알림을 이메일로 1회 발송.
//
// 동작:
//   - 사용자가 자리에 있으면 push/인앱으로 보고 읽음(read_at) 또는 대화 진입 시 알림 read 처리 → 이메일 스킵 (스팸 방지)
//   - push 가 죽으면 안 읽힘 → ESCALATE_AFTER_MIN 경과 후 이메일이 잡음 (미팅 안 놓침)
//   - 발송/스킵 무관하게 email_escalated_at 마킹 → 같은 알림 중복 발송 차단
//
// 박제: feedback_push_unread_email_escalation.md

const { Op } = require('sequelize');

const ESCALATE_AFTER_MIN = 5;   // 미읽음 5분 경과 시 이메일 (push 못 본 것으로 판단)
const MAX_AGE_HOURS = 24;       // 너무 오래된 알림은 제외 (밀린 큐 폭발 방지)
const INTERVAL_MS = 60 * 1000;  // 1분마다 점검
const PER_RUN_LIMIT = 500;      // 한 번에 처리할 최대 알림 수

// 놓치면 안 되는 종류만 — 관리성 알림(signup/payment/subscription/trial/feedback)은 제외해 메일 과다 방지.
const ESCALATE_KINDS = [
  'message', 'mention', 'comment_mention',
  'task', 'event', 'invite', 'signature', 'invoice', 'tax_invoice',
];

async function runUnreadEscalation() {
  const { Notification, User, Business } = require('../models');
  const { isAllowed } = require('../routes/notifications');
  const { sendUnreadNotificationEmail } = require('./emailService');

  const now = Date.now();
  const cutoff = new Date(now - ESCALATE_AFTER_MIN * 60 * 1000);
  const floor = new Date(now - MAX_AGE_HOURS * 3600 * 1000);

  const rows = await Notification.findAll({
    where: {
      read_at: null,
      email_escalated_at: null,
      event_kind: { [Op.in]: ESCALATE_KINDS },
      created_at: { [Op.lte]: cutoff, [Op.gte]: floor },
    },
    order: [['created_at', 'ASC']],
    limit: PER_RUN_LIMIT,
  });
  if (!rows.length) return { users: 0, emails: 0, marked: 0 };

  // 사용자 × 워크스페이스 그룹 — 한 통에 여러 워크스페이스가 섞이면 제목 접두어([워크스페이스명])를
  //   하나로 못 붙인다. (user, business_id) 로 서로소 분할해 워크스페이스별 봉투 1통씩 발송 (#149).
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.user_id}|${r.business_id ?? 'null'}`;
    if (!groups.has(key)) groups.set(key, { userId: r.user_id, businessId: r.business_id ?? null, list: [] });
    groups.get(key).list.push(r);
  }

  // 워크스페이스명 배치 조회 (N+1 방지 — 쿼리 1개)
  const bizIds = [...new Set(rows.map((r) => r.business_id).filter(Boolean))];
  const bizRows = bizIds.length
    ? await Business.findAll({ where: { id: bizIds }, attributes: ['id', 'name', 'brand_name'] })
    : [];
  const wsNameById = new Map(bizRows.map((b) => [b.id, b.brand_name || b.name || null]));

  const userCache = new Map();  // 멀티 워크스페이스 사용자 중복 조회 방지
  const getUser = async (uid) => {
    if (userCache.has(uid)) return userCache.get(uid);
    const u = await User.findByPk(uid, { attributes: ['email', 'name'] });
    userCache.set(uid, u);
    return u;
  };

  let emails = 0, marked = 0;
  for (const g of groups.values()) {
    // race 재확인 — 그 사이 사용자가 읽었으면(read_at) 제외
    const fresh = [];
    for (const r of g.list) {
      await r.reload().catch(() => {});
      if (!r.read_at && !r.email_escalated_at) fresh.push(r);
    }
    if (!fresh.length) continue;

    // 에스컬레이션은 push silent-drop 백업이 목적 → 일반 email pref 와 무관하게 발송.
    //   (활성 사용자는 대화/알림을 읽으면 read 처리되어 큐에서 빠지므로 스팸 아님)
    //   push 가 기기/OS/PWA캐시 문제로 안 떠도 중요 알림(채팅·멘션·업무 등)을 이메일로 반드시 전달.
    {
      const user = await getUser(g.userId);
      if (user && user.email) {
        const ok = await sendUnreadNotificationEmail({
          to: user.email,
          name: user.name,
          items: fresh.slice(0, 10).map((r) => ({ title: r.title, body: r.body, link: r.link })),
          count: fresh.length,
          workspaceName: g.businessId ? (wsNameById.get(g.businessId) || null) : null,
          businessId: g.businessId || null,
        }).catch(() => false);
        if (ok) emails++;
      }
    }
    // 발송 여부 무관하게 마킹 (email pref OFF 여도 큐 무한 누적 방지)
    const ids = fresh.map((r) => r.id);
    await Notification.update({ email_escalated_at: new Date() }, { where: { id: ids } });
    marked += ids.length;
  }
  return { users: new Set(rows.map((r) => r.user_id)).size, emails, marked };
}

let timer = null;
function initUnreadEscalationCron() {
  if (timer) return;
  timer = setInterval(() => {
    runUnreadEscalation().catch((e) => console.error('[unreadEscalation]', e.message));
  }, INTERVAL_MS);
  console.log(`[unreadEscalation] cron started — every 1min, escalate unread after ${ESCALATE_AFTER_MIN}min`);
}

module.exports = { runUnreadEscalation, initUnreadEscalationCron };
