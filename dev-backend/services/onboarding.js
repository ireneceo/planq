// 신규 워크스페이스 온보딩 — "무엇부터 하면 되는지" 를 화면이 짧게 알려준다.
//
// 왜 만들었나 (Irene 2026-09-08: "신규 고객이 들어와서 전반적으로 잘 이해할 수 있게
//   안내하는 거 처음 접속 시 있어?")  ─ 실측 답: 없었다.
//   가입하면 곧장 /dashboard 로 떨어지고, 거기엔 좌측 메뉴 12개(Q talk~Q bill)가 이름만
//   나열될 뿐 무엇부터 하라는 말이 한 줄도 없었다. 운영 실사용자 흔적이 그 모양이다 —
//   가입 후 20분 동안 대화방 하나 만들고 출퇴근 눌러보고 떠난 계정이 있다.
//
// ★ 완료 판정은 **실제 데이터로 매번 계산한다.** 단계별 완료 플래그를 따로 저장하지 않는다.
//   저장하면 데이터와 갈라진다 — 고객을 다 지웠는데도 '고객 초대 완료' 로 남는 식이다.
//   저장이 필요한 것은 "안 할래" 라는 **사람의 의사** 하나뿐이고, 그것만
//   businesses.onboarding_dismissed_at 에 둔다.
//
// ★ 안내 문구는 이 파일에 없다. 화면이 i18n 으로 그린다 — 서버는 key 와 done 만 말한다.
//   (문구를 서버가 내려주면 ko/en 패리티 가드 밖으로 새어나가 한쪽 언어만 남는다.)
const { Client, Conversation, Task, PushSubscription, Business, BusinessMember } = require('../models');

/** 온보딩을 볼 자격 — 워크스페이스를 **꾸리는 사람**만. 고객에게 "고객을 초대하세요" 는 말이 안 된다. */
const ELIGIBLE_ROLES = new Set(['owner', 'admin']);

/**
 * @returns {Promise<null | { dismissed: boolean, done_count: number, total: number, steps: Array<{key:string, done:boolean}> }>}
 *   자격이 없으면 null (화면은 아무것도 그리지 않는다).
 */
async function getOnboardingState({ businessId, userId }) {
  const bizId = Number(businessId);
  if (!bizId || !userId) return null;

  const membership = await BusinessMember.findOne({
    where: { business_id: bizId, user_id: userId, removed_at: null },
    attributes: ['role'],
  });
  if (!membership || !ELIGIBLE_ROLES.has(membership.role)) return null;

  const business = await Business.findByPk(bizId, { attributes: ['id', 'onboarding_dismissed_at'] });
  if (!business) return null;

  // 네 단계는 PlanQ 가 도는 한 바퀴다: 고객을 들이고 → 말을 걸고 → 일이 생기고 → 그 일이 도착한다.
  const [clients, conversations, tasks, pushSubs] = await Promise.all([
    Client.count({ where: { business_id: bizId } }),
    Conversation.count({ where: { business_id: bizId } }),
    Task.count({ where: { business_id: bizId } }),
    // 알림만 워크스페이스가 아니라 **이 사람**의 기기 기준이다 — 기기 허용은 사람이 하는 일이다.
    PushSubscription.count({ where: { user_id: userId, expired_at: null } }),
  ]);

  const steps = [
    { key: 'invite_client', done: clients > 0 },
    { key: 'start_conversation', done: conversations > 0 },
    { key: 'create_task', done: tasks > 0 },
    { key: 'enable_notifications', done: pushSubs > 0 },
  ];

  return {
    dismissed: !!business.onboarding_dismissed_at,
    done_count: steps.filter((s) => s.done).length,
    total: steps.length,
    steps,
  };
}

/** 사용자가 "이제 안 볼래" 를 눌렀을 때. 되돌리려면 null 을 넣는다(설정에서 다시 켜기용). */
async function setOnboardingDismissed({ businessId, userId, dismissed }) {
  const membership = await BusinessMember.findOne({
    where: { business_id: Number(businessId), user_id: userId, removed_at: null },
    attributes: ['role'],
  });
  if (!membership || !ELIGIBLE_ROLES.has(membership.role)) return false;
  await Business.update(
    { onboarding_dismissed_at: dismissed ? new Date() : null },
    { where: { id: Number(businessId) } },
  );
  return true;
}

module.exports = { getOnboardingState, setOnboardingDismissed, ELIGIBLE_ROLES };
