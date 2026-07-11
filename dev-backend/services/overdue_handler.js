// 연체 처리 cron — 마감일이 지난 미결제 청구서를 "청구 담당자에게 물어보는" 단계까지만 자동화.
//
// 정책 (2026-07-11, Irene 확정):
//   결제 마킹이 수동이라 "고객은 입금했는데 아직 마킹 안 된" 상태가 정상적으로 존재한다.
//   그 상태에서 시스템이 스스로 독촉 메일을 보내면 이미 낸 고객을 재촉하는 사고가 난다.
//   → 고객에게 나가는 것(독촉 메일)은 전부 사람이 청구서에서 "결제 독촉 보내기"를 눌렀을 때만.
//   → cron 은 담당자에게 "마감 지났습니다. 독촉 보낼까요?" 알림만 보낸다.
//   (옛 동작: 마감 다음날 자동 독촉 메일 + 유예 도달 시 project.paused_at 자동 설정 + "정지되었습니다"
//    고객 메일. 자동 정지도 제거 — 결제 마킹이 수동이라 "입금했는데 마킹 전" 고객의 프로젝트를
//    시스템이 멋대로 멈출 수 있었다. 정지 여부는 사람이 판단한다.
//    ★ paused_at 은 죽은 필드가 아니다 — recurring_invoice.js 가 `paused_at: null` 로 필터해
//    정기 자동청구를 실제로 멈춘다. 다만 화면에서 수동으로 정지하는 경로는 아직 없다(설계 부채).
//    옛 paused_at 은 결제 마킹 시 unpauseProjectIfApplicable 가 정리한다.)
//
// 흐름 (daily):
//   - due_date 초과 + status not in (paid, draft, canceled) 인 invoice 검색
//   - status = 'overdue' 로 마킹 (사실 기록 — 외부로 나가지 않음)
//   - 청구 담당자(owner/admin + 청구서 담당자 + 워크스페이스 기본 청구담당)에게 알림
//   - 유예기간(overdue_grace_days) 초과분은 "장기 연체" 톤으로 강조
//
// 재알림/도배 방지:
//   - meta.last_overdue_notify_at (마지막 제안 알림) / meta.last_reminder_at (마지막 실제 독촉 발송)
//     둘 중 최근 시각으로부터 REASK_DAYS(7일) 지나야 다시 묻는다.
//     → 담당자가 독촉을 보내면 그 자체가 7일 스누즈로 동작한다.
//   - meta.overdue_notify_off = true 면 이 청구서는 더 묻지 않는다 (청구서 상세에서 끄기).

const { Op } = require('sequelize');
const { Project, Invoice } = require('../models');
const { resolveBillingRecipients } = require('./billingRecipients');

// 같은 청구서를 다시 묻기까지의 최소 간격
const REASK_DAYS = 7;
const REASK_MS = REASK_DAYS * 86400000;

function appUrl() {
  return process.env.APP_URL || 'https://dev.planq.kr';
}

// 단일 invoice 처리
async function handleOverdueInvoice(invoice, today = new Date(), ioApp = null) {
  if (!invoice.due_date) return { invoice_id: invoice.id, skipped: 'no_due_date' };
  if (invoice.status === 'paid') return { invoice_id: invoice.id, skipped: 'paid' };

  const dueDate = new Date(invoice.due_date);
  const daysOverdue = Math.floor((today - dueDate) / 86400000);
  if (daysOverdue < 1) return { invoice_id: invoice.id, skipped: 'not_overdue_yet' };

  const meta = (invoice.meta && typeof invoice.meta === 'object') ? { ...invoice.meta } : {};

  // 연체 사실 기록 — 외부 발송 아님. 상태만 갱신하고 알림 판단으로 넘어간다.
  if (invoice.status !== 'overdue') {
    await invoice.update({ status: 'overdue' });
  }

  if (meta.overdue_notify_off) {
    return { invoice_id: invoice.id, skipped: 'notify_off', days_overdue: daysOverdue };
  }

  // 최근에 물었거나(제안 알림) 최근에 실제 독촉을 보냈으면 조용히 넘어간다.
  const touchedAt = [meta.last_overdue_notify_at, meta.last_reminder_at]
    .filter(Boolean)
    .map((v) => new Date(v).getTime())
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => b - a)[0] || null;
  if (touchedAt && (today.getTime() - touchedAt) < REASK_MS) {
    return { invoice_id: invoice.id, skipped: 'recently_asked', days_overdue: daysOverdue };
  }

  const { userIds, business, workspaceName } = await resolveBillingRecipients(invoice);
  if (!business) return { invoice_id: invoice.id, skipped: 'business_not_found' };
  if (userIds.length === 0) return { invoice_id: invoice.id, skipped: 'no_recipient' };

  const graceDays = Number(business.overdue_grace_days || 7);
  const isLongOverdue = daysOverdue >= graceDays;
  const remindable = Boolean(invoice.client_id);
  const totalStr = `${Number(invoice.grand_total || 0).toLocaleString()} ${invoice.currency || 'KRW'}`;
  const project = invoice.project_id ? await Project.findByPk(invoice.project_id, { attributes: ['id', 'name'] }) : null;

  const title = isLongOverdue
    ? `장기 연체 ${daysOverdue}일 — ${invoice.invoice_number}`
    : `결제 기한 ${daysOverdue}일 지남 — ${invoice.invoice_number}`;

  const askLine = remindable
    ? '독촉 메일을 보낼지 확인해주세요. 이미 입금된 건이면 결제 완료로 표시하면 됩니다.'
    : '고객 이메일이 없어 독촉 메일을 보낼 수 없습니다. 청구서에서 수신 이메일을 확인해주세요.';

  const bodyParts = [
    `${invoice.title || invoice.invoice_number} · ${totalStr}`,
    project ? `프로젝트 "${project.name}"` : null,
    `결제 기한 ${String(invoice.due_date).slice(0, 10)}`,
    askLine,
  ].filter(Boolean);

  const { notifyMany } = require('../routes/notifications');
  await notifyMany({
    userIds,
    businessId: invoice.business_id,
    eventKind: 'invoice',
    title,
    body: bodyParts.join(' · '),
    link: `${appUrl()}/bills?tab=invoices&invoice=${invoice.id}`,
    ctaLabel: remindable ? '독촉 보낼지 확인' : '청구서 보기',
    workspaceName,
    entityType: 'invoice',
    entityId: invoice.id,
    ioApp,
  });

  meta.last_overdue_notify_at = today.toISOString();
  meta.overdue_notify_count = (Number(meta.overdue_notify_count) || 0) + 1;
  await invoice.update({ meta });

  return {
    invoice_id: invoice.id,
    project_id: invoice.project_id,
    action: 'asked',
    long_overdue: isLongOverdue,
    days_overdue: daysOverdue,
    notified: userIds.length,
  };
}

// Cron 진입 — 모든 미결제 연체 invoice 처리
async function runDailyOverdueCron(today = new Date(), ioApp = null) {
  const todayStr = today.toISOString().slice(0, 10);
  const invoices = await Invoice.findAll({
    where: {
      status: { [Op.notIn]: ['paid', 'draft', 'canceled'] },
      due_date: { [Op.lt]: todayStr },
    },
    attributes: ['id', 'business_id', 'project_id', 'client_id', 'owner_user_id', 'invoice_number', 'title', 'due_date', 'grand_total', 'currency', 'share_token', 'status', 'meta'],
  });

  const out = { asked: 0, long_overdue: 0, skip: 0, fail: 0, total: invoices.length };
  for (const inv of invoices) {
    try {
      const r = await handleOverdueInvoice(inv, today, ioApp);
      if (r.action === 'asked') {
        out.asked += 1;
        if (r.long_overdue) out.long_overdue += 1;
      } else out.skip += 1;
    } catch (e) {
      console.warn('[overdue] invoice', inv.id, 'crash', e.message);
      out.fail += 1;
    }
  }
  return out;
}

// 결제 마킹 시 호출 — 옛 자동정지(paused_at)가 남아 있으면 정리.
// 자동 정지는 폐지됐지만, 폐지 전에 정지된 프로젝트가 결제 후에도 묶여 있으면 안 되므로 유지.
async function unpauseProjectIfApplicable(invoice) {
  if (!invoice?.project_id) return null;
  const project = await Project.findByPk(invoice.project_id);
  if (!project || !project.paused_at) return null;
  // 미결제 invoice 더 있는지
  const stillUnpaid = await Invoice.count({
    where: {
      project_id: project.id,
      status: { [Op.notIn]: ['paid', 'canceled', 'draft'] },
    },
  });
  if (stillUnpaid > 0) return { unpaused: false, remaining: stillUnpaid };
  await project.update({ paused_at: null });
  return { unpaused: true };
}

module.exports = {
  runDailyOverdueCron,
  handleOverdueInvoice,
  unpauseProjectIfApplicable,
  REASK_DAYS,
};
