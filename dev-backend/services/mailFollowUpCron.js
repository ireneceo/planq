// services/mailFollowUpCron.js — "보낸 메일에 답이 없다" 를 **알려준다** (운영 #384).
//
// 왜 (Irene, #384)
//   "메일 보내고 답 없으면 그냥 멈추니까 업무 관리를 인간이 별도 해야 하잖아."
//   판정과 목록 뱃지는 이미 있었다(services/mailFollowUp.js · 2026-07-27 Fable 검토본).
//   빠진 것은 **알림**이다 — 메일 목록을 들여다봐야만 보이니 결국 사람이 챙겨야 했다.
//
// 설계
//   · 판정은 **기존 followUpState() 하나만** 쓴다. SQL 은 후보를 좁히기만 한다 —
//     여기서 조건을 다시 쓰면 뱃지와 알림이 서로 다른 말을 하게 된다
//     (memory: 같은 값의 공식이 여러 벌이면 이미 갈라져 있다).
//   · **문턱을 넘는 날 한 번만** 알린다(days === MIN_DAYS). 매일 반복하면 알림 피로가 되고,
//     "이미 알렸는지" 를 기록할 컬럼도 필요 없어진다(자정 cron 이라 각 스레드가 정확히 한 번 걸린다).
//   · 받는 사람은 **그 메일을 보낸 사람**(email_messages.sent_by_user_id). 없으면 계정 소유자.
//   · 한 사람에게 여러 건이면 **한 통으로 묶는다**.
const { Op } = require('sequelize');
const { EmailThread, EmailMessage, EmailAccount } = require('../models');
const { followUpState, MIN_DAYS, INACTIVE_STATUS } = require('./mailFollowUp');

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {Date} [now]
 * @param {object} [ioApp] socket 핸들 (없으면 notify 가 전역 핸들 사용)
 * @returns {{scanned:number, due:number, notified:number}}
 */
async function runMailFollowUpCron(now = new Date(), ioApp = null) {
  const summary = { scanned: 0, due: 0, notified: 0 };

  // 후보 좁히기 — 마지막 메시지가 outbound 이고, 보낸 지 MIN_DAYS~MIN_DAYS+1 일 사이.
  //   경계는 넉넉히 잡고 최종 판정은 followUpState 에 맡긴다.
  const from = new Date(now.getTime() - (MIN_DAYS + 1) * DAY_MS);
  const to = new Date(now.getTime() - MIN_DAYS * DAY_MS);
  const threads = await EmailThread.findAll({
    where: {
      last_message_direction: 'outbound',
      status: { [Op.notIn]: [...INACTIVE_STATUS] },
      last_message_at: { [Op.gte]: from, [Op.lt]: to },
    },
    attributes: ['id', 'business_id', 'account_id', 'subject', 'status',
      'last_message_direction', 'last_message_at'],
  });
  summary.scanned = threads.length;
  if (threads.length === 0) return summary;

  // 각 스레드의 마지막 outbound — 발송 실패 여부와 보낸 사람을 여기서 얻는다.
  const lastOut = new Map();
  for (const t of threads) {
    const m = await EmailMessage.findOne({
      where: { thread_id: t.id, direction: 'outbound' },
      order: [['sent_at', 'DESC'], ['id', 'DESC']],
      attributes: ['id', 'delivery_status', 'sent_by_user_id'],
    });
    if (m) lastOut.set(t.id, m);
  }

  // 계정 소유자 (sent_by_user_id 가 없을 때의 대체 수신자)
  const accountIds = [...new Set(threads.map((t) => t.account_id).filter(Boolean))];
  const accounts = accountIds.length
    ? await EmailAccount.findAll({ where: { id: accountIds }, attributes: ['id', 'owner_user_id'] })
    : [];
  // ★ 컬럼명은 owner_user_id 다(user_id 아님). 없는 컬럼을 참조하면 쿼리가 던지고 cron 이 통째로 죽는다.
  const ownerByAccount = new Map(accounts.map((a) => [a.id, a.owner_user_id]));

  // 사용자별로 묶는다
  const byUser = new Map();   // key: `${userId}:${businessId}` → { userId, businessId, items: [] }
  for (const t of threads) {
    const out = lastOut.get(t.id) || null;
    const state = followUpState(t, out, now);
    // 알림은 "답이 없다" 만 다룬다. 발송 실패(delivery_problem)는 성격이 달라 목록 뱃지로 남긴다.
    if (!state || state.kind !== 'awaiting_reply') continue;
    if (state.days !== MIN_DAYS) continue;      // 문턱을 넘는 날 한 번만
    const userId = (out && out.sent_by_user_id) || ownerByAccount.get(t.account_id) || null;
    if (!userId) continue;                      // 받을 사람을 모르면 보내지 않는다
    summary.due += 1;
    const key = `${userId}:${t.business_id}`;
    if (!byUser.has(key)) byUser.set(key, { userId, businessId: t.business_id, items: [] });
    byUser.get(key).items.push(t);
  }
  if (byUser.size === 0) return summary;

  const { notify } = require('../routes/notifications');
  for (const { userId, businessId, items } of byUser.values()) {
    const first = items[0];
    const subject = String(first.subject || '(제목 없음)').slice(0, 60);
    // 제목은 **수신자 언어**로 만들어진다(titleSpec 규약 — 운영 #281).
    //   title 은 notifications 에 문자열로 박제되고 push 로 그대로 나가서, 프론트 t() 로는
    //   번역할 수 없다. 발송 시점 해석이 유일한 방법이다.
    const subjectLabel = items.length > 1 ? `${subject} 외 ${items.length - 1}건` : subject;
    try {
      await notify({
        userId,
        businessId,
        eventKind: 'mail',
        titleSpec: { feature: 'mail', action: 'mail_awaiting_reply', subject: subjectLabel },
        title: `답장 없음 — ${subjectLabel}`,   // titleSpec 이 해석되지 않을 때의 대비
        body: `보낸 지 ${MIN_DAYS}일이 지났습니다`,
        // 목록에서 바로 후속 조치를 하도록 전체 탭으로 — 여기에 후속조치 뱃지가 보인다.
        link: '/mail?folder=all',
        ctaLabel: '메일 보기',
        entityType: 'email_thread',
        entityId: first.id,
        ioApp,
      });
      summary.notified += 1;
    } catch (e) {
      console.warn('[mail-followup-cron] notify 실패', userId, e.message);
    }
  }
  return summary;
}

module.exports = { runMailFollowUpCron };
