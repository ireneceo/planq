// 구독 — 워크스페이스의 현재 활성 구독 (월·연 cycle, 다음 결제일, 강등 cron 추적)
//
// 한 비즈니스에 동시 활성 구독은 1개. 플랜 변경 시:
//  - 기존 active 구독을 'replaced' 로 변경
//  - 신규 active 구독 생성
//
// 상태 전이:
//   pending  → active   (Payment.status='paid' 처리 시)
//   active   → past_due (current_period_end 지나도 다음 Payment 없음)
//   past_due → grace    (D+1 ~ D+7)
//   grace    → demoted  (D+8 — Free 로 강등)
//   active/past_due/grace → canceled (사용자 명시 취소)

const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Subscription extends Model {}

Subscription.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: {
    type: DataTypes.INTEGER, allowNull: false,
    references: { model: 'businesses', key: 'id' },
  },
  plan_code: {
    // free / starter / basic / pro / enterprise (config/plans.js 와 일치)
    type: DataTypes.STRING(32), allowNull: false,
  },
  cycle: {
    type: DataTypes.ENUM('monthly', 'yearly'), allowNull: false,
  },
  status: {
    // pending: 결제 대기 (Payment 미완)
    // active: 정상 사용 중
    // past_due: 결제일 지남, 아직 grace 기간 시작 전 (cron 돌기 전)
    // grace: 미결제 유예 기간 (D+1 ~ D+7)
    // demoted: 강등됨 (Free 로 전환)
    // canceled: 사용자 취소 또는 새 플랜으로 교체됨 (replaced)
    // replaced: 다른 활성 구독으로 교체됨
    type: DataTypes.ENUM('pending', 'active', 'past_due', 'grace', 'demoted', 'canceled', 'replaced'),
    allowNull: false, defaultValue: 'pending',
  },
  // 가격 (스냅샷 — 가격 정책 변경되어도 이 구독은 이 가격 유지)
  price: { type: DataTypes.DECIMAL(15, 2), allowNull: false },
  currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'KRW' },

  // 활성 기간
  started_at: { type: DataTypes.DATE, allowNull: true },          // 첫 활성화 시각
  current_period_start: { type: DataTypes.DATE, allowNull: true },
  current_period_end: { type: DataTypes.DATE, allowNull: true },
  next_billing_at: { type: DataTypes.DATE, allowNull: true },

  // grace / demoted 추적
  past_due_at: { type: DataTypes.DATE, allowNull: true },         // current_period_end 지나간 시점
  grace_started_at: { type: DataTypes.DATE, allowNull: true },    // grace 시작
  grace_ends_at: { type: DataTypes.DATE, allowNull: true },       // grace 종료 (강등 시점)
  demoted_at: { type: DataTypes.DATE, allowNull: true },          // 실제 demote 처리된 시각
  canceled_at: { type: DataTypes.DATE, allowNull: true },
  cancel_reason: { type: DataTypes.STRING(255), allowNull: true },

  created_by: {
    type: DataTypes.INTEGER, allowNull: true,
    references: { model: 'users', key: 'id' },
  },
}, {
  sequelize,
  tableName: 'subscriptions',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['business_id', 'status'] },
    { fields: ['next_billing_at'] },
    { fields: ['grace_ends_at'] },
  ],
});

module.exports = Subscription;
