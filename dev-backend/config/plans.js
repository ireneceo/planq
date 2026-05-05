// PlanQ 구독 플랜 정의 — 단일 원천 (Single Source of Truth)
// 이 파일이 모든 플랜 관련 로직의 기준. 가격·쿼터 변경 시 이 파일만 수정.

const MB = 1024 * 1024;
const GB = 1024 * MB;

const PLANS = {
  // (deprecated 2026-05-05) Free 플랜 폐지 — 신규 가입은 starter+trialing 14일.
  // 기존 Free row 호환을 위해 ENUM 값과 PLANS 객체는 유지하되, PLAN_ORDER 와 toPublicJson 카탈로그에선 제외.
  // 마이그레이션: scripts/migrate-free-to-starter.js 가 일괄 starter+trialing 부여.
  free: {
    code: 'free',
    name: 'Free',
    name_ko: '프리',
    price_monthly: { KRW: 0, USD: 0 },
    price_yearly:  { KRW: 0, USD: 0 },
    target: '(deprecated)',
    target_ko: '(deprecated)',
    limits: {
      members_max: 1,
      clients_max: 3,
      projects_max: 2,
      conversations_max: 5,
      storage_bytes: 200 * MB,
      file_size_max_bytes: 5 * MB,
      cue_actions_monthly: 30,
      qnote_minutes_monthly: 60,
      trash_retention_days: 7,
      audit_log_retention_days: 30,
    },
    features: {
      external_cloud: true,
      data_export: false,
      api_access: false,
      sso: false,
      priority_support: false,
    },
    support: 'community',
    sla: null,
    deprecated: true,
  },

  starter: {
    code: 'starter',
    name: 'Starter',
    name_ko: '스타터',
    price_monthly: { KRW: 9_900,  USD: 9 },
    price_yearly:  { KRW: 99_000, USD: 90 },  // 2달 무료
    target: '1인 프리랜서·신규 14일 체험',
    target_ko: '1인 프리랜서·신규 14일 체험',
    limits: {
      members_max: 1,
      clients_max: 5,
      projects_max: 5,
      conversations_max: 10,
      storage_bytes: 2 * GB,
      file_size_max_bytes: 20 * MB,
      cue_actions_monthly: 50,
      qnote_minutes_monthly: 60,
      trash_retention_days: 14,
      audit_log_retention_days: 90,
    },
    features: {
      external_cloud: true,
      data_export: true,
      api_access: false,
      sso: false,
      priority_support: false,
    },
    support: 'email_48h',
    sla: null,
  },

  basic: {
    code: 'basic',
    name: 'Basic',
    name_ko: '베이직',
    price_monthly: { KRW: 29_000,  USD: 29 },
    price_yearly:  { KRW: 290_000, USD: 290 },
    target: '소상공인·팀 (1~5명)',
    target_ko: '소상공인·팀 (1~5명)',
    limits: {
      members_max: 5,
      clients_max: 20,
      projects_max: Infinity,
      conversations_max: Infinity,
      storage_bytes: 5 * GB,
      file_size_max_bytes: 50 * MB,
      cue_actions_monthly: 1_500,
      qnote_minutes_monthly: 15 * 60,
      trash_retention_days: 30,
      audit_log_retention_days: 365,
    },
    features: {
      external_cloud: true,
      data_export: true,
      api_access: false,
      sso: false,
      priority_support: false,
    },
    support: 'email_24h',
    sla: '99.0',
  },

  pro: {
    code: 'pro',
    name: 'Pro',
    name_ko: '프로',
    price_monthly: { KRW: 79_000,  USD: 79 },
    price_yearly:  { KRW: 790_000, USD: 790 },
    target: '에이전시·스튜디오 (5~10명)',
    target_ko: '에이전시·스튜디오 (5~10명)',
    limits: {
      members_max: 10,
      clients_max: 100,
      projects_max: Infinity,
      conversations_max: Infinity,
      storage_bytes: 20 * GB,
      file_size_max_bytes: 100 * MB,
      cue_actions_monthly: 7_500,
      qnote_minutes_monthly: 60 * 60,     // 60h Soft Cap (Fair Use)
      trash_retention_days: 90,
      audit_log_retention_days: 3 * 365,
    },
    features: {
      external_cloud: true,
      data_export: true,
      api_access: true,
      sso: false,
      priority_support: true,
    },
    support: 'chat_4h',
    sla: '99.5',
  },

  enterprise: {
    code: 'enterprise',
    name: 'Enterprise',
    name_ko: '엔터프라이즈',
    price_monthly: { KRW: null, USD: null },  // 문의
    price_yearly:  { KRW: null, USD: null },
    target: '대규모 조직 (50명+)',
    target_ko: '대규모 조직 (50명+)',
    limits: {
      members_max: Infinity,
      clients_max: Infinity,
      projects_max: Infinity,
      conversations_max: Infinity,
      storage_bytes: Infinity,           // 맞춤 (기본 100GB)
      file_size_max_bytes: 200 * MB,
      cue_actions_monthly: Infinity,     // 맞춤
      qnote_minutes_monthly: Infinity,
      trash_retention_days: 365,
      audit_log_retention_days: 7 * 365,
    },
    features: {
      external_cloud: true,
      data_export: true,
      api_access: true,
      sso: true,
      priority_support: true,
    },
    support: 'dedicated_manager',
    sla: '99.9',
  },
};

// 'free' 폐지 (2026-05-05) — 카탈로그·노출에서 제외. ENUM 호환을 위해 PLANS.free 객체 자체는 유지.
const PLAN_ORDER = ['starter', 'basic', 'pro', 'enterprise'];

// ─── Add-on 카탈로그 ───
// 워크스페이스가 plan.limits 위에 추가 슬롯·시간을 구매하는 단위. quota 검사 시 plan.limits + addon 합산.
// 가격은 월 단위 (1개월분). 자동 갱신/차감은 별도 cron (현재는 수동 적용 + 추후 자동화).
//
// 단가 책정 원칙:
//   - 멤버 1인 추가: ₩4,900/월 (Slack ₩9,500 / Notion ₩12,000 의 절반 가격)
//   - 고객 슬롯 10명: ₩2,900/월 (인당 ₩290)
//   - Q Note 10시간: ₩9,900/월 (Deepgram STT ₩3,600 + LLM 후처리 ₩1,000 + 마진)
//   - Cue 액션 1,000회: ₩4,900/월 (직접비 약 ₩2,500)
//   - 스토리지 5GB: ₩4,900/월
const ADDONS = {
  member: {
    code: 'member',
    name_ko: '멤버 추가 (1명)',
    name_en: 'Extra member (1 seat)',
    price_monthly: { KRW: 4_900, USD: 5 },
    unit: 1,                          // 1 회 구매 = 1명 추가
    field: 'addon_members',           // Business 컬럼명
    available_in: ['starter', 'basic', 'pro'],
  },
  clients_10: {
    code: 'clients_10',
    name_ko: '고객 슬롯 추가 (10명)',
    name_en: 'Extra client slots (10)',
    price_monthly: { KRW: 2_900, USD: 3 },
    unit: 10,
    field: 'addon_clients',
    available_in: ['starter', 'basic', 'pro'],
  },
  qnote_10h: {
    code: 'qnote_10h',
    name_ko: 'Q Note 시간 추가 (10시간)',
    name_en: 'Extra Q Note hours (10h)',
    price_monthly: { KRW: 9_900, USD: 10 },
    unit: 10 * 60,                    // 분 단위 — 600분
    field: 'addon_qnote_minutes',
    available_in: ['starter', 'basic', 'pro'],
  },
  cue_1000: {
    code: 'cue_1000',
    name_ko: 'Cue AI 액션 추가 (1,000회)',
    name_en: 'Extra Cue actions (1,000)',
    price_monthly: { KRW: 4_900, USD: 5 },
    unit: 1000,
    field: 'addon_cue_actions',
    available_in: ['starter', 'basic', 'pro'],
  },
  storage_5gb: {
    code: 'storage_5gb',
    name_ko: '스토리지 추가 (5GB)',
    name_en: 'Extra storage (5GB)',
    price_monthly: { KRW: 4_900, USD: 5 },
    unit: 5 * GB,
    field: 'addon_storage_bytes',
    available_in: ['starter', 'basic', 'pro'],
  },
};

function getAddon(code) {
  return ADDONS[code] || null;
}
function listAddonsForPlan(planCode) {
  return Object.values(ADDONS).filter((a) => a.available_in.includes(planCode));
}

/**
 * 플랜 코드 → 플랜 객체
 */
function getPlan(code) {
  return PLANS[code] || PLANS.starter;
}

/**
 * 플랜 간 비교 (min 충족 여부)
 */
function planAtLeast(code, minCode) {
  return PLAN_ORDER.indexOf(code) >= PLAN_ORDER.indexOf(minCode);
}

/**
 * 사용자 노출용 안전 객체 (Infinity → null 변환, 민감 X)
 */
function toPublicJson(code) {
  const p = getPlan(code);
  const convert = v => v === Infinity ? null : v;
  return {
    code: p.code,
    name: p.name,
    name_ko: p.name_ko,
    price_monthly: p.price_monthly,
    price_yearly: p.price_yearly,
    target: p.target,
    target_ko: p.target_ko,
    limits: Object.fromEntries(Object.entries(p.limits).map(([k, v]) => [k, convert(v)])),
    features: p.features,
    support: p.support,
    sla: p.sla,
  };
}

module.exports = {
  PLANS,
  PLAN_ORDER,
  ADDONS,
  getPlan,
  getAddon,
  listAddonsForPlan,
  planAtLeast,
  toPublicJson,
};
