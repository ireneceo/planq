// ReceiptCorrection — 수정세금계산서 · 증빙 취소 이력 (RECEIPT_CORRECTION_DESIGN)
//   원 발행(invoices/installments 의 tax_invoice_*, cash_receipt_*)은 그대로 두고,
//   정정/취소를 참조 이벤트로 별도 기록(컴플라이언스 감사 — 전체 이력 보존).
//   PlanQ 는 홈택스/팝빌 자동발행 X — 외부 수정발행/취소 결과를 마킹 추적.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class ReceiptCorrection extends Model {}

ReceiptCorrection.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  invoice_id: { type: DataTypes.INTEGER, allowNull: false },
  installment_id: { type: DataTypes.INTEGER, allowNull: true }, // 분할 회차 정정이면
  kind: { type: DataTypes.ENUM('tax', 'cash'), allowNull: false },
  // 부가세법 §70 수정사유 6종
  reason: {
    type: DataTypes.ENUM('clerical', 'amount_change', 'return', 'cancel', 'duplicate', 'other'),
    allowNull: false,
  },
  original_no: { type: DataTypes.STRING(50), allowNull: true },   // 당초 발행/승인 번호 snapshot
  corrected_no: { type: DataTypes.STRING(50), allowNull: false }, // 수정세금계산서 발행번호 / 현금영수증 취소 승인번호
  written_at: { type: DataTypes.DATEONLY, allowNull: true },      // 수정 작성일자(사유별 규칙)
  amount_delta: { type: DataTypes.DECIMAL(15, 2), allowNull: true }, // 증감액 (취소/반품/중복=음수, amount_change=±)
  currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'KRW' },
  customer_note: { type: DataTypes.STRING(300), allowNull: true },
  marked_by: { type: DataTypes.INTEGER, allowNull: true },
  customer_notified_at: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize,
  tableName: 'receipt_corrections',
  timestamps: true, underscored: true,
  indexes: [
    { fields: ['business_id', 'invoice_id'], name: 'idx_rc_biz_invoice' },
    { fields: ['invoice_id', 'installment_id', 'kind'], name: 'idx_rc_entity' },
    { fields: ['kind', 'reason'], name: 'idx_rc_kind_reason' },
  ],
});

module.exports = ReceiptCorrection;
