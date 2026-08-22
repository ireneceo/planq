// 휴가 부여 원장 — 관리자가 연간 유급 휴가를 준 기록 (#208 · #285)
//
// ★ **잔여는 컬럼으로 저장하지 않는다.** 증빙 큐(receiptsDue)와 같은 원칙이다 —
//   저장하면 부여·신청·취소·정정 네 경로가 각자 그 숫자를 고쳐야 하고, 한 곳만 빠뜨리면
//   조용히 어긋난다. 파생으로 두면 어긋날 자리가 없다.
//     잔여 = Σ grants(year).days − Σ approved requests(paid, 그 해).days_charged
// ★ 정정도 기존 row 를 고치지 않고 **음수 row 를 추가**한다(원장식). "왜 줄었나" 가 남는다.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class LeaveGrant extends Model {}

LeaveGrant.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
  /** 부여 연도 (워크스페이스 tz 기준) */
  year: { type: DataTypes.INTEGER, allowNull: false },
  /** 부여 일수. 0.5 단위 허용, 정정을 위해 음수 허용 */
  days: { type: DataTypes.DECIMAL(4, 1), allowNull: false },
  note: { type: DataTypes.STRING(300), allowNull: true },
  granted_by: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
}, {
  sequelize,
  modelName: 'LeaveGrant',
  tableName: 'leave_grants',
  timestamps: true,
  underscored: true,
  indexes: [{ fields: ['business_id', 'user_id', 'year'], name: 'leave_grant_biz_user_year' }],
});

module.exports = LeaveGrant;
