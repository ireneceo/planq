// PlanQ 구독 플랜 정의 — 단일 원천 (Single Source of Truth)
// 이 파일이 모든 플랜 관련 로직의 기준. 가격·쿼터 변경 시 이 파일만 수정.

const MB = 1024 * 1024;
const GB = 1024 * MB;

const PLANS = {
  free: {
    code: 'free',
    name: 'Free',
    name_ko: '프리',
    price_monthly: { KRW: 0, USD: 0 },
    price_yearly:  { KRW: 0, USD: 0 },
    target: '체험·1인 초보',
    target_ko: '체험·1인 초보',
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
      external_cloud: true,        // Google Drive 연동 가능 (권장)
      data_export: false,
      api_access: false,
      sso: false,
      priority_support: false,
    },
    support: 'community',
    sla: null,
  },

  starter: {
    code: 'starter',
    name: 'Starter',
    name_ko: '스타터',
    price_monthly: { KRW: 9_900,  USD: 9 },
    price_yearly:  { KRW: 99_000, USD: 90 },  // 2달 무료
    target: '1인 프리랜서',
    target_ko: '1인 프리랜서',
    limits: {
      members_max: 3,
      clients_max: 20,
      projects_max: 10,
      conversations_max: 30,
      storage_bytes: 1 * GB,
      file_size_max_bytes: 20 * MB,
      cue_actions_monthly: 300,
      qnote_minutes_monthly: 5 * 60,
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
    target: '소상공인·팀 (1~10명)',
    target_ko: '소상공인·팀 (1~10명)',
    limits: {
      members_max: 10,
      clients_max: 100,
      projects_max: Infinity,
      conversations_max: Infinity,
      storage_bytes: 5 * GB,
      file_size_max_bytes: 50 * MB,
      cue_actions_monthly: 1_500,
      qnote_minutes_monthly: 25 * 60,
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
    target: '에이전시·스튜디오 (10~30명)',
    target_ko: '에이전시·스튜디오 (10~30명)',
    limits: {
      members_max: 30,
      clients_max: 500,
      projects_max: Infinity,
      conversations_max: Infinity,
      storage_bytes: 20 * GB,
      file_size_max_bytes: 100 * MB,
      cue_actions_monthly: 7_500,
      qnote_minutes_monthly: 150 * 60,    // 150h Soft Cap (Fair Use)
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

const PLAN_ORDER = ['free', 'starter', 'basic', 'pro', 'enterprise'];

/**
 * 플랜 코드 → 플랜 객체
 */
function getPlan(code) {
  return PLANS[code] || PLANS.free;
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
  getPlan,
  planAtLeast,
  toPublicJson,
};
