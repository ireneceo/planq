const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Invoice extends Model {}

Invoice.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  business_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'businesses', key: 'id' }
  },
  client_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'clients', key: 'id' }
  },
  invoice_number: {
    type: DataTypes.STRING(20),
    allowNull: false,
    unique: true
  },
  title: {
    type: DataTypes.STRING(200),
    allowNull: false
  },
  total_amount: {
    type: DataTypes.DECIMAL(12, 0),
    defaultValue: 0
  },
  tax_amount: {
    type: DataTypes.DECIMAL(12, 0),
    defaultValue: 0
  },
  grand_total: {
    type: DataTypes.DECIMAL(12, 0),
    defaultValue: 0
  },
  status: {
    type: DataTypes.ENUM('draft', 'sent', 'partially_paid', 'paid', 'overdue', 'canceled'),
    defaultValue: 'draft'
  },
  // 분할 결제 모드 — split 시 invoice_installments 와 함께 사용
  installment_mode: {
    type: DataTypes.ENUM('single', 'split'),
    defaultValue: 'single',
    allowNull: false,
  },
  // 발행 시점 워크스페이스 계좌 정보 스냅샷 (사용자 계좌 변경되어도 발행 청구서는 보존)
  bank_snapshot: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: '{bank_name, account_no, account_holder} — 발행 시점 보존',
  },
  issued_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  due_date: {
    type: DataTypes.DATEONLY,
    allowNull: true
  },
  paid_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  recipient_email: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  recipient_business_name: {
    type: DataTypes.STRING(200),
    allowNull: true
  },
  recipient_business_number: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  sent_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  created_by: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' }
  },
  // ─── Q Bill (Phase 0) — 확장 ───
  // 프로젝트 연결 (프로젝트 Bill 탭·수익성 계산)
  project_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: 'projects', key: 'id' } },
  // 견적서에서 전환된 경우 원본 참조 (legacy quotes 테이블)
  quote_id: { type: DataTypes.BIGINT, allowNull: true },
  // 출처 문서 (Q docs post: kind in [contract, quote, sow, proposal]) — 청구서 ↔ 계약/견적 연결
  // 한 출처 문서로 여러 회차 청구 가능 (1:N)
  source_post_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'posts', key: 'id' },
    comment: '출처 문서 (계약/견적/SOW/제안)',
  },
  // 통화 (KRW/USD/EUR 등)
  currency: { type: DataTypes.STRING(3), defaultValue: 'KRW' },
  // 세부 금액 (total_amount 는 legacy 유지, 신규 계산은 subtotal + vat)
  subtotal: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
  vat_rate: { type: DataTypes.DECIMAL(4, 3), defaultValue: 0.100 },
  // 누적 수금액 (부분결제 지원). paid_amount >= grand_total 이면 status='paid'.
  paid_amount: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
  payment_terms: { type: DataTypes.TEXT, allowNull: true },
  // 공개 공유 링크 토큰 (고객이 로그인 없이 청구서 조회·결제)
  share_token: { type: DataTypes.STRING(64), allowNull: true, unique: true },
  viewed_at: { type: DataTypes.DATE, allowNull: true, comment: '첫 열람 시각' },
  // 세금계산서 (팝빌)
  tax_invoice_status: {
    type: DataTypes.ENUM('none', 'pending', 'issued', 'failed', 'canceled'),
    defaultValue: 'none',
  },
  tax_invoice_external_id: { type: DataTypes.STRING(100), allowNull: true },
  tax_invoice_url: { type: DataTypes.STRING(500), allowNull: true },
  tax_invoice_issued_at: { type: DataTypes.DATE, allowNull: true },
  // Phase C — 공개 결제 페이지 송금 완료 알림 (단일 발행용)
  notify_paid_at: { type: DataTypes.DATE, allowNull: true, comment: '고객이 송금 완료 알림 누른 시각' },
  notify_payer_name: { type: DataTypes.STRING(80), allowNull: true, comment: '입금자명 (고객 자기보고)' }
}, {
  sequelize,
  tableName: 'invoices',
  timestamps: true,
  underscored: true
});

module.exports = Invoice;
