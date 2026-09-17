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
// ★ **사람이 쓴 자유 텍스트를 담는 종류** — 이 메일에는 본문을 싣지 않는다 (#407, 2026-09-17).
//   인앱 알림 행에는 본문이 그대로 있다(울타리 안). 그런데 이 크론이 그 `body` 를 **메일 HTML 로
//   그대로 렌더**해 왔다 — `notify()` 에서 메일·푸시를 막아 놔도 **여기로 다시 새어 나갔다.**
//   Fable 12차 차단3 실측: 마커 문자열이 에스컬레이션 메일 items[0].body 에 그대로 들어갔다.
//   즉 «푸시를 5분 안에 못 본 모든 채팅» 이 본문째 메일로 나가고 있었다.
const FREE_TEXT_KINDS = new Set(['message', 'mention', 'comment_mention', 'task_comment']);

const ESCALATE_KINDS = [
  'message', 'mention', 'comment_mention',
  'task', 'event', 'invite', 'signature', 'invoice', 'tax_invoice',
];

/** 이 사용자에게 **메일로 내보내도 되는** 알림만 고른다 — 게이트 두 겹(위 주석 참조).
 *  판정을 여기 한 곳에 둔 이유: 크론 본체는 DB 를 쓰기 때문에 검사로 돌릴 수 없다.
 *  이 함수는 순수 판정이라 실제 설정으로 참/거짓을 가를 수 있다(`--suite` 없이 node 로).
 */
async function selectEscalatable(userId, businessId, rows) {
  const { isAllowed } = require('../routes/notifications');
  if (!rows || !rows.length) return [];
  if (!(await isAllowed(userId, businessId, 'push_fallback', 'email'))) return [];
  const kindOk = new Map();   // 같은 종류를 여러 번 묻지 않는다
  const out = [];
  for (const r of rows) {
    const k = r.event_kind;
    if (!kindOk.has(k)) kindOk.set(k, await isAllowed(userId, businessId, k, 'email'));
    if (kindOk.get(k)) out.push(r);
  }
  return out;
}

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

    // ★ 2026-09-14 — 여기는 원래 **일부러 email pref 를 무시**했다(push silent-drop 안전망이 목적).
    //   그래서 설정에서 메일을 전부 꺼도 이 메일만은 계속 왔다 — **설정이 거짓말을 했다.**
    {
      const user = await getUser(g.userId);
      // ★ 판정은 **두 겹**이다 — 둘 다 통과해야 나간다 (Irene 2026-09-14 재신고:
      //   *"내가 메일설정 껐는데 메일로 계속 와. 알림 설정 맞춰진거 맞아?"*)
      //
      //   ① 그 알림 **종류의 email 설정** — 사용자가 "메시지는 메일로 보내지 마" 라고 껐으면
      //      안전망이라도 그 종류를 메일로 되살리지 않는다. 전용 스위치를 **별개**로 두었더니
      //      (2026-09-14 오전) 메일을 전부 끈 사람에게 이 경로만 계속 나갔다 — 설정이 거짓말이 된다.
      //      운영 실측: irene 계정은 10종이 전부 0 인데 push_fallback 만 1(기본값) 이라 계속 왔다.
      //   ② `push_fallback` 전용 스위치 — 종류별 메일은 받지만 **미확인 재알림(요약)은 싫다** 는
      //      사람을 위한 것. 이제 이 스위치는 **좁히기만** 한다(우회하지 않는다).
      //
      //   대가: 메일을 전부 끈 사람은 푸시가 조용히 죽었을 때 메일로도 못 받는다.
      //   그건 **사용자가 고른 것**이고, 설정 화면이 그 뜻을 한 줄로 말한다(NotificationSettings).
      const allowed = await selectEscalatable(g.userId, g.businessId, fresh);
      if (user && user.email && allowed.length) {
        const ok = await sendUnreadNotificationEmail({
          to: user.email,
          name: user.name,
          //   ★ 자유 텍스트 종류는 **제목·링크만** 보낸다(#407). 무엇이 왔는지는 제목이 말하고,
          //     내용은 로그인해서 본다. 나머지 종류(업무 상태·청구 등)는 시스템 문구라 그대로 싣는다.
          items: allowed.slice(0, 10).map((r) => ({
            title: r.title,
            body: FREE_TEXT_KINDS.has(r.event_kind) ? null : r.body,
            link: r.link,
          })),
          count: allowed.length,
          workspaceName: g.businessId ? (wsNameById.get(g.businessId) || null) : null,
          businessId: g.businessId || null,
        }).catch(() => false);
        if (ok) emails++;
      }
    }
    // 발송 여부 무관하게 마킹 — **끈 사람의 알림도 마킹한다.** 안 그러면 설정을 끈 사용자의
    //   큐가 영원히 안 비어 매분 재검사한다(그리고 나중에 켜면 옛 알림이 한꺼번에 터진다).
    
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

module.exports = { runUnreadEscalation, initUnreadEscalationCron, selectEscalatable };
