// 문서의 «청구 조건» — 서명이 끝나면 이대로 청구서 초안을 만든다 (2026-10-23 · docs/CONTRACT_AUTO_INVOICE_DESIGN.md · Fable 설계).
//
//   Irene: «서명을 완료한 계약서 기반으로 청구서를 자동생성 … 매번 ai가 살펴보지 않고» → 계약서 본문은 자유 글이라
//   금액을 규칙으로 읽을 수 없다. 서명 요청 전에 사람이 구조로 적어 두고, 서명이 끝나면 **적은 그대로** 복사한다(AI 0회).
//   - 문서당 한 행(post_id UNIQUE). 고칠 수 있는 때 = 서명 잠금이 없을 때(services/signatureCore.isPostSignatureLocked 와 같은 술어 —
//     본문이 잠기면 조건도 잠긴다. 서명자가 본 조건 = 청구될 조건).
//   - invoice_id UNIQUE — 만든 청구서. 채워지면 다시 만들지 않는다(문서당 평생 1건, 멱등). 청구서 쪽 idempotency_key 'post-terms:<post_id>' 가 같은 일을 DB 에서 한 번 더 막는다.
//   - auto_error — 자동 생성을 못 한 까닭(no_client 등). 사람이 «청구서 만들기» 로 이어 가게 화면이 읽는다.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class PostBillingTerms extends Model {}

PostBillingTerms.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  post_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'posts', key: 'id' }, onDelete: 'CASCADE' },
  client_id: { type: DataTypes.INTEGER, allowNull: true },
  title: { type: DataTypes.STRING(200), allowNull: true },
  currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'KRW' },
  vat_rate: { type: DataTypes.DECIMAL(5, 4), allowNull: false, defaultValue: 0.1 },
  tax_mode: { type: DataTypes.ENUM('exclusive', 'inclusive'), allowNull: false, defaultValue: 'exclusive' }, // 2026-10-24 — 서명자가 본 금액 = 청구 금액
  receipt_type: { type: DataTypes.ENUM('none', 'tax_invoice'), allowNull: false, defaultValue: 'none' },
  items: { type: DataTypes.JSON, allowNull: false },
  installment_mode: { type: DataTypes.ENUM('single', 'split'), allowNull: false, defaultValue: 'single' },
  installments: { type: DataTypes.JSON, allowNull: true },
  notes: { type: DataTypes.TEXT, allowNull: true },
  invoice_id: { type: DataTypes.INTEGER, allowNull: true },
  auto_error: { type: DataTypes.STRING(40), allowNull: true },
  auto_attempted_at: { type: DataTypes.DATE, allowNull: true },
  created_by: { type: DataTypes.INTEGER, allowNull: false },
  updated_by: { type: DataTypes.INTEGER, allowNull: true },
}, {
  sequelize,
  tableName: 'post_billing_terms',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['post_id'] },
    { unique: true, fields: ['invoice_id'] },
    { fields: ['business_id'] },
  ],
});

module.exports = PostBillingTerms;
