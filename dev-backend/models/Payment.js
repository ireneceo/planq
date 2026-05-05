// 결제 — 한 Subscription 에 N개의 Payment.
// 정책: 1순위 자체 결제 (계좌이체 mark-paid), 2순위 PortOne (P-7).
//
// 흐름:
//   pending  → user 가 입금
//   marked   → admin (workspace owner) 이 mark-paid (자체 결제 트랙)
//   captured → portone webhook 또는 admin mark-paid (정상 처리)
//   refunded / failed / canceled
//
// PortOne 연동 시 portone_imp_uid · portone_status 컬럼 사용.

const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Payment extends Model {}

Payment.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: {
    type: DataTypes.INTEGER, allowNull: false,
    references: { model: 'businesses', key: 'id' },
  },
  // plan 결제는 NOT NULL, addon 단발 결제는 NULL 허용 (2026-05-05 add-on 흐름)
  subscription_id: {
    type: DataTypes.INTEGER, allowNull: true,
    references: { model: 'subscriptions', key: 'id' },
  },

  // 결제 종류: 'plan' (구독료) 또는 'addon' (추가 슬롯 1회 결제)
  kind: {
    type: DataTypes.ENUM('plan', 'addon'),
    allowNull: false, defaultValue: 'plan',
  },
  // addon 인 경우 카탈로그 코드 (config/plans.js ADDONS) + 수량
  addon_code: { type: DataTypes.STRING(32), allowNull: true },
  addon_quantity: { type: DataTypes.INTEGER, allowNull: true },

  // 결제 방식: bank_transfer (계좌이체), card (카드), portone (외부 PG)
  method: {
    type: DataTypes.ENUM('bank_transfer', 'card', 'portone', 'manual_adjust'),
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM('pending', 'paid', 'failed', 'refunded', 'canceled'),
    allowNull: false, defaultValue: 'pending',
  },

  amount: { type: DataTypes.DECIMAL(15, 2), allowNull: false },
  currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'KRW' },

  // 주기 및 청구 기간 (스냅샷)
  cycle: { type: DataTypes.ENUM('monthly', 'yearly'), allowNull: false },
  period_start: { type: DataTypes.DATE, allowNull: true },
  period_end: { type: DataTypes.DATE, allowNull: true },

  // 자체 결제 트랙
  payer_name: { type: DataTypes.STRING(80), allowNull: true },     // 입금자명 (사용자가 알림)
  payer_memo: { type: DataTypes.STRING(255), allowNull: true },
  marked_by: {
    type: DataTypes.INTEGER, allowNull: true,
    references: { model: 'users', key: 'id' },
  },                                                               // mark-paid 한 admin (workspace owner)
  marked_at: { type: DataTypes.DATE, allowNull: true },

  // PortOne 트랙 (P-7)
  portone_imp_uid: { type: DataTypes.STRING(64), allowNull: true },
  portone_merchant_uid: { type: DataTypes.STRING(64), allowNull: true },
  portone_status: { type: DataTypes.STRING(32), allowNull: true },
  portone_meta: { type: DataTypes.JSON, allowNull: true },

  paid_at: { type: DataTypes.DATE, allowNull: true },
  refunded_at: { type: DataTypes.DATE, allowNull: true },
  refund_reason: { type: DataTypes.STRING(500), allowNull: true },

  // 영수증
  receipt_url: { type: DataTypes.STRING(500), allowNull: true },

  // 세금계산서 (한국 사업자 자동 발행, 팝빌 연동 — businesses.popbill_*)
  // tax_invoice_data JSON: { biz_no, biz_name, ceo_name, address, email }
  tax_invoice_requested: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  tax_invoice_data: { type: DataTypes.JSON, allowNull: true },
  tax_invoice_status: {
    type: DataTypes.ENUM('none', 'requested', 'issued', 'failed'),
    allowNull: false, defaultValue: 'none',
  },
  tax_invoice_issued_at: { type: DataTypes.DATE, allowNull: true },
  tax_invoice_error: { type: DataTypes.STRING(500), allowNull: true },

  created_by: {
    type: DataTypes.INTEGER, allowNull: true,
    references: { model: 'users', key: 'id' },
  },
}, {
  sequelize,
  tableName: 'payments',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['business_id', 'status'] },
    { fields: ['subscription_id'] },
    { fields: ['paid_at'] },
  ],
});

module.exports = Payment;
