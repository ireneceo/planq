// 휴가 종류 — 워크스페이스가 직접 등록·관리한다 (2026-10-22, 설계 docs/LEAVE_TYPES_DESIGN.md)
//
// ★ 유급/무급(pay)의 정본은 이 표다. 신청 행의 leave_type 은 **신청 시점의 박제**라
//   여기를 고쳐도 옛 신청·잔여·급여는 움직이지 않는다. 그래서 쓰인 종류의 pay 는 바꾸지 못한다.
// ★ 시스템 종류(code 있음)는 name 이 NULL 이면 i18n 폴백 라벨을 쓴다. 지우지 못하고 끄기만 한다.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class LeaveType extends Model {}

LeaveType.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  /** 시스템 종류만(annual·sick·family·other·unpaid). 커스텀은 NULL */
  code: { type: DataTypes.STRING(20), allowNull: true },
  /** 회사가 정한 이름. 커스텀은 필수(서비스가 검사) */
  name: { type: DataTypes.STRING(50), allowNull: true },
  pay: { type: DataTypes.ENUM('paid', 'unpaid'), allowNull: false, defaultValue: 'paid' },
  /** 연간 부여 폼의 기본값 — 자동 부여가 아니다 */
  default_days: { type: DataTypes.DECIMAL(4, 1), allowNull: true },
  is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  created_by: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
}, {
  sequelize,
  modelName: 'LeaveType',
  tableName: 'leave_types',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['business_id', 'code'], name: 'leave_types_biz_code' },
    { fields: ['business_id', 'is_active', 'sort_order'], name: 'leave_types_biz_active' },
  ],
});

module.exports = LeaveType;
