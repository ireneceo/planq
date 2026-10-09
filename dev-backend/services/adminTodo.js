// 플랫폼 관리자 «확인 필요» — 관리자가 처리해야 할 일을 한 곳에서 모은다.
//
// ★ 2026-10-08 신설. Irene: *"플랫폼관리자에서 입금확인해야 하는거 알림이 안떠. 여기도 할일필요 메뉴랑
//   알림표시들 다 제대로 구성되면 좋겠는데"* — 고객이 «입금했어요» 를 눌러도 관리자 화면 어디에도 표시가
//   없었고(메일만 갔다), 사이드바 배지는 문의·피드백 둘뿐이었다(피드백 배지는 응답 모양을 잘못 읽어 늘 0).
//
// 계약 (워크스페이스 확인필요와 같은 규칙 — CLAUDE.md «숫자 배지 계약»):
//   · 사이드바의 관리자 메뉴 배지는 **이 응답만** 쓴다. 화면이 따로 세지 않는다.
//   · 한 건 = 한 버킷. 메뉴 배지의 합 = total.
//       deposit_plan  → 구독 관리      (플랜 결제 · 고객이 입금 통보함 · 아직 pending)
//       deposit_addon → 결제 이력      (애드온 결제 · 같은 조건)
//       tax_invoice   → 결제 이력      (결제 완료 · 세금계산서 요청됨/발행 실패 · 환불 요청 중이 아님)
//       refund_request→ 결제 이력      (결제 완료 · 체험 중 결제 환불 요청됨 — docs/TRIAL_REFUND_DESIGN.md §2)
//         ★ 한 결제가 세금계산서 요청과 환불 요청을 같이 가지면 **환불 요청 하나로만** 센다(환불이 먼저다).
//       inquiry       → 문의 인박스    (new · in_progress)
//       feedback      → 사용자 피드백  (pending · reviewing)
//   · 입금 통보가 없는 pending 결제는 **세지 않는다** — 고객이 아직 안 낸 것이라 관리자가 할 일이 아니다
//     (운영 실측 2026-10-08: pending 8건 중 통보 1건).
const { Op } = require('sequelize');
const { Payment, Business, Subscription, ContactInquiry, FeedbackItem } = require('../models');

const LIST_LIMIT = 50;

function bizName(b) {
  return b ? (b.brand_name || b.name || null) : null;
}

async function collectAdminTodo() {
  const liveBiz = {
    model: Business,
    required: true,
    attributes: ['id', 'name', 'brand_name'],
    where: { deleted_at: null },
  };

  const depositWhere = { status: 'pending', notify_paid_at: { [Op.ne]: null } };
  const taxWhere = { status: 'paid', tax_invoice_status: { [Op.in]: ['requested', 'failed'] }, refund_requested_at: null };
  const refundWhere = { status: 'paid', kind: 'plan', refund_requested_at: { [Op.ne]: null } };
  const inquiryWhere = { status: { [Op.in]: ['new', 'in_progress'] } };
  const feedbackWhere = { status: { [Op.in]: ['pending', 'reviewing'] } };

  const [deposits, taxes, refunds, inquiries, feedbacks, inquiryCount, feedbackCount] = await Promise.all([
    Payment.findAll({
      where: depositWhere,
      include: [liveBiz, { model: Subscription, attributes: ['id', 'plan_code', 'cycle'], required: false }],
      order: [['notify_paid_at', 'ASC']],
    }),
    Payment.findAll({
      where: taxWhere,
      include: [liveBiz],
      order: [['paid_at', 'ASC']],
    }),
    Payment.findAll({
      where: refundWhere,
      include: [liveBiz],
      order: [['refund_requested_at', 'ASC']],
    }),
    ContactInquiry.findAll({
      where: inquiryWhere,
      attributes: ['id', 'from_name', 'from_company', 'message', 'status', 'created_at'],
      order: [['created_at', 'ASC']],
      limit: LIST_LIMIT,
    }),
    FeedbackItem.findAll({
      where: feedbackWhere,
      attributes: ['id', 'title', 'kind', 'status', 'priority', 'created_at'],
      order: [['created_at', 'ASC']],
      limit: LIST_LIMIT,
    }),
    ContactInquiry.count({ where: inquiryWhere }),
    FeedbackItem.count({ where: feedbackWhere }),
  ]);

  const items = [];
  for (const p of deposits) {
    const isAddon = p.kind === 'addon';
    items.push({
      type: isAddon ? 'deposit_addon' : 'deposit_plan',
      id: p.id,
      business_id: p.business_id,
      business_name: bizName(p.Business),
      amount: Number(p.amount),
      currency: p.currency,
      plan_code: p.Subscription ? p.Subscription.plan_code : null,
      cycle: p.cycle,
      addon_code: p.addon_code,
      payer_name: p.notify_payer_name || p.payer_name || null,
      at: p.notify_paid_at,
      link: isAddon ? `/admin/payments?status=pending&payment=${p.id}` : `/admin/subscriptions?status=pending&sub=${p.subscription_id}`,
    });
  }
  for (const p of taxes) {
    items.push({
      type: 'tax_invoice',
      id: p.id,
      business_id: p.business_id,
      business_name: bizName(p.Business),
      amount: Number(p.amount),
      currency: p.currency,
      tax_status: p.tax_invoice_status,
      biz_name: (p.tax_invoice_data && p.tax_invoice_data.biz_name) || null,
      at: p.paid_at,
      link: `/admin/payments?tax=pending&payment=${p.id}`,
    });
  }
  for (const p of refunds) {
    items.push({
      type: 'refund_request',
      id: p.id,
      business_id: p.business_id,
      business_name: bizName(p.Business),
      amount: Number(p.amount),
      currency: p.currency,
      method: p.method,
      // 세금계산서가 이미 나갔으면 수정세금계산서를 따로 발행해야 한다 — 막지 않고 알린다(설계 §3-9).
      tax_status: p.tax_invoice_status || null,
      at: p.refund_requested_at,
      link: `/admin/payments?payment=${p.id}`,
    });
  }
  for (const q of inquiries) {
    items.push({
      type: 'inquiry',
      id: q.id,
      title: String(q.message || '').replace(/\s+/g, ' ').slice(0, 80),
      from_name: q.from_company ? `${q.from_name} · ${q.from_company}` : q.from_name,
      status: q.status,
      at: q.created_at,
      link: `/admin/inquiries?status=${q.status}&inquiry=${q.id}`,
    });
  }
  for (const f of feedbacks) {
    items.push({
      type: 'feedback',
      id: f.id,
      title: f.title,
      kind: f.kind,
      status: f.status,
      priority: f.priority,
      at: f.created_at,
      link: `/admin/feedback?status=${f.status}&id=${f.id}`,
    });
  }

  const counts = {
    deposit_plan: deposits.filter((p) => p.kind !== 'addon').length,
    deposit_addon: deposits.filter((p) => p.kind === 'addon').length,
    tax_invoice: taxes.length,
    refund_request: refunds.length,
    inquiry: inquiryCount,
    feedback: feedbackCount,
  };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { total, counts, items };
}

module.exports = { collectAdminTodo };
