// ClientSubscription — 사업자가 고객에게 직접 거는 정기 구독청구 (사이클 N+83).
//   Project.monthly_fee(월1회·프로젝트 필수) 와 별개로, 프로젝트 없이 고객 단위 구독을 지원.
//   엔진(clientSubscriptionBilling.js)이 next_billing_at 도달 시 Invoice 자동 생성 → 기존 청구·결제·연체 인프라 재사용.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class ClientSubscription extends Model {}

ClientSubscription.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  client_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'clients', key: 'id' } },
  plan_name: { type: DataTypes.STRING(200), allowNull: false },         // 예: "월 유지보수"
  amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },          // 회차당 공급가 (VAT 별도)
  currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'KRW' },
  // 청구 주기 (운영: biweekly 격주, semiannual 반기 추가)
  interval: { type: DataTypes.ENUM('weekly', 'biweekly', 'monthly', 'quarterly', 'semiannual', 'yearly'), allowNull: false, defaultValue: 'monthly' },
  vat_rate: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 10.0 }, // % (0 이면 면세)
  // 발행 방식 — auto: 즉시 sent + 메일 / draft_review: draft + 멤버 검토 알림
  auto_mode: { type: DataTypes.ENUM('auto', 'draft_review'), allowNull: false, defaultValue: 'draft_review' },
  due_days: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 14 },          // 청구서 결제 기한(일)
  // 'completed' = 회차 자동 종료로 정상 만료 (수동 canceled 와 구분)
  status: { type: DataTypes.ENUM('active', 'paused', 'canceled', 'completed'), allowNull: false, defaultValue: 'active' },
  start_date: { type: DataTypes.DATEONLY, allowNull: false },
  next_billing_at: { type: DataTypes.DATEONLY, allowNull: false },       // 다음 발행 예정일
  last_invoiced_at: { type: DataTypes.DATE, allowNull: true },
  // 회차 자동 종료 (운영): never=무기한 / after_count=N회 후 / until_date=종료일까지
  end_mode: { type: DataTypes.ENUM('never', 'after_count', 'until_date'), allowNull: false, defaultValue: 'never' },
  max_occurrences: { type: DataTypes.INTEGER, allowNull: true },          // after_count 목표 회차
  occurrences_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }, // 발행 완료 누적 회차
  end_date: { type: DataTypes.DATEONLY, allowNull: true },                // until_date 종료일(포함)
  notes: { type: DataTypes.STRING(500), allowNull: true },
  created_by: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
  canceled_at: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize, tableName: 'client_subscriptions', timestamps: true, underscored: true,
  indexes: [
    { fields: ['business_id', 'status', 'next_billing_at'], name: 'client_subs_biz_status_next' },
    { fields: ['business_id', 'client_id'], name: 'client_subs_biz_client' },
  ],
});

module.exports = ClientSubscription;
