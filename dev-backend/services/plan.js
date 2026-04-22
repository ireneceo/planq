// 플랜 엔진 — 비즈니스 플랜 확인 + 권한 체크 + 사용량 집계 통일 경로
// 모든 라우트는 이 파일만 거치게. 하드코딩 금지.

const { Op } = require('sequelize');
const {
  Business, BusinessMember, Client, Project, Conversation,
  File, BusinessStorageUsage, CueUsage,
} = require('../models');
const { getPlan } = require('../config/plans');

/**
 * 비즈니스의 현재 플랜 객체
 */
async function getBusinessPlan(businessId) {
  const biz = await Business.findByPk(businessId, { attributes: ['id', 'plan', 'subscription_status', 'plan_expires_at'] });
  if (!biz) return { plan: getPlan('free'), biz: null, active: false };
  // 만료된 플랜은 free 로 다운그레이드 (read-only)
  const expired = biz.plan_expires_at && new Date(biz.plan_expires_at) < new Date();
  const code = expired ? 'free' : (biz.plan || 'free');
  return {
    plan: getPlan(code),
    biz,
    active: !expired && ['active', 'trialing'].includes(biz.subscription_status || 'active'),
  };
}

/**
 * 특정 한도 값 (숫자) — 비교용
 */
async function getLimit(businessId, key) {
  const { plan } = await getBusinessPlan(businessId);
  return plan.limits[key];
}

/**
 * 사용량 집계 — 모든 키를 한 번에 (성능 우선)
 */
async function getUsage(businessId) {
  const [memberCount, clientCount, projectCount, conversationCount, storageRow, cueThisMonth, qnoteThisMonth] = await Promise.all([
    BusinessMember.count({ where: { business_id: businessId } }),
    Client.count({ where: { business_id: businessId } }),
    Project.count({ where: { business_id: businessId } }),
    Conversation.count({ where: { business_id: businessId } }),
    BusinessStorageUsage.findOne({ where: { business_id: businessId } }),
    getCueActionsThisMonth(businessId),
    getQnoteMinutesThisMonth(businessId),
  ]);

  return {
    members: memberCount,
    clients: clientCount,
    projects: projectCount,
    conversations: conversationCount,
    storage_bytes: storageRow ? Number(storageRow.bytes_used) : 0,
    file_count: storageRow ? storageRow.file_count : 0,
    cue_actions_this_month: cueThisMonth,
    qnote_minutes_this_month: qnoteThisMonth,
  };
}

async function getCueActionsThisMonth(businessId) {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  // CueUsage 모델은 (business_id, action_type, created_at) 구조 가정. 없으면 0 반환.
  try {
    return await CueUsage.count({ where: { business_id: businessId, createdAt: { [Op.gte]: monthStart } } });
  } catch {
    return 0;
  }
}

async function getQnoteMinutesThisMonth(businessId) {
  // Q Note 세션 시간 집계. 현재 세션 테이블에 duration 필드가 있으면 사용.
  // 초기 구현은 0 반환 — 세션 테이블 필드 확인 후 추후 연결.
  void businessId;
  return 0;
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

module.exports = {
  getBusinessPlan,
  getLimit,
  getUsage,
  can,
  requireFeature,
};
