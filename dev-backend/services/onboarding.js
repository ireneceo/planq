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
//
// ★ 두 묶음 (2026-10-04, docs/AI_AGENT_M3_DESIGN.md §3.3 D3)
//   - workspace : 워크스페이스를 꾸리는 일(고객·대화·업무·메일 계정) — owner/admin 만.
//                 닫기는 businesses.onboarding_dismissed_at (워크스페이스 하나에 하나).
//   - me        : 각자 자기 기기·계정에서만 할 수 있는 일(알림·캘린더·앱·AI 앱) — **모든 멤버**.
//                 owner 가 대신 못 한다. 닫기는 business_members.onboarding_dismissed_at (사람×워크스페이스).
//   고객(client)·AI 멤버·비멤버는 null.
//
// ★ 하위 호환 — 최상위 `dismissed/done_count/total/steps` 는 **옛 네 단계 그대로** 둔다.
//   옛 번들은 그것만 읽는다. 멤버는 옛 번들에서 카드를 본 적이 없으므로 steps 를 빈 배열로 준다
//   (옛 카드는 total 0 이면 그리지 않는다 — 멤버에게 갑자기 옛 카드가 뜨지 않는다).
const { Op } = require('sequelize');
const {
  Client, Conversation, Task, PushSubscription, Business, BusinessMember,
  EmailAccount, ExternalConnection, RefreshToken, AgentGrant,
} = require('../models');
const { billableClientWhere } = require('./clientQuota');
const { getAdoptionStages } = require('./adoptionStages');

/** 팀 적응 단계를 내놓은 시각 — 이보다 앞선 «다시 보지 않기» 는 단계 묶음에 먹지 않는다(아래 stages 주석). */
const STAGES_RELEASED_AT = Date.parse('2026-10-09T18:00:00+09:00');

/** 워크스페이스 묶음을 볼 자격 — 워크스페이스를 **꾸리는 사람**만. 고객에게 "고객을 초대하세요" 는 말이 안 된다. */
const ELIGIBLE_ROLES = new Set(['owner', 'admin']);
/** 개인 묶음을 볼 자격 — 사람 멤버 전원. AI(Cue) 멤버는 기기도 계정도 없다. */
const PERSONAL_ROLES = new Set(['owner', 'admin', 'member']);

/** 개인 캘린더로 치는 공급자 — 내 외부 연동 화면(ProfileIntegrationsPage)의 «캘린더» 칸과 같은 목록. */
const CALENDAR_PROVIDERS = ['google_calendar', 'microsoft_calendar', 'apple_calendar'];
/** 설치된 앱(네이티브·홈 화면 PWA)으로 로그인한 세션의 client_kind. 'web' 은 브라우저 탭이다. */
const APP_CLIENT_KINDS = ['pwa', 'ios', 'android'];

function summarize(scope, dismissed, steps) {
  return { scope, dismissed, done_count: steps.filter((s) => s.done).length, total: steps.length, steps };
}

/**
 * @returns {Promise<null | {
 *   dismissed: boolean, done_count: number, total: number, steps: Array<{key:string, done:boolean}>,
 *   groups: Array<{scope:'workspace'|'me', dismissed:boolean, done_count:number, total:number, steps:Array<{key:string, done:boolean}>}>
 * }>}  자격이 없으면 null (화면은 아무것도 그리지 않는다).
 */
async function getOnboardingState({ businessId, userId }) {
  const bizId = Number(businessId);
  if (!bizId || !userId) return null;

  const membership = await BusinessMember.findOne({
    where: { business_id: bizId, user_id: userId, removed_at: null },
    attributes: ['id', 'role', 'onboarding_dismissed_at'],
  });
  if (!membership || !PERSONAL_ROLES.has(membership.role)) return null;
  const isManager = ELIGIBLE_ROLES.has(membership.role);

  const business = await Business.findByPk(bizId, { attributes: ['id', 'onboarding_dismissed_at'] });
  if (!business) return null;

  const now = new Date();
  const [pushSubs, calendars, appSubs, appSessions, aiGrants] = await Promise.all([
    // 알림은 워크스페이스가 아니라 **이 사람**의 기기 기준이다 — 기기 허용은 사람이 하는 일이다.
    PushSubscription.count({ where: { user_id: userId, expired_at: null } }),
    // 캘린더 — 이 사람이 이 워크스페이스에서 연결한 개인 캘린더(내 외부 연동 화면과 같은 행).
    ExternalConnection.count({
      where: { user_id: userId, business_id: bizId, owner_scope: 'user', provider: CALENDAR_PROVIDERS, is_active: true },
    }),
    // 앱 — 네이티브 앱 푸시 구독(apns/fcm) 또는 설치된 앱(PWA·iOS·Android)으로 로그인한 살아 있는 세션.
    PushSubscription.count({ where: { user_id: userId, expired_at: null, kind: ['apns', 'fcm'] } }),
    RefreshToken.count({
      where: { user_id: userId, client_kind: APP_CLIENT_KINDS, revoked_at: null, expires_at: { [Op.gt]: now } },
    }),
    // AI 앱 — 이 워크스페이스로 동의를 마치고(코드 교환 끝) 아직 끊지 않은 연결.
    AgentGrant.count({
      where: { user_id: userId, business_id: bizId, revoked_at: null, activated_at: { [Op.ne]: null } },
    }),
  ]);

  const meSteps = [
    { key: 'enable_notifications', done: pushSubs > 0 },
    { key: 'connect_calendar', done: calendars > 0 },
    { key: 'install_app', done: appSubs + appSessions > 0 },
    { key: 'connect_ai_app', done: aiGrants > 0 },
  ];
  const groups = [];
  let legacySteps = [];

  if (isManager) {
    // 네 단계는 PlanQ 가 도는 한 바퀴다: 고객을 들이고 → 말을 걸고 → 일이 생기고 → 메일이 같이 들어온다.
    const [clients, conversations, tasks, mailAccounts] = await Promise.all([
      // "고객 초대" 단계 — Q sale 문의 고객(prospect)은 초대가 아니다. 문의만 넣어도 완료가 되면 안 된다(§16 U4)
      Client.count({ where: billableClientWhere(bizId) }),
      Conversation.count({ where: { business_id: bizId } }),
      Task.count({ where: { business_id: bizId } }),
      EmailAccount.count({ where: { business_id: bizId, is_active: true } }),
    ]);
    const wsSteps = [
      { key: 'invite_client', done: clients > 0 },
      { key: 'start_conversation', done: conversations > 0 },
      { key: 'create_task', done: tasks > 0 },
      { key: 'connect_mail', done: mailAccounts > 0 },
    ];
    groups.push(summarize('workspace', !!business.onboarding_dismissed_at, wsSteps));
    // 옛 번들용 네 단계 — 예전 응답과 같은 key·순서.
    legacySteps = [...wsSteps.slice(0, 3), meSteps[0]];
  }
  groups.push(summarize('me', !!membership.onboarding_dismissed_at, meSteps));

  // 팀 적응 단계 (2026-10-09, docs/TEAM_ADOPTION_STAGES_DESIGN.md) — 사람 멤버 전원. 새 화면은 workspace 묶음 대신 이것을 그린다.
  //   ★ 닫기는 사람 단위(business_members.onboarding_dismissed_at)지만 **단계가 나오기 전의 닫기는 먹지 않는다** —
  //     옛 카드(설정 체크리스트)를 닫은 사람이 새 단계를 영영 못 보게 되므로(Fable 2026-10-09). 컬럼을 NULL 로 되돌리면
  //     «내 설정» 묶음까지 되살아나므로 그렇게 하지 않는다. 출시 뒤 닫기는 scope:'all' 이라 둘 다 닫힌다.
  const dismissedAt = membership.onboarding_dismissed_at ? new Date(membership.onboarding_dismissed_at) : null;
  const stages = await getAdoptionStages({ businessId: bizId, userId, role: membership.role });
  stages.dismissed = !!dismissedAt && dismissedAt.getTime() > STAGES_RELEASED_AT;

  return {
    dismissed: isManager ? !!business.onboarding_dismissed_at : true,
    done_count: legacySteps.filter((s) => s.done).length,
    total: legacySteps.length,
    steps: legacySteps,
    groups,
    stages,
  };
}

/**
 * 사용자가 "이제 안 볼래" 를 눌렀을 때. 되돌리려면 dismissed=false.
 * @param {'workspace'|'me'|'all'} [scope='workspace'] — 옛 번들은 scope 를 안 보낸다 = 예전처럼 워크스페이스 묶음.
 *   'all' = 내가 볼 수 있는 묶음 전부(멤버는 개인 묶음만).
 * @returns {Promise<boolean>} 하나도 바꿀 자격이 없으면 false.
 */
async function setOnboardingDismissed({ businessId, userId, dismissed, scope = 'workspace' }) {
  const bizId = Number(businessId);
  const membership = await BusinessMember.findOne({
    where: { business_id: bizId, user_id: userId, removed_at: null },
    attributes: ['id', 'role'],
  });
  if (!membership) return false;
  const value = dismissed ? new Date() : null;
  const doWorkspace = (scope === 'workspace' || scope === 'all') && ELIGIBLE_ROLES.has(membership.role);
  const doMe = (scope === 'me' || scope === 'all') && PERSONAL_ROLES.has(membership.role);
  if (!doWorkspace && !doMe) return false;
  if (doWorkspace) {
    await Business.update({ onboarding_dismissed_at: value }, { where: { id: bizId } });
  }
  if (doMe) {
    await BusinessMember.update({ onboarding_dismissed_at: value }, { where: { id: membership.id } });
  }
  return true;
}

module.exports = { getOnboardingState, setOnboardingDismissed, ELIGIBLE_ROLES, PERSONAL_ROLES };
