// 출퇴근 원장 — append-only (#208 · #285)
//
// 이 표는 **고치지 않는다.** 관리자 정정도 새 row(kind + source='admin_fix')로 남기고,
//   롤업(attendance_days)은 그 원장을 다시 접어서 만든다(recomputeDay).
//   근태는 나중에 분쟁이 되는 기록이라, 덮어쓰면 무엇이 원래였는지 사라진다.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class AttendanceEvent extends Model {}

AttendanceEvent.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
  attendance_day_id: {
    type: DataTypes.INTEGER, allowNull: false,
    references: { model: 'attendance_days', key: 'id' }, onDelete: 'CASCADE',
  },
  kind: { type: DataTypes.ENUM('clock_in', 'break_start', 'break_end', 'clock_out'), allowNull: false },
  /** 발생 시각. admin_fix 는 과거 시각을 넣을 수 있다 */
  at: { type: DataTypes.DATE, allowNull: false },
  /** user = 본인이 눌렀다 / auto_focus = 업무 시작이 대신 찍었다 / auto_close = 미퇴근 마감 / admin_fix = 정정 */
  source: {
    type: DataTypes.ENUM('user', 'auto_focus', 'auto_close', 'admin_fix'),
    allowNull: false, defaultValue: 'user',
  },
  actor_user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
  /** admin_fix 는 사유 필수 — 남의 근태를 고치는 일이라 이유가 남아야 한다 */
  fix_reason: { type: DataTypes.STRING(300), allowNull: true },
}, {
  sequelize,
  modelName: 'AttendanceEvent',
  tableName: 'attendance_events',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['attendance_day_id', 'at'], name: 'att_ev_day_at' },
    { fields: ['business_id', 'at'], name: 'att_ev_biz_at' },
  ],
});

module.exports = AttendanceEvent;
