// services/invoiceRecurring.js — 정기/구독 청구서의 "정기 발송 기준" 표시 (#92)
//
// 구독 청구서 생성 시 meta.recurring 스냅샷을 남기고(어느 구독/프로젝트에서 나왔는지),
// 조회 시 그 구독/프로젝트의 라이브 상태(주기·다음 발행 예정일·활성 여부)로 해석해
// 청구서 상세·공개 결제 페이지에 "매월 N일 발행 · 다음 발송 7/10" 식으로 표시.
//   - 출처: client_subscription (ClientSubscription) / project (Project 월정액)
//   - best-effort: 구독/프로젝트가 삭제·해석 실패해도 스냅샷 값으로 graceful 폴백, throw 안 함.
const { ClientSubscription, Project } = require('../models');

// ── 날짜 유틸 (엔진과 동일하게 서버 로컬 날짜 기준) ──
function toDateStr(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  try { return new Date(d).toISOString().slice(0, 10); } catch (_) { return null; }
}
function dayOf(d) {
  const s = toDateStr(d);
  if (!s) return null;
  const n = Number(s.slice(8, 10));
  return Number.isFinite(n) ? n : null;
}
// 월정액(billing_day) 의 다음 발행 예정일 — 오늘 이후 가장 가까운 해당 일자(월말 보정).
function nextMonthlyBillingDate(billingDay, today = new Date()) {
  const day = Number(billingDay);
  if (!Number.isFinite(day) || day < 1) return null;
  const base = new Date(today.getFullYear(), today.getMonth(), 1);
  for (let i = 0; i < 14; i++) {
    const y = base.getFullYear();
    const m = base.getMonth() + i;
    const lastDay = new Date(y, m + 1, 0).getDate();   // 그 달 말일
    const d = Math.min(day, lastDay);                  // 31 설정인데 30일 달이면 30일
    const cand = new Date(y, m, d);
    if (cand >= new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
      return cand.toISOString().slice(0, 10);
    }
  }
  return null;
}

// ── 생성 시 저장할 meta.recurring 스냅샷 (기존 meta 보존) ──
function recurringMetaForSub(sub, existingMeta) {
  const base = (existingMeta && typeof existingMeta === 'object') ? { ...existingMeta } : {};
  base.recurring = {
    source: 'client_subscription',
    subscription_id: sub.id,
    interval: sub.interval || 'monthly',
    plan_name: sub.plan_name || null,
  };
  return base;
}
function recurringMetaForProject(project, existingMeta) {
  const base = (existingMeta && typeof existingMeta === 'object') ? { ...existingMeta } : {};
  base.recurring = {
    source: 'project',
    project_id: project.id,
    interval: 'monthly',
    billing_day: project.invoice_billing_day || null,
  };
  return base;
}

function baseFromSnapshot(rec) {
  return {
    source: rec.source,
    interval: rec.interval || 'monthly',
    active: null,             // 라이브 확인 불가 (구독/프로젝트 없음)
    status: null,
    next_billing_at: null,
    billing_day: rec.billing_day || null,
    plan_name: rec.plan_name || null,
  };
}

// ── 조회 시 라이브 해석 → 표시용 객체 (정기 아니면 null) ──
async function resolveRecurringInfo(invoice) {
  const meta = invoice && invoice.meta;
  const rec = (meta && typeof meta === 'object') ? meta.recurring : null;
  if (!rec || !rec.source) return null;
  try {
    if (rec.source === 'client_subscription' && rec.subscription_id) {
      const sub = await ClientSubscription.findOne({
        where: { id: rec.subscription_id, business_id: invoice.business_id },
        attributes: ['id', 'interval', 'status', 'next_billing_at', 'plan_name', 'start_date'],
      });
      if (!sub) return baseFromSnapshot(rec);
      const active = sub.status === 'active';
      return {
        source: 'client_subscription',
        interval: sub.interval || rec.interval || 'monthly',
        active,
        status: sub.status,
        next_billing_at: active ? toDateStr(sub.next_billing_at) : null,
        billing_day: dayOf(sub.start_date),
        plan_name: sub.plan_name || rec.plan_name || null,
      };
    }
    if (rec.source === 'project' && rec.project_id) {
      const project = await Project.findOne({
        where: { id: rec.project_id, business_id: invoice.business_id },
        attributes: ['id', 'status', 'auto_invoice_enabled', 'invoice_billing_day'],
      });
      if (!project) return baseFromSnapshot(rec);
      const active = project.status === 'active' && !!project.auto_invoice_enabled;
      const day = project.invoice_billing_day || rec.billing_day || null;
      return {
        source: 'project',
        interval: 'monthly',
        active,
        status: project.status,
        next_billing_at: active ? nextMonthlyBillingDate(day) : null,
        billing_day: day,
        plan_name: null,
      };
    }
  } catch (_) {
    return baseFromSnapshot(rec);
  }
  return baseFromSnapshot(rec);
}

module.exports = {
  recurringMetaForSub,
  recurringMetaForProject,
  resolveRecurringInfo,
  nextMonthlyBillingDate,
};
