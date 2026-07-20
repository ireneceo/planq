// backfill-invoice-payments.js — 과거 paid 건에 invoice_payments 원장 생성 (멱등)
//   원장 write 코드가 없던 시절의 paid invoice/회차는 payment 행이 없어 매출 통계가 0이었다.
//   QBILL_PAYMENT_LEDGER_FIX D4 / R4.
//
//   규칙:
//   - 단일 invoice: installment_mode='single' AND status='paid' → amount=grand_total, installment_id=NULL
//     (split invoice 에 invoice-level 을 만들면 회차와 이중계상되므로 single 만. R4)
//   - 회차: status='paid' 인 모든 installment → amount=inst.amount, installment_id=inst.id
//     (canceled 부모의 paid 회차도 포함 — 실제로 받은 돈. R3)
//   - method: inst/invoice.stripe_payment_intent NOT NULL → stripe(other+pg_provider), else bank_transfer (R5)
//   - paid_at: inst.paid_at / invoice.paid_at, 없으면 updated_at fallback + 로그
//   - 멱등: 이미 payment(invoice_id, installment_id) 있으면 skip
require('dotenv').config();
const { sequelize } = require('../config/database');
const { Invoice, InvoiceInstallment, InvoicePayment } = require('../models');
const { Op } = require('sequelize');

function paymentFields(pgIntent) {
  return pgIntent
    ? { method: 'other', pg_provider: 'stripe', pg_channel: 'stripe', pg_transaction_id: pgIntent }
    : { method: 'bank_transfer', pg_provider: null, pg_channel: null, pg_transaction_id: null };
}

(async () => {
  let created = 0, skipped = 0, fallbackDates = 0;
  const dry = process.argv.includes('--dry-run');
  try {
    // ── 단일 invoice ──
    const singles = await Invoice.findAll({
      where: { installment_mode: 'single', status: 'paid' },
      attributes: ['id', 'business_id', 'grand_total', 'currency', 'paid_at', 'updated_at', 'stripe_payment_intent'],
    });
    for (const inv of singles) {
      const exists = await InvoicePayment.count({ where: { invoice_id: inv.id, installment_id: null } });
      if (exists > 0) { skipped++; continue; }
      let paidAt = inv.paid_at || inv.updated_at;
      if (!inv.paid_at) { fallbackDates++; console.warn(`  ⚠ invoice#${inv.id} paid_at NULL → updated_at fallback`); }
      const row = {
        invoice_id: inv.id, installment_id: null,
        amount: Number(inv.grand_total), paid_at: paidAt,
        currency: inv.currency || 'KRW', recorded_by: null, memo: 'backfill',
        ...paymentFields(inv.stripe_payment_intent),
      };
      if (dry) console.log('  [dry] single', JSON.stringify(row));
      else await InvoicePayment.create(row);
      created++;
    }

    // ── paid 회차 ── (Invoice 는 alias 없는 belongsTo → include(Invoice) 로 currency 취득)
    const insts = await InvoiceInstallment.findAll({
      where: { status: 'paid' },
      include: [{ model: Invoice, attributes: ['id', 'business_id', 'currency', 'updated_at'] }],
      attributes: ['id', 'invoice_id', 'amount', 'paid_at', 'marked_by_user_id', 'stripe_payment_intent', 'updated_at'],
    });
    for (const it of insts) {
      const exists = await InvoicePayment.count({ where: { invoice_id: it.invoice_id, installment_id: it.id } });
      if (exists > 0) { skipped++; continue; }
      let paidAt = it.paid_at || it.updated_at;
      if (!it.paid_at) { fallbackDates++; console.warn(`  ⚠ installment#${it.id} paid_at NULL → updated_at fallback`); }
      const row = {
        invoice_id: it.invoice_id, installment_id: it.id,
        amount: Number(it.amount), paid_at: paidAt,
        currency: it.Invoice?.currency || 'KRW', recorded_by: it.marked_by_user_id || null, memo: 'backfill',
        ...paymentFields(it.stripe_payment_intent),
      };
      if (dry) console.log('  [dry] installment', JSON.stringify(row));
      else await InvoicePayment.create(row);
      created++;
    }

    console.log(`\n${dry ? '[DRY-RUN] ' : ''}백필 완료 — 생성 ${created} · skip(기존) ${skipped} · paid_at fallback ${fallbackDates}`);
    const total = await InvoicePayment.count();
    console.log(`  invoice_payments 총 행: ${total}`);
    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error('✗ 백필 실패:', e.message);
    process.exit(1);
  }
})();
