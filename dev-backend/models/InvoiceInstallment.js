// InvoiceInstallment — 청구서 분할 일정 (Q Bill Phase B)
//
// installment_mode='split' 인 invoice 에 대해 N 개 row 생성. 합계 비율 = 100%.
// 단일 발행은 installments 0개 (invoice 자체로 처리).
//
// 흐름:
//   pending  = 생성 직후 (invoice draft 단계)
//   sent     = invoice 가 sent → installment 도 자동 sent
//   paid     = 사용자 수동 마킹 (계좌이체 확인 후)
//   overdue  = cron 으로 due_date 초과 시 자동 전환
//   canceled = 사용자 취소
//
// 세금계산서: 사용자가 외부 채널 (홈택스/팝빌/회계사) 발행 후 마킹.
//             tax_invoice_no, tax_invoice_at, tax_invoice_marked_by 기록.

const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class InvoiceInstallment extends Model {}

InvoiceInstallment.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  invoice_id: {
    type: DataTypes.INTEGER, allowNull: false,
    references: { model: 'invoices', key: 'id' },
  },
  installment_no: { type: DataTypes.INTEGER, allowNull: false },          // 1, 2, 3, ...
  label: { type: DataTypes.STRING(40), allowNull: false },                // '선금', '중도금', '잔금'
  percent: { type: DataTypes.DECIMAL(5, 2), allowNull: false },           // 30.00, 40.00, 30.00
  amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },           // 자동 계산 = grand_total * percent / 100
  due_date: { type: DataTypes.DATEONLY, allowNull: true },

  status: {
    type: DataTypes.ENUM('pending', 'sent', 'paid', 'overdue', 'canceled'),
    allowNull: false, defaultValue: 'pending',
  },

  // 결제 마킹 (사용자 수동 — 송금 입금 확인 후)
  paid_at: { type: DataTypes.DATE, allowNull: true },
  marked_by_user_id: {
    type: DataTypes.INTEGER, allowNull: true,
    references: { model: 'users', key: 'id' },
  },
  marked_at: { type: DataTypes.DATE, allowNull: true },
  payer_memo: { type: DataTypes.STRING(200), allowNull: true, comment: '입금자명·은행 등 메모' },

  // 세금계산서 (사용자 외부 발행 마킹)
  tax_invoice_no: { type: DataTypes.STRING(50), allowNull: true },
  tax_invoice_at: { type: DataTypes.DATE, allowNull: true },
  tax_invoice_marked_by: {
    type: DataTypes.INTEGER, allowNull: true,
    references: { model: 'users', key: 'id' },
  },

  // (옵션) 마일스톤 ref — Phase D 통합에서 SOW 검수 통과 시 자동 활성
  milestone_ref: { type: DataTypes.STRING(100), allowNull: true },

  // Phase C — 공개 결제 페이지 송금 완료 알림 (분할 회차용)
  notify_paid_at: { type: DataTypes.DATE, allowNull: true, comment: '고객이 송금 완료 알림 누른 시각' },
  notify_payer_name: { type: DataTypes.STRING(80), allowNull: true, comment: '입금자명 (고객 자기보고)' },
}, {
  sequelize, tableName: 'invoice_installments', timestamps: true, underscored: true,
  indexes: [
    { fields: ['invoice_id', 'installment_no'], unique: true },
    { fields: ['status', 'due_date'] },
    { fields: ['invoice_id'] },
  ],
});

module.exports = InvoiceInstallment;
