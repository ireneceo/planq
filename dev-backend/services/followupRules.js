// 신규 고객 팔로업 — «도울 일» 규칙표 (2026-11-06, Fable 설계 docs/ADMIN_FOLLOWUP_DESIGN.md ③)
//
// ★ AI 안 씀. 조건은 여정 신호(followupSummary.computeSignals)·요약 값에서만.
// ★ 이 표가 5단계 «제안 메시지»(supportNudgeRules)의 1차 묶음이다 — 키 이름을 바꾸지 않는다.
// ★ 초안 틀은 받는 사람(대표) 언어로 고른다 — 관리자 화면 언어 ≠ 고객 언어. 칩 라벨은 화면 admin.json.
//   자동으로 보내지 않는다 — 관리자가 읽고 고쳐 [보내기] 를 누른다(결정 4 «검토 후 보내기»).
const DAY = 24 * 60 * 60 * 1000;
const NO_APP_AFTER_DAYS = 7;
const WELCOME_WITHIN_DAYS = 2;

/** 우선순위(작을수록 먼저) · 조건(ctx) — ctx = { signals:Map(key→signal), setup, ageDays, room } */
const RULES = [
  { key: 'trial_ended', priority: 1, when: (c) => c.signals.has('trial_ended') },
  { key: 'trial_ending', priority: 1, when: (c) => c.signals.has('trial_ending') },
  { key: 'mail_error', priority: 2, when: (c) => c.signals.has('mail_error') },
  { key: 'inactive', priority: 2, when: (c) => c.signals.has('inactive') },
  { key: 'stage_stalled', priority: 3, when: (c) => c.signals.has('stage_stalled') },
  { key: 'solo', priority: 3, when: (c) => c.signals.has('solo') },
  { key: 'no_app', priority: 4, when: (c) => !c.setup.app && c.ageDays != null && c.ageDays >= NO_APP_AFTER_DAYS },
];
const WELCOME = { key: 'welcome', priority: 5 };
const RULE_KEYS = [...RULES.map((r) => r.key), WELCOME.key];

const TEMPLATES = {
  ko: {
    trial_ended: '체험 기간이 끝났어요. 이어서 쓰시려면 플랜을 골라 주세요 — 궁금한 점은 여기서 바로 답드릴게요.',
    trial_ending: '체험이 {{days}}일 남았어요. 플랜과 결제 방법을 안내드릴게요. 지금까지 쓰신 내용은 그대로 이어집니다.',
    mail_error: '메일 연결에 오류가 보여요. 설정 › 메일에서 다시 연결하면 풀립니다. 막히시면 여기로 말씀 주세요.',
    inactive: '잘 지내시죠? 최근 들어오시지 않아 안부 드려요. 필요하시면 화상으로 15분 사용 안내를 해 드릴게요 — 편한 시간 알려 주세요.',
    stage_stalled: '첫 업무를 하나 만들어 보실래요? 30초면 됩니다. Q task 에서 [+ 업무] 를 누르면 돼요.',
    solo: '팀원을 초대하면 요청과 확인이 한 곳에서 돌아가요. 설정 › 멤버 › 초대에서 할 수 있어요.',
    no_app: '폰 앱을 받으시면 알림을 놓치지 않아요. PlanQ 앱 받기: https://planq.kr/app',
    welcome: '환영해요! PlanQ 쓰시다가 막히는 건 여기 물어보세요 — PlanQ 팀이 직접 봅니다.',
  },
  en: {
    trial_ended: 'Your trial has ended. Pick a plan to keep going — ask us anything right here.',
    trial_ending: 'Your trial ends in {{days}} days. We can walk you through plans and payment. Everything you have set up stays as it is.',
    mail_error: 'We noticed an error with your mail connection. Reconnecting under Settings › Mail usually fixes it. Tell us here if you get stuck.',
    inactive: "Hope all is well! We haven't seen you in a while. If it helps, we can give you a 15-minute video walkthrough — just tell us a good time.",
    stage_stalled: 'Want to create your first task? It takes 30 seconds — press [+ Task] in Q task.',
    solo: 'Invite your teammates so requests and reviews happen in one place. Go to Settings › Members › Invite.',
    no_app: "Get the phone app so you don't miss notifications: https://planq.kr/en/app",
    welcome: 'Welcome! If anything gets in your way while using PlanQ, ask here — the PlanQ team reads this room.',
  },
};

/** 규칙 적용 — 우선순위순 전부. sentAt: Map(key→Date) 이 규칙 초안으로 보낸 마지막 시각(막지 않고 표시만). */
function helpFor({ signals, setup, ageDays, room, sentAt }) {
  const sigMap = new Map(signals.map((s) => [s.key, s]));
  const ctx = { signals: sigMap, setup, ageDays, room };
  const hits = RULES.filter((r) => r.when(ctx));
  if (!hits.length && ageDays != null && ageDays <= WELCOME_WITHIN_DAYS && !(room && room.last_staff_at)) hits.push(WELCOME);
  return hits
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r.priority - b.r.priority || a.i - b.i)
    .map(({ r }) => {
      const sig = sigMap.get(r.key);
      const params = sig ? { days: sig.days, count: sig.count, stage: sig.stage } : {};
      return { key: r.key, priority: r.priority, params, sent_at: (sentAt && sentAt.get(r.key)) || null };
    });
}

/** 초안 — 대표 언어 틀에 숫자만 채운다. 못 채운 {{…}} 는 남긴다(화면이 보내기를 막는다). */
function draftText(key, lang, params = {}) {
  const tpl = (TEMPLATES[lang] || TEMPLATES.ko)[key];
  if (!tpl) return null;
  return tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (params[k] != null ? String(params[k]) : m));
}

module.exports = { RULES, RULE_KEYS, TEMPLATES, helpFor, draftText, DAY };
