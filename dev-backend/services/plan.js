// 플랜 엔진 — 비즈니스 플랜 확인 + 권한 체크 + 사용량 집계 통일 경로
// 모든 라우트는 이 파일만 거치게. 하드코딩 금지.

const { Op } = require('sequelize');
const {
  Business, BusinessMember, Client, Project, Conversation,
  File, BusinessStorageUsage, CueUsage, QnoteUsage, BusinessPlanHistory,
} = require('../models');
const { getPlan } = require('../config/plans');

// ─── 메모리 캐시 (30s TTL) ───
const _planCache = new Map();   // businessId → { data, expires }
const _usageCache = new Map();  // businessId → { data, expires }
const CACHE_TTL_MS = 30_000;

function _cacheGet(map, key) {
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) { map.delete(key); return null; }
  return entry.data;
}
function _cacheSet(map, key, data) {
  map.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
}
function invalidateBusinessCache(businessId) {
  _planCache.delete(Number(businessId));
  _usageCache.delete(Number(businessId));
}

/**
 * 비즈니스의 현재 플랜 객체
 */
async function getBusinessPlan(businessId) {
  const key = Number(businessId);
  const cached = _cacheGet(_planCache, key);
  if (cached) return cached;

  const biz = await Business.findByPk(key, {
    attributes: ['id', 'plan', 'subscription_status', 'plan_expires_at', 'trial_ends_at', 'grace_ends_at']
  });
  if (!biz) {
    const result = { plan: getPlan('free'), biz: null, active: false };
    _cacheSet(_planCache, key, result);
    return result;
  }
  const now = new Date();
  const expired = biz.plan_expires_at && new Date(biz.plan_expires_at) < now;
  const inGrace = biz.grace_ends_at && new Date(biz.grace_ends_at) > now;
  const inTrial = biz.trial_ends_at && new Date(biz.trial_ends_at) > now;
  // 만료 + grace 기간 밖 → free 다운그레이드
  const code = (expired && !inGrace) ? 'free' : (biz.plan || 'free');
  const status = biz.subscription_status || 'active';
  const result = {
    plan: getPlan(code),
    biz,
    active: !expired && ['active', 'trialing'].includes(status),
    inTrial,
    inGrace: expired && inGrace,
    trialEndsAt: biz.trial_ends_at,
    graceEndsAt: biz.grace_ends_at,
  };
  _cacheSet(_planCache, key, result);
  return result;
}

/**
 * 특정 한도 값 (숫자) — 비교용. Infinity 유지 (비교 시 필요)
 */
async function getLimit(businessId, key) {
  const { plan } = await getBusinessPlan(businessId);
  return plan.limits[key];
}

/**
 * JSON 직렬화 안전 변환 — Infinity → null
 */
function limitForJson(v) {
  return v === Infinity ? null : v;
}

/**
 * 사용량 집계 — 모든 키를 한 번에 (성능 우선, 30s 캐시)
 */
async function getUsage(businessId) {
  const key = Number(businessId);
  const cached = _cacheGet(_usageCache, key);
  if (cached) return cached;

  const [memberCount, clientCount, projectCount, conversationCount, storageRow, cueThisMonth, qnoteThisMonth] = await Promise.all([
    BusinessMember.count({ where: { business_id: key } }),
    Client.count({ where: { business_id: key } }),
    Project.count({ where: { business_id: key } }),
    Conversation.count({ where: { business_id: key } }),
    BusinessStorageUsage.findOne({ where: { business_id: key } }),
    getCueActionsThisMonth(key),
    getQnoteMinutesThisMonth(key),
  ]);

  const result = {
    members: memberCount,
    clients: clientCount,
    projects: projectCount,
    conversations: conversationCount,
    storage_bytes: storageRow ? Number(storageRow.bytes_used) : 0,
    file_count: storageRow ? storageRow.file_count : 0,
    cue_actions_this_month: cueThisMonth,
    qnote_minutes_this_month: qnoteThisMonth,
  };
  _cacheSet(_usageCache, key, result);
  return result;
}

async function getCueActionsThisMonth(businessId) {
  // CueUsage: (business_id, year_month 'YYYY-MM', action_type, action_count) 월 집계 구조
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  try {
    const rows = await CueUsage.findAll({
      where: { business_id: businessId, year_month: ym },
      attributes: ['action_count']
    });
    return rows.reduce((sum, r) => sum + (r.action_count || 0), 0);
  } catch (e) {
    console.error('[plan] getCueActionsThisMonth failed:', e.message);
    return 0;
  }
}

async function getQnoteMinutesThisMonth(businessId) {
  // QnoteUsage 월 집계 테이블 조회.
  // Python Q Note 서비스가 세션 종료 시 POST /api/qnote/usage 로 누적 기록 (TODO 연동)
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  try {
    const row = await QnoteUsage.findOne({
      where: { business_id: businessId, year_month: ym },
      attributes: ['minutes_used']
    });
    return row ? row.minutes_used : 0;
  } catch (e) {
    console.error('[plan] getQnoteMinutesThisMonth failed:', e.message);
    return 0;
  }
}

/**
 * 권한 체크 — can(businessId, action, ctx)
 * 반환: { ok: boolean, reason?: string, limit?, current? }
 */
async function can(businessId, action, ctx = {}) {
  const { plan, biz, active } = await getBusinessPlan(businessId);
  if (!biz) return { ok: false, reason: 'business_not_found' };
  if (!active) return { ok: false, reason: 'subscription_inactive' };

  const limits = plan.limits;
  const features = plan.features;

  switch (action) {
    case 'upload_file': {
      const size = Number(ctx.size || 0);
      if (size > limits.file_size_max_bytes) {
        return { ok: false, reason: 'file_size_exceeded', limit: limits.file_size_max_bytes, current: size };
      }
      // 외부 클라우드 사용 시 자체 스토리지 쿼터 skip
      if (ctx.external) return { ok: true };
      const usage = await getUsage(businessId);
      if (usage.storage_bytes + size > limits.storage_bytes) {
        return { ok: false, reason: 'storage_quota_exceeded', limit: limits.storage_bytes, current: usage.storage_bytes };
      }
      return { ok: true };
    }
    case 'add_member': {
      const cur = await BusinessMember.count({ where: { business_id: businessId } });
      if (cur + 1 > limits.members_max) {
        return { ok: false, reason: 'members_quota_exceeded', limit: limits.members_max, current: cur };
      }
      return { ok: true };
    }
    case 'add_client': {
      const cur = await Client.count({ where: { business_id: businessId } });
      if (cur + 1 > limits.clients_max) {
        return { ok: false, reason: 'clients_quota_exceeded', limit: limits.clients_max, current: cur };
      }
      return { ok: true };
    }
    case 'create_project': {
      const cur = await Project.count({ where: { business_id: businessId } });
      if (cur + 1 > limits.projects_max) {
        return { ok: false, reason: 'projects_quota_exceeded', limit: limits.projects_max, current: cur };
      }
      return { ok: true };
    }
    case 'create_conversation': {
      const cur = await Conversation.count({ where: { business_id: businessId } });
      if (cur + 1 > limits.conversations_max) {
        return { ok: false, reason: 'conversations_quota_exceeded', limit: limits.conversations_max, current: cur };
      }
      return { ok: true };
    }
    case 'use_cue': {
      const needed = Number(ctx.actions || 1);
      const cur = await getCueActionsThisMonth(businessId);
      if (cur + needed > limits.cue_actions_monthly) {
        return { ok: false, reason: 'cue_quota_exceeded', limit: limits.cue_actions_monthly, current: cur };
      }
      return { ok: true };
    }
    case 'use_qnote': {
      const minutes = Number(ctx.minutes || 1);
      const cur = await getQnoteMinutesThisMonth(businessId);
      if (cur + minutes > limits.qnote_minutes_monthly) {
        return { ok: false, reason: 'qnote_quota_exceeded', limit: limits.qnote_minutes_monthly, current: cur };
      }
      return { ok: true };
    }
    case 'feature': {
      const key = ctx.feature;
      if (!features[key]) {
        return { ok: false, reason: 'feature_not_in_plan', feature: key };
      }
      return { ok: true };
    }
    default:
      return { ok: true };
  }
}

/**
 * Express 미들웨어 팩토리 — requirePlan('pro'), requireFeature('api_access') 등
 */
function requireFeature(featureKey) {
  return async (req, res, next) => {
    const bizId = req.params.businessId || req.body.business_id || req.query.business_id;
    if (!bizId) return res.status(400).json({ success: false, message: 'business_id required' });
    const r = await can(bizId, 'feature', { feature: featureKey });
    if (!r.ok) return res.status(403).json({ success: false, message: `feature_not_in_plan: ${featureKey}` });
    next();
  };
}

/**
 * 플랜 변경 + 이력 기록 (트랜잭션 안전)
 * reason: 'upgrade' | 'downgrade' | 'trial_start' | 'trial_end' | 'expire' | 'admin_adjust' | 'payment_failed' | 'refund'
 */
async function changePlan(businessId, { toPlan, reason, changedBy = null, note = null, expiresAt = null, trialEndsAt = null, graceEndsAt = null, scheduledPlan = null }) {
  const biz = await Business.findByPk(businessId);
  if (!biz) throw new Error('business_not_found');
  const fromPlan = biz.plan;
  const patch = { plan: toPlan };
  if (expiresAt !== null) patch.plan_expires_at = expiresAt;
  if (trialEndsAt !== null) patch.trial_ends_at = trialEndsAt;
  if (graceEndsAt !== null) patch.grace_ends_at = graceEndsAt;
  if (scheduledPlan !== null) patch.scheduled_plan = scheduledPlan;
  await biz.update(patch);
  await BusinessPlanHistory.create({
    business_id: businessId,
    from_plan: fromPlan,
    to_plan: toPlan,
    reason,
    changed_by: changedBy,
    note,
    effective_at: new Date(),
  });
  invalidateBusinessCache(businessId);
  return biz;
}

/**
 * 플랜 쿼터 초과 에러 응답 생성 헬퍼 — 표준 포맷
 */
function buildQuotaError(checkResult, businessId) {
  const MESSAGE_MAP = {
    file_size_exceeded: {
      message: '파일 크기 한도 초과',
      message_en: 'File size limit exceeded',
    },
    storage_quota_exceeded: {
      message: '저장소 용량 한도 초과',
      message_en: 'Storage quota exceeded',
      alternatives: ['외부 클라우드 연동 (Google Drive) 시 용량 제약 없음'],
    },
    members_quota_exceeded: { message: '멤버 수 한도 초과', message_en: 'Member limit exceeded' },
    clients_quota_exceeded: { message: '고객 수 한도 초과', message_en: 'Client limit exceeded' },
    projects_quota_exceeded: { message: '프로젝트 수 한도 초과', message_en: 'Project limit exceeded' },
    conversations_quota_exceeded: { message: '대화방 수 한도 초과', message_en: 'Conversation limit exceeded' },
    cue_quota_exceeded: { message: 'Cue AI 월 사용 한도 초과', message_en: 'Cue monthly limit exceeded' },
    qnote_quota_exceeded: { message: 'Q Note 월 녹음 시간 한도 초과', message_en: 'Q Note monthly minutes exceeded' },
    feature_not_in_plan: { message: '현재 플랜에서 지원되지 않는 기능', message_en: 'Feature not in your plan' },
    subscription_inactive: { message: '구독이 비활성화 상태입니다', message_en: 'Subscription is inactive' },
  };
  const m = MESSAGE_MAP[checkResult.reason] || { message: checkResult.reason, message_en: checkResult.reason };
  return {
    success: false,
    code: checkResult.reason,
    message: m.message,
    message_en: m.message_en,
    limit: checkResult.limit === Infinity ? null : checkResult.limit,
    current: checkResult.current,
    upgrade_url: `/business/settings/plan`,
    alternatives: m.alternatives || [],
  };
}

module.exports = {
  getBusinessPlan,
  getLimit,
  getUsage,
  can,
  requireFeature,
  changePlan,
  invalidateBusinessCache,
  limitForJson,
  buildQuotaError,
};
