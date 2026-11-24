// 근태 사유·인정 — 사람이 남길 때만 생긴다(미출근은 계속 «행 없음», docs/ATTENDANCE_FIXED_SCHEDULE_DESIGN.md §2.2 · D4)
//   하루 한 행 — 그날의 지각·조퇴·미출근을 한꺼번에 인정한다. 본인·관리자 응답에만 싣는다.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class AttendanceException extends Model {}

AttendanceException.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  work_date: { type: DataTypes.DATEONLY, allowNull: false },
  reason: { type: DataTypes.STRING(300), allowNull: true },
  reason_at: { type: DataTypes.DATE, allowNull: true },
  excused: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  excused_by: { type: DataTypes.INTEGER, allowNull: true },
  excused_at: { type: DataTypes.DATE, allowNull: true },
  excuse_note: { type: DataTypes.STRING(300), allowNull: true },
}, {
  sequelize,
  modelName: 'AttendanceException',
  tableName: 'attendance_exceptions',
  timestamps: true,
  underscored: true,
  indexes: [{ unique: true, fields: ['business_id', 'user_id', 'work_date'], name: 'att_exc_uniq' }],
});

module.exports = AttendanceException;
