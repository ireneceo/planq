// 연체 처리 cron — 정기 프로젝트의 연체 invoice 단계별 처리
//
// 흐름 (daily):
//   - due_date 초과 + status != 'paid' + business_id 의 정기 프로젝트 invoice 검색
//   - 연체 일수 = today - due_date
//   - 1일 차: 1차 알림 (client + 워크스페이스 멤버)
//   - 7일 (또는 grace_days/2) 차: 2차 알림 (워크스페이스 + "곧 정지" 경고)
//   - grace_days 도달: project.paused_at = NOW + 워크스페이스 + client 에 정지 통보
//
// 멱등성:
//   - Invoice.meta JSON 에 last_overdue_notify_stage = 1|2|paused 저장
//   - 같은 stage 는 중복 발송 안 됨

const { Op } = require('sequelize');
const { Project, Business, Invoice, Client, BusinessMember, sequelize } = require('../models');

// 단일 invoice 처리
async function handleOverdueInvoice(invoice, today = new Date()) {
  if (!invoice.due_date) return { invoice_id: invoice.id, skipped: 'no_due_date' };
  if (invoice.status === 'paid') return { invoice_id: invoice.id, skipped: 'paid' };

  const dueDate = new Date(invoice.due_date);
  const daysOverdue = Math.floor((today - dueDate) / 86400000);
  if (daysOverdue < 1) return { invoice_id: invoice.id, skipped: 'not_overdue_yet' };

  const business = await Business.findByPk(invoice.business_id, {
    attributes: ['id', 'name', 'brand_name', 'overdue_grace_days'],
  });
  if (!business) return { invoice_id: invoice.id, skipped: 'business_not_found' };

  const graceDays = Number(business.overdue_grace_days || 7);
  const project = invoice.project_id ? await Project.findByPk(invoice.project_id) : null;

  // meta JSON 에 stage 저장 (DB column 추가 없이 멱등성 확보)
  const meta = (invoice.meta && typeof invoice.meta === 'object') ? { ...invoice.meta } : {};
  const lastStage = meta.last_overdue_notify_stage || null;

  const wsName = business.brand_name || business.name || null;
  const invLink = `${process.env.APP_URL || 'https://dev.planq.kr'}/bills?tab=invoices&invoice=${invoice.id}`;

  // 워크스페이스 멤버 알림 — fan-out 은 setImmediate fire-and-forget.
  // overdue cron 메인 흐름이 한 invoice 의 알림 처리 시간만큼 막히지 않게.
  const notifyMembers = (eventKind, title, body, link, ctaLabel) => {
    setImmediate(async () => {
      try {
        const members = await BusinessMember.findAll({
          where: { business_id: invoice.business_id, removed_at: null, role: { [Op.in]: ['owner', 'admin', 'member'] } },
          attributes: ['user_id'],
        });
        const userIds = members.map((m) => m.user_id);
        const { notifyMany } = require('../routes/notifications');
        await notifyMany({
          userIds, businessId: invoice.business_id, eventKind,
          title, body, link, ctaLabel, workspaceName: wsName,
        });
      } catch (e) {
        console.warn('[overdue notifyMembers async] invoice', invoice.id, e.message);
      }
    });
  };

  // 클라이언트 메일 helper (외부 — 매트릭스 무관)
  const emailClient = async (subject, body) => {
    if (!invoice.client_id) return;
    const client = await Client.findByPk(invoice.client_id);
    if (!client) return;
    const recipient = client.tax_invoice_email || client.billing_contact_email || client.invite_email;
    if (!recipient) return;
    const { sendEmail } = require('./emailService');
    const shareUrl = `${process.env.APP_URL || 'https://dev.planq.kr'}/public/invoices/${invoice.share_token}`;
    const totalStr = `${invoice.currency || 'KRW'} ${Number(invoice.grand_total || 0).toLocaleString()}`;
    const html = `
<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0F172A;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;"><tr><td align="center">
    <table width="480" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:14px;padding:28px;max-width:480px;">
      <tr><td><div style="font-size:18px;font-weight:700;color:#B91C1C;margin-bottom:8px;">${subject}</div></td></tr>
      <tr><td style="padding:8px 0 16px;"><div style="font-size:14px;color:#475569;line-height:1.6;">${body}</div></td></tr>
      <tr><td style="background:#FEF2F2;padding:14px;border-radius:8px;margin:8px 0;">
        <div style="font-size:12px;color:#7F1D1D;">청구서 ${invoice.invoice_number} · ${invoice.title || ''}</div>
        <div style="font-size:18px;font-weight:700;color:#B91C1C;margin-top:4px;">${totalStr}</div>
        <div style="font-size:12px;color:#7F1D1D;margin-top:2px;">결제 기한 ${String(invoice.due_date).slice(0,10)} · ${daysOverdue}일 연체</div>
      </td></tr>
      <tr><td align="center" style="padding:18px 0;">
        <a href="${shareUrl}" style="display:inline-block;padding:12px 24px;background:#B91C1C;color:#FFFFFF;text-decoration:none;border-radius:8px;font-size:13px;font-weight:700;">청구서 확인 · 결제</a>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
    await sendEmail({
      to: recipient, subject: `[${wsName || 'PlanQ'}] ${subject}`, html,
      businessId: invoice.business_id, template: 'overdue_notice',
      relatedEntityType: 'invoice', relatedEntityId: invoice.id,
    });
  };

  let actionTaken = null;

  // Stage 3 — paused (grace 도달) — invoice 가 정기 프로젝트 소속일 때만 정지
  if (daysOverdue >= graceDays && lastStage !== 'paused' && project && project.billing_type === 'subscription' && !project.paused_at) {
    await project.update({ paused_at: new Date() });
    actionTaken = 'paused';
    meta.last_overdue_notify_stage = 'paused';
    meta.paused_due_to_invoice = invoice.id;
    await invoice.update({ meta, status: 'overdue' });
    notifyMembers(
      'invoice',
      '프로젝트 자동 정지',
      `"${project.name}" 프로젝트가 ${daysOverdue}일 연체로 자동 정지되었습니다. 결제 마킹 시 즉시 재개됩니다.`,
      `${process.env.APP_URL || 'https://dev.planq.kr'}/q-project/${project.id}`,
      '프로젝트 보기',
    );
    await emailClient(
      `프로젝트가 정지되었습니다 — ${daysOverdue}일 연체`,
      `장기 미결제로 프로젝트가 일시 정지되었습니다. 결제 후 즉시 정상 재개됩니다.`,
    );
  }
  // Stage 2 — 임박 (grace_days 절반 또는 7일 도달)
  else if (daysOverdue >= Math.max(3, Math.floor(graceDays / 2)) && lastStage !== 'stage2' && lastStage !== 'paused') {
    actionTaken = 'stage2';
    meta.last_overdue_notify_stage = 'stage2';
    await invoice.update({ meta, status: 'overdue' });
    const remaining = Math.max(0, graceDays - daysOverdue);
    notifyMembers(
      'invoice',
      `청구서 연체 ${daysOverdue}일 — 정지까지 ${remaining}일`,
      `${invoice.invoice_number} 결제가 ${daysOverdue}일 늦어지고 있습니다. ${remaining}일 후 자동 정지됩니다.`,
      invLink,
      '결제 확인',
    );
    await emailClient(
      `결제 기한이 ${daysOverdue}일 지났습니다`,
      `${remaining}일 내로 결제 안 되면 프로젝트가 자동 정지됩니다.`,
    );
  }
  // Stage 1 — 첫 연체 (1일 이상)
  else if (daysOverdue >= 1 && !lastStage) {
    actionTaken = 'stage1';
    meta.last_overdue_notify_stage = 'stage1';
    await invoice.update({ meta, status: 'overdue' });
    notifyMembers(
      'invoice',
      '청구서 연체 시작',
      `${invoice.invoice_number} 결제 기한 ${String(invoice.due_date).slice(0,10)} 이 지났습니다.`,
      invLink,
      '청구서 보기',
    );
    await emailClient(
      `결제 기한이 ${daysOverdue}일 지났습니다`,
      `${invoice.invoice_number} 결제를 부탁드립니다.`,
    );
  } else {
    return { invoice_id: invoice.id, skipped: 'no_action', last_stage: lastStage };
  }

  return { invoice_id: invoice.id, project_id: invoice.project_id, action: actionTaken, days_overdue: daysOverdue };
}

// Cron 진입 — 모든 미결제 연체 invoice 처리
async function runDailyOverdueCron(today = new Date()) {
  const todayStr = today.toISOString().slice(0, 10);
  const invoices = await Invoice.findAll({
    where: {
      status: { [Op.notIn]: ['paid', 'draft', 'canceled'] },
      due_date: { [Op.lt]: todayStr },
    },
    attributes: ['id', 'business_id', 'project_id', 'client_id', 'invoice_number', 'title', 'due_date', 'grand_total', 'currency', 'share_token', 'status', 'meta'],
  });

  const out = { stage1: 0, stage2: 0, paused: 0, skip: 0, fail: 0, total: invoices.length };
  for (const inv of invoices) {
    try {
      const r = await handleOverdueInvoice(inv, today);
      if (r.action === 'stage1') out.stage1 += 1;
      else if (r.action === 'stage2') out.stage2 += 1;
      else if (r.action === 'paused') out.paused += 1;
      else out.skip += 1;
    } catch (e) {
      console.warn('[overdue] invoice', inv.id, 'crash', e.message);
      out.fail += 1;
    }
  }
  return out;
}

// 결제 마킹 시 호출 — paused_at 자동 해제
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
};
