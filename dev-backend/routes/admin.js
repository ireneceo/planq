// Platform Admin 전용 라우트 — 결제 연동 전 임시 플랜 수동 조정 / 체험 연장 / 이력 조회
// 모든 엔드포인트는 authenticateToken + requireRole('platform_admin') 이중 체크
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { Business, BusinessMember, User, BusinessPlanHistory, PlatformSetting, Subscription, Payment } = require('../models');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const planEngine = require('../services/plan');
const { PLANS, PLAN_ORDER, toPublicJson } = require('../config/plans');

router.use(authenticateToken, requireRole('platform_admin'));

const { isExemptNow, exemptBusinessIds } = require('../services/billingExemptView');

// 구독·결제 라우트는 절출됨(god-file 래칫). 이 라우터에 마운트해 인증 게이트를 공유한다.
router.use('/', require('./admin_billing'));



// ─── 관리자 조작 → 워크스페이스에 안내 (Irene 2026-08-17: "필요한 안내는 해야지") ───
//
// 여태 플랜 변경·체험 조정·면제 설정은 **감사 기록만 남기고 아무 안내도 안 갔다.**
// 특히 **면제 해제는 그 순간부터 돈이 나가기 시작**하는데 당사자가 모른다 — 반드시 알려야 한다.
//
// 수신자: 워크스페이스 owner (그 워크스페이스의 결제 책임자).
// eventKind 'subscription' — 사용자가 알림 설정에서 끌 수 있는 축. 채널은 기본(inbox+email+push).
// 발송 실패가 관리자 조작 자체를 실패시키면 안 되므로 fire-and-forget + catch.
async function notifyWorkspaceOwners(businessId, { title, body, ctaLabel = '결제 설정 열기' }) {
  try {
    const { notifyMany } = require('./notifications');
    const biz = await Business.findByPk(businessId, { attributes: ['name', 'brand_name'] });
    const owners = await BusinessMember.findAll({
      where: { business_id: businessId, role: 'owner', removed_at: null },
      attributes: ['user_id'],
    });
    const userIds = owners.map((o) => o.user_id).filter(Boolean);
    if (!userIds.length) return;
    await notifyMany({
      userIds,
      businessId,
      eventKind: 'subscription',
      title,
      body,
      link: '/business/settings/plan',
      ctaLabel,
      workspaceName: biz?.brand_name || biz?.name || null,
    });
  } catch (e) {
    console.warn('[admin notifyWorkspaceOwners]', e.message);
  }
}

// ─── 플랫폼 대시보드 집계 (overview) ───
// GET /api/admin/overview — 워크스페이스·사용자·구독·수익 KPI + 플랜 분포 + 6개월 가입 추이
router.get('/overview', async (req, res, next) => {
  try {
    const now = new Date();
    const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [bizTotal, bizNew, userTotal, userNew] = await Promise.all([
      Business.count({ where: { deleted_at: null } }),
      Business.count({ where: { deleted_at: null, createdAt: { [Op.gte]: d30 } } }),
      User.count(),
      User.count({ where: { createdAt: { [Op.gte]: d30 } } }),
    ]);

    // 구독 — 상태별 카운트 + 활성 구독의 플랜 분포
    const subCounts = await Subscription.findAll({
      attributes: ['status', [Subscription.sequelize.fn('COUNT', Subscription.sequelize.col('id')), 'count']],
      group: ['status'], raw: true,
    });
    const subscriptions = { active: 0, grace: 0, pending: 0, past_due: 0, demoted: 0, canceled: 0, total: 0 };
    for (const c of subCounts) {
      const n = Number(c.count);
      if (subscriptions[c.status] !== undefined) subscriptions[c.status] = n;
      subscriptions.total += n;
    }
    const planRows = await Subscription.findAll({
      attributes: ['plan_code', [Subscription.sequelize.fn('COUNT', Subscription.sequelize.col('id')), 'count']],
      where: { status: 'active' }, group: ['plan_code'], raw: true,
    });
    const by_plan = {};
    for (const r of planRows) by_plan[r.plan_code || 'unknown'] = Number(r.count);

    // 수익 — 이번 달 결제완료 합계 + 미수금(pending)
    // ★ 내부·테스터 워크스페이스의 결제 테스트는 매출이 아니다 (운영 #275). 숨기지 않고 **분리**한다 —
    //   금액이 통째로 사라지면 그것도 오정보라서 month_nonrevenue 로 같이 내려준다.
    //   pending 은 확정 전이라 is_revenue 가 아직 default(1) 이다. 그래서 여기서는 면제 워크스페이스
    //   자체를 제외한다 (Fable 재심 M4 — is_revenue 필터는 pending 에서 아무것도 거르지 못한다).
    //   ★ raw 플래그가 아니라 exemptBusinessIds() 를 쓴다 — 종료일이 지난 면제까지 세면
    //     정상 과금 재개된 워크스페이스의 미수금이 계속 빠진다 (Fable M1).
    const exemptBizIds = await exemptBusinessIds();
    const [monthRev, monthNonRev, pendingAmt] = await Promise.all([
      Payment.sum('amount', { where: { status: 'paid', is_revenue: true, paid_at: { [Op.gte]: monthStart } } }),
      Payment.sum('amount', { where: { status: 'paid', is_revenue: false, paid_at: { [Op.gte]: monthStart } } }),
      Payment.sum('amount', {
        where: {
          status: 'pending',
          ...(exemptBizIds.length ? { business_id: { [Op.notIn]: exemptBizIds } } : {}),
        },
      }),
    ]);

    // 면제 워크스페이스 수 — 활성 구독 KPI 가 유료처럼 보이지 않게 분리 노출
    const exemptActive = exemptBizIds.length;

    // 가입 추이 — 최근 6개월 워크스페이스 생성 수
    const signups = [];
    for (let i = 5; i >= 0; i--) {
      const s = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const e = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const count = await Business.count({ where: { deleted_at: null, createdAt: { [Op.gte]: s, [Op.lt]: e } } });
      signups.push({ month: `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}`, count });
    }

    return successResponse(res, {
      businesses: { total: bizTotal, new_30d: bizNew },
      users: { total: userTotal, new_30d: userNew },
      subscriptions: { ...subscriptions, by_plan, exempt_active: exemptActive },
      revenue: {
        month_paid: Number(monthRev || 0),
        month_nonrevenue: Number(monthNonRev || 0),
        pending_amount: Number(pendingAmt || 0),
      },
      signups,
    });
  } catch (err) { next(err); }
});

// ─── 워크스페이스 목록 ───
// GET /api/admin/businesses?q=검색어
router.get('/businesses', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    // 삭제된 워크스페이스는 관리자 목록에서도 숨긴다 (DB 행은 보존 — 복구는 deleted_at=NULL).
    const notDeleted = { deleted_at: null };
    // ★ 화면 placeholder 가 "이름 · 슬러그 검색" 이므로 실제로 둘 다 찾아야 한다 (Fable M5).
    //   이름만 찾으면 문구가 거짓말이 된다 — 실측: q='warpro-lab' → 0건.
    //   brand_name 도 포함한다(목록에 표시되는 이름이 brand_name 이면 그걸로 찾는 게 자연스럽다).
    const where = q ? {
      ...notDeleted,
      [Op.or]: [
        { name: { [Op.like]: `%${q}%` } },
        { brand_name: { [Op.like]: `%${q}%` } },
        { slug: { [Op.like]: `%${q}%` } },
      ],
    } : { ...notDeleted };
    const items = await Business.findAll({
      where,
      attributes: ['id', 'name', 'slug', 'plan', 'subscription_status', 'plan_expires_at', 'trial_ends_at', 'grace_ends_at', 'scheduled_plan', 'created_at',
        'billing_exempt', 'billing_exempt_kind', 'billing_exempt_plan', 'billing_exempt_until'],
      order: [['id', 'ASC']]
    });

    const memberCounts = await BusinessMember.findAll({
      attributes: ['business_id', [require('sequelize').fn('COUNT', require('sequelize').col('id')), 'n']],
      group: ['business_id'],
      raw: true
    });
    const memberMap = new Map(memberCounts.map(r => [Number(r.business_id), Number(r.n)]));

    successResponse(res, items.map(b => ({
      id: b.id,
      name: b.name,
      slug: b.slug,
      plan: b.plan,
      subscription_status: b.subscription_status,
      plan_expires_at: b.plan_expires_at,
      trial_ends_at: b.trial_ends_at,
      grace_ends_at: b.grace_ends_at,
      scheduled_plan: b.scheduled_plan,
      member_count: memberMap.get(b.id) || 0,
      // 결제 면제 (운영 #275) — 목록 뱃지용
      billing_exempt: !!b.billing_exempt,
      billing_exempt_kind: b.billing_exempt_kind,
      billing_exempt_plan: b.billing_exempt_plan,
      billing_exempt_until: b.billing_exempt_until,
      created_at: b.created_at,
    })));
  } catch (err) { next(err); }
});

// ─── 워크스페이스 상세 + 사용량 ───
// GET /api/admin/businesses/:id
router.get('/businesses/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const biz = await Business.findByPk(id);
    if (!biz) return errorResponse(res, 'Business not found', 404);

    const [{ plan }, usage] = await Promise.all([
      planEngine.getBusinessPlan(id),
      planEngine.getUsage(id)
    ]);

    successResponse(res, {
      id: biz.id,
      name: biz.name,
      slug: biz.slug,
      plan: biz.plan,
      subscription_status: biz.subscription_status,
      plan_expires_at: biz.plan_expires_at,
      trial_ends_at: biz.trial_ends_at,
      grace_ends_at: biz.grace_ends_at,
      scheduled_plan: biz.scheduled_plan,
      timezone: biz.timezone,
      created_at: biz.created_at,
      // 결제 면제 (운영 #275)
      billing_exempt: !!biz.billing_exempt,
      billing_exempt_kind: biz.billing_exempt_kind,
      billing_exempt_plan: biz.billing_exempt_plan,
      billing_exempt_until: biz.billing_exempt_until,
      billing_exempt_note: biz.billing_exempt_note,
      billing_exempt_set_at: biz.billing_exempt_set_at,
      effective_plan: toPublicJson(plan.code),
      usage: {
        members: usage.members,
        clients: usage.clients,
        projects: usage.projects,
        conversations: usage.conversations,
        storage_bytes: usage.storage_bytes,
        file_count: usage.file_count,
        cue_actions_this_month: usage.cue_actions_this_month,
        qnote_minutes_this_month: usage.qnote_minutes_this_month,
      }
    });
  } catch (err) { next(err); }
});

// ─── 플랜 이력 ───
// GET /api/admin/businesses/:id/history
router.get('/businesses/:id/history', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const rows = await BusinessPlanHistory.findAll({
      where: { business_id: id },
      include: [{ model: User, as: 'changer', attributes: ['id', 'name', 'email'], required: false }],
      order: [['created_at', 'DESC']],
      limit: 100
    });
    successResponse(res, rows.map(r => ({
      id: r.id,
      from_plan: r.from_plan,
      to_plan: r.to_plan,
      reason: r.reason,
      note: r.note,
      changed_by: r.changer ? { id: r.changer.id, name: r.changer.name, email: r.changer.email } : null,
      effective_at: r.effective_at,
      created_at: r.created_at,
    })));
  } catch (err) { next(err); }
});

// ─── 플랜 수동 변경 ───
// PUT /api/admin/businesses/:id/plan
// body: { to_plan, note?, plan_expires_at?, scheduled_plan? }
router.put('/businesses/:id/plan', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { to_plan, note = null, plan_expires_at = null, scheduled_plan = null } = req.body || {};

    if (!to_plan || !PLANS[to_plan]) {
      return errorResponse(res, 'Invalid plan code', 400);
    }
    // ★ 입력을 여기서 걸러야 한다 (Fable M2). 안 걸러면 잘못된 값이 그대로 DB 까지 내려가
    //   500 과 함께 **raw SQL 에러 문구가 클라이언트로 유출**된다
    //   (실측: plan_expires_at='garbage' → "Incorrect datetime value ... for column 'plan_expires_at'").
    if (scheduled_plan !== null && scheduled_plan !== undefined && scheduled_plan !== ''
        && !PLANS[scheduled_plan]) {
      return errorResponse(res, 'Invalid scheduled_plan', 400);
    }
    let expiresAt = null;
    if (plan_expires_at) {
      expiresAt = new Date(plan_expires_at);
      if (Number.isNaN(expiresAt.getTime())) {
        return errorResponse(res, 'Invalid plan_expires_at', 400);
      }
    }
    const biz = await Business.findByPk(id);
    if (!biz) return errorResponse(res, 'Business not found', 404);

    await planEngine.changePlan(id, {
      toPlan: to_plan,
      reason: 'admin_adjust',
      changedBy: req.user.id,
      note,
      expiresAt,
      scheduledPlan: scheduled_plan || null,
    });

    // 안내 — 플랜이 바뀌면 쓸 수 있는 한도가 달라진다. 당사자가 알아야 한다.
    if (biz.plan !== to_plan) {
      const planLabel = PLANS[to_plan]?.name_ko || to_plan;
      setImmediate(() => notifyWorkspaceOwners(id, {
        title: `요금제가 ${planLabel} 로 변경됐습니다`,
        body: `워크스페이스 요금제가 변경됐습니다. 사용 한도와 기능이 새 요금제 기준으로 적용됩니다.`,
        ctaLabel: '요금제 보기',
      }));
    }

    successResponse(res, { id, plan: to_plan }, 'Plan updated');
  } catch (err) { next(err); }
});

// ─── 결제 면제 설정 (운영 #275) ───
// PUT /api/admin/businesses/:id/billing-exempt
// body: { exempt: bool, kind: 'internal'|'tester'|'partner', plan: <플랜코드|null>,
//         until: ISO|null, note: string|null }
//
// 이 라우터는 파일 상단에서 authenticateToken + requireRole('platform_admin') 뒤에 마운트된다
// → 워크스페이스 owner 가 스스로 면제를 켜는 경로는 없다(권한 상승 = 무료 사용 차단).
//
// ★ 면제 ON 시 cron 을 기다리지 않고 **즉시** 정상화한다. 안 그러면 "설정했는데 배너 그대로" 가 되어
//   사용자는 고쳐진 사실에 도달하지 못한다 (memory feedback_fixed_but_unreachable).
router.put('/businesses/:id/billing-exempt', async (req, res, next) => {
  const { sequelize } = require('../config/database');
  try {
    const id = Number(req.params.id);
    const { exempt, kind = null, plan = null, until = null, note = null } = req.body || {};

    const biz = await Business.findByPk(id);
    if (!biz) return errorResponse(res, 'Business not found', 404);

    const on = !!exempt;
    if (on) {
      if (!['internal', 'tester', 'partner'].includes(kind)) {
        return errorResponse(res, 'invalid_kind', 400);
      }
      // ★ 플랜 코드는 PLANS 키만 — ADDONS 코드(member, clients_10 …)가 섞이면 getPlan 이 깨진다.
      if (plan !== null && plan !== '' && !Object.keys(PLANS).includes(plan)) {
        return errorResponse(res, 'invalid_plan_code', 400);
      }
    }
    const untilDate = until ? new Date(until) : null;
    if (until && isNaN(untilDate.getTime())) return errorResponse(res, 'invalid_until', 400);

    const oldValue = {
      billing_exempt: !!biz.billing_exempt,
      billing_exempt_kind: biz.billing_exempt_kind,
      billing_exempt_plan: biz.billing_exempt_plan,
      billing_exempt_until: biz.billing_exempt_until,
      billing_exempt_note: biz.billing_exempt_note,
    };

    const t = await sequelize.transaction();
    try {
      await biz.update({
        billing_exempt: on,
        billing_exempt_kind: on ? kind : null,
        billing_exempt_plan: on ? (plan || null) : null,
        billing_exempt_until: on ? untilDate : null,
        billing_exempt_note: on ? (note ? String(note).slice(0, 255) : null) : null,
        billing_exempt_set_by: req.user.id,
        billing_exempt_set_at: new Date(),
      }, { transaction: t });

      // ★ 캐시 무효화는 commit 뒤에만 한다 (아래). 커밋 전에 비우면 동시 요청이 미커밋(구) 값을
      //   다시 캐시에 채워 넣는 창이 열린다. restoreExemptSubscription 은 isBillingExempt 를
      //   부르지 않으므로 여기서 미리 비울 이유도 없다.
      if (on) {
        const billing = require('../services/billing');
        // 구독·워크스페이스 상태 정상화 (단일 헬퍼 — cron 과 같은 것을 쓴다)
        await billing.restoreExemptSubscription(id, { transaction: t });
        // 잔여 미결제 청구 취소 — 면제인데 "결제하세요" 가 남아 있으면 안 된다.
        await Payment.update(
          { status: 'canceled', cancel_reason: 'billing_exempt' },
          { where: { business_id: id, status: 'pending' }, transaction: t }
        );
      }

      await t.commit();
    } catch (e) {
      await t.rollback();
      throw e;
    }
    planEngine.invalidateBusinessCache(id);

    const { AuditLog } = require('../models');
    await AuditLog.create({
      user_id: req.user.id,
      business_id: id,
      action: 'business.billing_exempt',
      target_type: 'business',
      target_id: id,
      old_value: oldValue,
      new_value: {
        billing_exempt: on,
        billing_exempt_kind: on ? kind : null,
        billing_exempt_plan: on ? (plan || null) : null,
        billing_exempt_until: on ? untilDate : null,
        billing_exempt_note: on ? note : null,
      },
    }).catch(() => null);

    await biz.reload();

    // 안내 — ON/OFF 는 사용자에게 전혀 다른 사건이다.
    //   OFF 는 "이제부터 청구가 재개된다" 는 뜻이라 특히 놓치면 안 된다.
    const KIND_KO = { internal: '내부 이용', tester: '테스터', partner: '파트너' };
    // ★ 값이 안 바뀌었으면 알리지 않는다 (Fable 중요-1).
    //   관리자가 모달을 값 변경 없이 재저장할 때마다 owner 에게 같은 안내가 또 간다.
    const sameAsBefore = oldValue.billing_exempt === on
      && (oldValue.billing_exempt_kind || null) === (on ? kind : null)
      && (oldValue.billing_exempt_plan || null) === (on ? (plan || null) : null)
      && String(oldValue.billing_exempt_until || '') === String(on ? (untilDate || '') : '');
    if (sameAsBefore) {
      // 변경 없음 — 안내 생략 (감사 기록은 위에서 이미 남았다)
    } else if (on) {
      const untilTxt = untilDate
        ? `${untilDate.toISOString().slice(0, 10)}까지 적용되며, 그 이후에는 정상 요금제로 돌아갑니다.`
        : '종료일 없이 적용됩니다.';
      setImmediate(() => notifyWorkspaceOwners(id, {
        title: '구독료가 청구되지 않습니다',
        body: `${KIND_KO[kind] || '면제'} 워크스페이스로 설정되어 구독료 청구·유예·잠금이 모두 멈췄습니다. `
          + `미결제 청구가 있었다면 함께 취소됐습니다. ${untilTxt}`,
        ctaLabel: '구독 상태 보기',
      }));
    } else if (oldValue.billing_exempt) {
      setImmediate(() => notifyWorkspaceOwners(id, {
        title: '구독료 청구가 다시 시작됩니다',
        body: '결제 면제가 해제되어 다음 결제 주기부터 정상 요금제로 청구됩니다. '
          + '결제 수단과 청구 정보를 미리 확인해 주세요.',
      }));
    }

    return successResponse(res, {
      id,
      billing_exempt: !!biz.billing_exempt,
      billing_exempt_kind: biz.billing_exempt_kind,
      billing_exempt_plan: biz.billing_exempt_plan,
      billing_exempt_until: biz.billing_exempt_until,
      billing_exempt_note: biz.billing_exempt_note,
    }, 'Billing exemption updated');
  } catch (err) { next(err); }
});

// ─── 체험 기간 설정/연장 ───
// PUT /api/admin/businesses/:id/trial
// body: { trial_ends_at (ISO) | null }  — null 이면 체험 종료 즉시 해제
router.put('/businesses/:id/trial', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { trial_ends_at } = req.body || {};

    const biz = await Business.findByPk(id);
    if (!biz) return errorResponse(res, 'Business not found', 404);

    const nextDate = trial_ends_at ? new Date(trial_ends_at) : null;
    if (trial_ends_at && isNaN(nextDate.getTime())) {
      return errorResponse(res, 'Invalid trial_ends_at', 400);
    }

    const from = biz.trial_ends_at;
    biz.trial_ends_at = nextDate;
    await biz.save();

    await BusinessPlanHistory.create({
      business_id: id,
      from_plan: biz.plan,
      to_plan: biz.plan,
      reason: 'admin_adjust',
      changed_by: req.user.id,
      note: `체험 기간 ${from ? new Date(from).toISOString().slice(0,10) : '미설정'} → ${nextDate ? nextDate.toISOString().slice(0,10) : '해제'}`,
      effective_at: new Date(),
    });

    planEngine.invalidateBusinessCache?.(id);

    // 안내 — 체험 기간이 바뀌면 언제까지 무료인지가 달라진다.
    // 값이 안 바뀌었으면 알리지 않는다 (동일값 재저장 중복 방지).
    if (String(from || '') !== String(nextDate || '')) setImmediate(() => notifyWorkspaceOwners(id, nextDate
      ? {
        title: `체험 기간이 ${String(nextDate.toISOString()).slice(0, 10)} 까지로 조정됐습니다`,
        body: '체험 종료일이 변경됐습니다. 종료 후에는 요금제 결제가 필요합니다.',
        ctaLabel: '구독 상태 보기',
      }
      : {
        title: '체험 기간이 해제됐습니다',
        body: '체험 설정이 해제되어 요금제 기준으로 전환됩니다. 구독 상태를 확인해 주세요.',
        ctaLabel: '구독 상태 보기',
      }));

    successResponse(res, { id, trial_ends_at: biz.trial_ends_at }, 'Trial updated');
  } catch (err) { next(err); }
});

// ─── 플랜 카탈로그 (admin 용 Infinity 포함 x, 공용과 동일) ───
router.get('/plans/catalog', async (_req, res, next) => {
  try {
    successResponse(res, PLAN_ORDER.map(c => toPublicJson(c)));
  } catch (err) { next(err); }
});

// ─── 사이클 N+4 — Web Push 발송 모니터링 ───
// GET /api/admin/push-logs?status=&user_id=&page=&limit=
//   각 발송 시도 1 row. 운영 가시성·실패율·abuse 추적.
router.get('/push-logs', async (req, res, next) => {
  try {
    const { PushLog } = require('../models');
    const where = {};
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.user_id) where.user_id = Number(req.query.user_id);
    if (req.query.category) where.category = String(req.query.category);
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const { count, rows } = await PushLog.findAndCountAll({
      where,
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'], required: false }],
      order: [['created_at', 'DESC']],
      limit,
      offset: (page - 1) * limit,
    });
    return res.json({
      success: true,
      data: rows.map(r => r.toJSON()),
      pagination: { page, limit, total: count },
    });
  } catch (err) { next(err); }
});

// GET /api/admin/push-logs/stats — 7일 통계 + status 분포 + endpoint host top + 실패율
router.get('/push-logs/stats', async (req, res, next) => {
  try {
    const { PushLog } = require('../models');
    const { Op, fn, col, literal } = require('sequelize');
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 30);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // 1. status 별 카운트
    const byStatus = await PushLog.findAll({
      where: { created_at: { [Op.gte]: since } },
      attributes: ['status', [fn('COUNT', col('id')), 'count']],
      group: ['status'],
      raw: true,
    });

    // 2. endpoint host 별 top (실제 발송 처)
    const byHost = await PushLog.findAll({
      where: { created_at: { [Op.gte]: since }, endpoint_host: { [Op.ne]: null } },
      attributes: ['endpoint_host', [fn('COUNT', col('id')), 'count']],
      group: ['endpoint_host'],
      order: [[fn('COUNT', col('id')), 'DESC']],
      limit: 10,
      raw: true,
    });

    // 3. 일별 추이 (최근 N일)
    const daily = await PushLog.findAll({
      where: { created_at: { [Op.gte]: since } },
      attributes: [
        [fn('DATE', col('created_at')), 'day'],
        [fn('COUNT', col('id')), 'total'],
        [fn('SUM', literal("CASE WHEN status = 'sent' THEN 1 ELSE 0 END")), 'sent'],
        [fn('SUM', literal("CASE WHEN status IN ('failed','expired') THEN 1 ELSE 0 END")), 'failed'],
      ],
      group: [fn('DATE', col('created_at'))],
      order: [[fn('DATE', col('created_at')), 'ASC']],
      raw: true,
    });

    const totalRows = byStatus.reduce((s, r) => s + Number(r.count), 0);
    const sentRows = Number(byStatus.find(r => r.status === 'sent')?.count || 0);
    const failedRows = Number(byStatus.find(r => r.status === 'failed')?.count || 0)
      + Number(byStatus.find(r => r.status === 'expired')?.count || 0);
    const failureRate = totalRows > 0 ? (failedRows / totalRows) : 0;

    return res.json({
      success: true,
      data: {
        days,
        total: totalRows,
        sent: sentRows,
        failed: failedRows,
        failure_rate: failureRate,
        by_status: byStatus,
        by_host: byHost,
        daily,
      },
    });
  } catch (err) { next(err); }
});

// ─── Q-C 메일 모니터링 ───
// GET /api/admin/email-logs?status=&template=&business_id=&page=&limit=
router.get('/email-logs', async (req, res, next) => {
  try {
    const { EmailLog } = require('../models');
    const where = {};
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.template) where.template = String(req.query.template);
    if (req.query.business_id) where.business_id = Number(req.query.business_id);
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const { count, rows } = await EmailLog.findAndCountAll({
      where,
      include: [{ model: User, as: 'initiator', attributes: ['id', 'name'], required: false }],
      order: [['created_at', 'DESC']],
      limit,
      offset: (page - 1) * limit,
    });
    return res.json({
      success: true,
      data: rows.map(r => r.toJSON()),
      pagination: { page, limit, total: count },
    });
  } catch (err) { next(err); }
});

// POST /api/admin/email-logs/:id/retry — 재발송 트리거 (현재는 카운트만 증가, 추후 템플릿 핸들러 연결).
//   PII 우려로 html 본문은 EmailLog 에 저장 안 함. 재발송은 template 식별자 + related_entity 로 다시 빌드.
router.post('/email-logs/:id/retry', async (req, res, next) => {
  try {
    const { EmailLog } = require('../models');
    const log = await EmailLog.findByPk(req.params.id);
    if (!log) return errorResponse(res, 'not_found', 404);
    if (log.status === 'sent') return errorResponse(res, 'already_sent', 400);
    if (!log.template) return errorResponse(res, 'manual_retry_unsupported', 400);
    await log.update({ retry_count: log.retry_count + 1 });
    return successResponse(res, log.toJSON(), 'retry_queued');
  } catch (err) { next(err); }
});

// ─── 플랫폼 설정 (브랜드·법인·지원 메일·로고 등) — DB 단일 row ───
// .env 의 PLATFORM_*, EMAIL_LOGO_URL 대체. emailService 가 5분 캐시로 조회.

// GET /api/admin/platform-settings — 현재 row 조회 (없으면 빈 객체 반환, 클라가 PUT 으로 생성)
// Stripe secret/webhook 은 암호문조차 프론트로 보내지 않음 — 설정 여부 boolean 만.
//   전역 toJSON(models/index.js)이 이미 *_enc → *_set redaction 을 수행하므로 그대로 반환.
//   (이전엔 여기서 j.stripe_secret_enc 로 _set 를 재계산했으나, 전역 toJSON 이 _enc 를 먼저 지워
//    항상 false 가 되던 회귀 — Fable F-1. instance 가 아닌 toJSON 결과를 다시 읽지 말 것.)
function serializePlatformSettings(row) {
  const j = row.toJSON();
  // PortOne 은 걷어냈다 — 입력 경로가 없으므로 응답에서도 내보내지 않는다(죽은 필드 노출 금지).
  //   DB 컬럼과 결제 이력(Payment.method ENUM 'portone')은 그대로 둔다.
  delete j.portone_store_id;
  delete j.portone_channel_key;
  delete j.portone_channel_key_billing;
  delete j.portone_webhook_secret;
  return j;
}

router.get('/platform-settings', async (req, res, next) => {
  try {
    const row = await PlatformSetting.findOne({ order: [['id', 'ASC']] });
    if (!row) return successResponse(res, null);
    const data = serializePlatformSettings(row);
    // "카드 결제 켜짐" 은 서버가 판정해서 내려준다.
    //   *_set 은 "암호문이 존재하는가" 일 뿐이라, 암호화 키 회전·blob 손상 시 실제 결제 가능 여부와
    //   갈린다(_set=true 인데 복호화 실패로 결제는 꺼짐). 화면이 두 조건을 재조합하면 그 순간
    //   거짓 "켜짐" 이 생긴다 — 실제 소비처(routes/plan.js·invoices.js)와 같은 단일 원천을 쓴다.
    try {
      const { isStripeEnabled } = require('../services/stripeService');
      data.stripe_enabled = await isStripeEnabled('platform');
    } catch { data.stripe_enabled = false; }
    return successResponse(res, data);
  } catch (err) { next(err); }
});

// PUT /api/admin/platform-settings — 단일 row upsert.
//   body 의 알려진 필드만 업데이트. 다른 필드는 보존. 결제 설정 (bank/portone/vat/due) 같이 처리.
router.put('/platform-settings', async (req, res, next) => {
  try {
    const b = req.body || {};
    const { encrypt, usingFallbackKey } = require('../services/encryption'); // Stripe secret AES-256-GCM 저장용
    // F3: 운영에서 EMAIL_ENCRYPTION_KEY 없이(JWT 파생 fallback) 결제 시크릿 저장 금지 — 유출/회전 위험.
    if ((b.stripe_secret || b.stripe_webhook_secret) && usingFallbackKey() && process.env.NODE_ENV === 'production') {
      return errorResponse(res, 'encryption_key_required: EMAIL_ENCRYPTION_KEY 를 설정해야 결제 시크릿을 저장할 수 있습니다.', 400);
    }
    if (b.brand !== undefined && (!String(b.brand).trim() || String(b.brand).length > 100)) {
      return errorResponse(res, 'brand_invalid', 400);
    }
    // Stripe 키 형식 — 접두가 틀리면 저장 자체를 막는다(프론트 검증만으론 API 직호출로 재발).
    const badKey = require('../services/stripeService').invalidStripeKeyField(b);
    if (badKey) {
      return errorResponse(res, `invalid_stripe_key_format: ${badKey.field} must start with ${badKey.expected.join(' or ')}`, 400);
    }
    const setStr = (k, max) => (b[k] !== undefined ? { [k]: b[k] ? String(b[k]).slice(0, max) : null } : {});
    const setNum = (k, fb) => (b[k] !== undefined && Number.isFinite(Number(b[k])) ? { [k]: Number(b[k]) } : (fb !== undefined ? {} : {}));
    const updates = {
      ...(b.brand !== undefined ? { brand: String(b.brand).trim() } : {}),
      ...setStr('tagline', 300),
      ...setStr('website', 300),
      ...setStr('support_email', 200),
      ...setStr('legal_entity', 100),
      // 사업자 정보 (전자상거래법 표시의무 — 랜딩 푸터)
      ...setStr('biz_registration_no', 20),
      ...setStr('mail_order_no', 60),
      ...setStr('representative_name', 80),
      ...setStr('company_phone', 40),
      ...setStr('company_email', 200),
      ...setStr('company_address', 300),
      ...setStr('email_logo_url', 500),
      // 결제 설정
      ...setStr('bank_name', 100),
      ...setStr('bank_account_number', 50),
      ...setStr('bank_account_holder', 100),
      ...setStr('bank_name_en', 200),
      ...setStr('bank_account_holder_en', 200),
      ...setStr('swift_code', 20),
      // Stripe — publishable 평문. secret/webhook 은 AES-256-GCM 암호화 후 저장.
      //   값 있으면 암호화, 빈 문자열이면 해제(null), undefined(미전송)면 기존 보존.
      ...setStr('stripe_publishable_key', 255),
      ...(b.stripe_secret !== undefined
        ? { stripe_secret_enc: b.stripe_secret ? encrypt(String(b.stripe_secret)) : null } : {}),
      ...(b.stripe_webhook_secret !== undefined
        ? { stripe_webhook_secret_enc: b.stripe_webhook_secret ? encrypt(String(b.stripe_webhook_secret)) : null } : {}),
      // PortOne 은 걷어냈다(입력 경로 제거). DB 컬럼·결제 이력 ENUM 은 보존.
      ...setNum('default_vat_rate'),
      ...setNum('default_due_days'),
      // 약관 버전 + 점검·공지 (2026-05-05)
      ...setStr('terms_version', 20),
      ...setStr('privacy_version', 20),
      ...(b.maintenance_mode !== undefined ? { maintenance_mode: !!b.maintenance_mode } : {}),
      ...setStr('maintenance_message', 500),
      ...setStr('announcement_text', 500),
      ...setStr('announcement_text_en', 500),
      ...(b.announcement_dismissible !== undefined ? { announcement_dismissible: !!b.announcement_dismissible } : {}),
      ...(b.announcement_severity && ['info', 'warn', 'critical'].includes(b.announcement_severity)
        ? { announcement_severity: b.announcement_severity } : {}),
      // SEO / SNS 공유 메타 (사이클 N+23)
      ...setStr('seo_title', 255),
      ...setStr('seo_description', 500),
      ...setStr('seo_keywords', 500),
      ...setStr('og_image_url', 500),
      ...setStr('app_ios_url', 500),
      ...setStr('app_android_url', 500),
      updated_by_user_id: req.user.id,
    };
    // VAT rate 0~1 검증
    if (updates.default_vat_rate !== undefined && (updates.default_vat_rate < 0 || updates.default_vat_rate > 1)) {
      return errorResponse(res, 'vat_rate_out_of_range (0~1)', 400);
    }
    if (updates.default_due_days !== undefined && (updates.default_due_days < 0 || updates.default_due_days > 365)) {
      return errorResponse(res, 'due_days_out_of_range (0~365)', 400);
    }
    let row = await PlatformSetting.findOne({ order: [['id', 'ASC']] });
    if (row) {
      await row.update(updates);
    } else {
      row = await PlatformSetting.create({ brand: updates.brand || 'PlanQ', ...updates });
    }
    // emailService + maintenance + ogMeta 캐시 무효화
    try { require('../services/emailService').invalidatePlatformCache?.(); } catch { /* */ }
    try { require('../middleware/maintenance').invalidateMaintenanceCache?.(); } catch { /* */ }
    try { require('../middleware/ogMeta').invalidatePlatformCache?.(); } catch { /* */ }
    require('../services/auditService').logAudit(req, {
      action: 'platform_settings.update',
      targetType: 'platform_setting',
      targetId: row.id,
      newValue: updates,
    });
    return successResponse(res, serializePlatformSettings(row), 'updated'); // F1: PUT 도 암호문 redact
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════
// 운영자 도구 (2026-05-05) — 사칭 / AuditLog 조회 / GDPR export
// ═══════════════════════════════════════════════════════════════

// GET /api/admin/users — 전체 사용자 검색·필터 (이메일·이름)
router.get('/users', async (req, res, next) => {
  try {
    const { User } = require('../models');
    const { Op } = require('sequelize');
    const where = {};
    if (req.query.q) {
      const q = String(req.query.q).trim();
      if (q) where[Op.or] = [
        { email: { [Op.like]: `%${q}%` } },
        { name: { [Op.like]: `%${q}%` } },
        { username: { [Op.like]: `%${q}%` } },
      ];
    }
    if (req.query.role) where.platform_role = String(req.query.role);
    if (req.query.status) where.status = String(req.query.status);
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const rows = await User.findAll({
      where, limit,
      attributes: ['id', 'email', 'name', 'username', 'platform_role', 'status', 'email_verified_at', 'created_at', 'last_login_at'],
      order: [['created_at', 'DESC']],
    });
    return successResponse(res, rows.map(r => r.toJSON()));
  } catch (err) { next(err); }
});

// POST /api/admin/users/:id/impersonate — 30분 만료 토큰 발급. AuditLog 강제 기록.
//   고객 지원 시 "이 사용자가 보는 화면" 디버깅 용. 본인 액션은 user impersonator 로 추적.
router.post('/users/:id/impersonate', async (req, res, next) => {
  try {
    const { User, AuditLog } = require('../models');
    const target = await User.findByPk(req.params.id, { attributes: ['id','email','name','status'] });
    if (!target) return errorResponse(res, 'user_not_found', 404);
    if (target.status !== 'active') return errorResponse(res, 'user_not_active', 400);
    const jwt = require('jsonwebtoken');
    const token = jwt.sign(
      { userId: target.id, id: target.id, email: target.email, impersonator: req.user.id },
      process.env.JWT_SECRET,
      { expiresIn: '30m' }
    );
    await AuditLog.create({
      user_id: req.user.id, business_id: null,
      action: 'user.impersonate',
      target_type: 'User', target_id: target.id,
      new_value: { target_email: target.email, expires_in: '30m', impersonator_id: req.user.id },
    });
    // ★ 대리 로그인에는 이미지 쿠키를 **주지 않는다.**
    //   화면(AdminUsersPage)이 같은 브라우저의 새 탭으로 열기 때문이다. 여기서 대상자 신원으로
    //   쿠키를 덮으면 **운영자 본인 탭의 이미지 신원까지 대상자 것으로 바뀐다.** 그리고 운영자
    //   탭이 14분 뒤 refresh 하면 다시 운영자 것으로 덮인다 — 한 jar 에 두 신원이 번갈아 앉는다.
    //   Stage 2 에서 대리 탭의 이미지를 어떻게 다룰지는 별도 설계가 필요하다(Fable 지적).
    //   Stage 1 은 아무것도 막지 않으므로 안 줘도 대리 화면은 종전과 똑같이 보인다.
    return successResponse(res, { access_token: token, target: { id: target.id, email: target.email, name: target.name } }, 'impersonation_token_issued');
  } catch (err) { next(err); }
});

// GET /api/admin/audit-logs — 운영자 액션 추적. 필터: user_id, action, target_type, business_id, 기간
// 사이클 N+59 — pagination (N+50 표준) + business_id filter 추가 (특정 워크스페이스 audit 만 조회)
router.get('/audit-logs', async (req, res, next) => {
  try {
    const { AuditLog, User } = require('../models');
    const { Op } = require('sequelize');
    const { parsePagination, paginatedResponse } = require('../middleware/errorHandler');
    const where = {};
    if (req.query.user_id) where.user_id = Number(req.query.user_id);
    if (req.query.business_id) where.business_id = Number(req.query.business_id);
    if (req.query.action) where.action = String(req.query.action).slice(0, 100);
    if (req.query.target_type) where.target_type = String(req.query.target_type).slice(0, 50);
    if (req.query.from) where.created_at = { ...(where.created_at || {}), [Op.gte]: new Date(String(req.query.from)) };
    if (req.query.to) where.created_at = { ...(where.created_at || {}), [Op.lte]: new Date(String(req.query.to)) };
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 200, maxLimit: 500 });
    const { rows, count } = await AuditLog.findAndCountAll({
      where,
      include: [{ model: User, attributes: ['id', 'name', 'email'], required: false }],
      order: [['created_at', 'DESC']],
      limit, offset,
      distinct: true,
    });
    return paginatedResponse(res, rows.map(r => r.toJSON()), count, { limit, page, offset });
  } catch (err) { next(err); }
});

// GET /api/admin/users/:id/data-export — GDPR data export
//   해당 사용자의 모든 개인 데이터 (User row + AuditLog + 본인 메시지 일부) 를 JSON 으로
router.get('/users/:id/data-export', async (req, res, next) => {
  try {
    const { User, AuditLog, Business, BusinessMember, ContactInquiry, FeedbackItem } = require('../models');
    const target = await User.findByPk(req.params.id, {
      attributes: { exclude: ['password_hash', 'password_reset_token', 'email_verify_token', 'secondary_email_otp_hash'] },
    });
    if (!target) return errorResponse(res, 'user_not_found', 404);

    const [memberships, owned, audits, inquiries, feedbacks] = await Promise.all([
      BusinessMember.findAll({ where: { user_id: target.id } }),
      Business.findAll({ where: { owner_id: target.id }, attributes: ['id','name','brand_name','plan','created_at'] }),
      AuditLog.findAll({ where: { user_id: target.id }, limit: 1000, order: [['id','DESC']] }),
      ContactInquiry.findAll({ where: { from_user_id: target.id } }),
      FeedbackItem.findAll({ where: { user_id: target.id } }),
    ]);

    await AuditLog.create({
      user_id: req.user.id, business_id: null,
      action: 'user.data_export',
      target_type: 'User', target_id: target.id,
      new_value: { target_email: target.email, exported_at: new Date().toISOString() },
    });

    return successResponse(res, {
      exported_at: new Date().toISOString(),
      requested_by: { id: req.user.id, email: req.user.email },
      user: target.toJSON(),
      memberships: memberships.map(m => m.toJSON()),
      owned_businesses: owned.map(b => b.toJSON()),
      audit_logs: audits.map(a => a.toJSON()),
      contact_inquiries: inquiries.map(i => i.toJSON()),
      feedback_items: feedbacks.map(f => f.toJSON()),
    });
  } catch (err) { next(err); }
});

module.exports = router;
