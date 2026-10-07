// 구독이 «쓸 수 있는 상태» 인가 — 상태표 한 곳 (2026-10-07, Fable 판정 행 6).
//   plan.js 가 쓰고 health-check(billing) 가 같은 함수를 양·음성 대조군으로 잰다.
//   DB·모델을 부르지 않는 순수 함수다(검사기에서 그대로 require 하려고).
//
//   status active|trialing                  → 사용 가능(유료 만료면 유예 안에서만)
//   status past_due|grace + 유예 남음        → 사용 가능 — 결제 대기 버퍼
//   그 밖(canceled·demoted·유예 지남)        → 잠금
//   free                                    → 항상(한도 안에서)
//
// ★ 옛 식은 status 를 active/trialing 만 받아 **유예 7일 내내 전부 잠겼다** — trial.js·billing cron 은
//   유예에 들어갈 때 status 를 past_due 로 바꾼다. 체험은 plan_expires_at 이 null 이라 expired 가
//   늘 false 이므로 유예는 grace_ends_at 단독으로 본다. 잠금은 유예 뒤 canceled 전이가 맡는다.
function subscriptionState({ plan, status, planExpiresAt, graceEndsAt, now = new Date() }) {
  const expired = !!(planExpiresAt && new Date(planExpiresAt) < now);
  const graceLeft = !!(graceEndsAt && new Date(graceEndsAt) > now);
  const st = status || 'active';
  const code = (expired && !graceLeft) ? 'free' : (plan || 'free');
  const graceStatus = ['past_due', 'grace'].includes(st);
  const active = code === 'free' ? true : (
    ((!expired || graceLeft) && ['active', 'trialing'].includes(st))
    || (graceLeft && graceStatus)
  );
  return { code, active, inGrace: graceLeft && (expired || graceStatus) };
}

module.exports = { subscriptionState };
