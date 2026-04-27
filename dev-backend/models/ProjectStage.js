// ProjectStage — 프로젝트 거래 시퀀스 (Phase D+1)
//
// 프로젝트 생성 시 type (fixed/subscription/consulting/custom) 에 따라 자동 시드.
// 각 stage 는 entity (post / invoice / installment) 와 연결돼 자동 진행/완료된다.
//
// 자동 진행 트리거:
//   - quote 단계: post(category='quote', status='published') 발행 → completed
//   - contract 단계: 양사 서명 완료 → completed
//   - invoice 단계: invoice.status='paid' 또는 모든 회차 paid → completed
//   - tax_invoice 단계: 결제완료 회차의 모든 tax_invoice_no 입력 → completed
//
// 사용자가 수동으로 stage 추가/수정/삭제 가능 (custom).

const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class ProjectStage extends Model {}

ProjectStage.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  project_id: {
    type: DataTypes.BIGINT,
    allowNull: false,
    references: { model: 'projects', key: 'id' },
  },
  order_index: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  kind: {
    type: DataTypes.ENUM(
      'quote',          // 견적서 작성·발행
      'proposal',       // 제안서 (consulting)
      'contract',       // 계약서·SOW 양사 서명
      'invoice',        // 청구서 발행 + 모든 회차 결제 완료
      'tax_invoice',    // 세금계산서 발행 (사업자 고객만 의미)
      'custom',         // 사용자 정의 단계
    ),
    allowNull: false,
  },
  label: { type: DataTypes.STRING(80), allowNull: false },
  status: {
    type: DataTypes.ENUM('pending', 'active', 'completed', 'skipped'),
    allowNull: false,
    defaultValue: 'pending',
  },
  // 연결된 entity — 자동 진행시 채워짐
  linked_entity_type: { type: DataTypes.ENUM('post', 'invoice'), allowNull: true },
  linked_entity_id: { type: DataTypes.BIGINT, allowNull: true },

  expected_due_date: { type: DataTypes.DATEONLY, allowNull: true },
  started_at: { type: DataTypes.DATE, allowNull: true },
  completed_at: { type: DataTypes.DATE, allowNull: true },

  // 추가 메타 (e.g., installment 라벨, recurrence 주기 등)
  metadata: { type: DataTypes.JSON, allowNull: true },

  // false 면 사용자 정의 (template 외)
  is_template_seeded: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, {
  sequelize, tableName: 'project_stages', timestamps: true, underscored: true,
  indexes: [
    { fields: ['project_id', 'order_index'] },
    { fields: ['project_id', 'status'] },
    { fields: ['linked_entity_type', 'linked_entity_id'] },
  ],
});

module.exports = ProjectStage;
