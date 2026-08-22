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
  /**
   * 정정으로 **효력을 잃은** 시각. 행은 지우지 않고 여기에 시점만 남긴다.
   *
   * ★ 왜 필요한가: append-only 만으로는 "이미 찍힌 잘못된 퇴근" 을 무를 수 없다.
   *   자동마감이 10:00 로 찍은 날에 관리자가 18:00 퇴근을 덧붙여도, 근무 스팬은 10:00 에
   *   이미 닫혀 있어 근무시간이 그대로였다(1h). 사람이 원한 것은 "덧붙이기" 가 아니라
   *   "그 기록은 틀렸고 이것이 맞다" 이다. 그래서 정정은 **그날의 확정 타임라인을 새로 제출**하고,
   *   이전 기록은 지우지 않은 채 무효로 표시한다 — 무엇이 원래였는지는 그대로 남는다.
   */
  superseded_at: { type: DataTypes.DATE, allowNull: true },
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
