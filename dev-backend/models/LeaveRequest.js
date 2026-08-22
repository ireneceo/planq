// 휴가 신청·승인 (#208 · #285)
//
// ★ `days_charged` 는 **승인 시점에 확정 박제**한다. 나중에 근무설정(주 근무일수·1일 시간)이 바뀌어도
//   이미 승인된 휴가의 차감량은 변하지 않아야 한다 — 지나간 승인을 소급해 바꾸면 잔여가 흔들리고
//   사용자는 이유를 알 수 없다. (같은 이유로 결제도 확정 시점에 매출 여부를 박제한다.)
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class LeaveRequest extends Model {}

LeaveRequest.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
  /** paid = 잔여 차감 / unpaid = 차감 없이 승인만 */
  leave_type: { type: DataTypes.ENUM('paid', 'unpaid'), allowNull: false, defaultValue: 'paid' },
  unit: { type: DataTypes.ENUM('full_day', 'half_day', 'hours'), allowNull: false, defaultValue: 'full_day' },
  /** full_day 는 기간 가능. half_day·hours 는 start=end 강제(라우트에서 검증) */
  start_date: { type: DataTypes.DATEONLY, allowNull: false },
  end_date: { type: DataTypes.DATEONLY, allowNull: false },
  half_kind: { type: DataTypes.ENUM('am', 'pm'), allowNull: true },
  hours: { type: DataTypes.DECIMAL(4, 1), allowNull: true },
  /** 승인 시점 확정 박제 — 이후 근무설정이 바뀌어도 불변 */
  days_charged: { type: DataTypes.DECIMAL(5, 1), allowNull: false, defaultValue: 0 },
  reason: { type: DataTypes.STRING(500), allowNull: true },
  status: {
    type: DataTypes.ENUM('pending', 'approved', 'rejected', 'canceled'),
    allowNull: false, defaultValue: 'pending',
  },
  decided_by: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
  decided_at: { type: DataTypes.DATE, allowNull: true },
  decide_note: { type: DataTypes.STRING(300), allowNull: true },
  canceled_by: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
  canceled_at: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize,
  modelName: 'LeaveRequest',
  tableName: 'leave_requests',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['business_id', 'user_id', 'status'], name: 'leave_req_biz_user_status' },
    // 가용시간 계산이 주간 겹침 조회를 친다
    { fields: ['business_id', 'start_date', 'end_date'], name: 'leave_req_biz_range' },
  ],
});

module.exports = LeaveRequest;
