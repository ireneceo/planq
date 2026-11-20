const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

// 그날 첫 진입·마지막 활동·묻기 답 — **본인 전용** (docs/ATTENDANCE_CHECKIN_PROMPT_DESIGN.md §6.2)
//   팀·통계·presence 응답에 싣지 않는다(FocusSession 과 같은 선). 90일 지난 행은 자동마감 cron 이 지운다.
class AttendanceActivity extends Model {}

AttendanceActivity.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  /** 워크스페이스 tz 기준 날짜 */
  work_date: { type: DataTypes.DATEONLY, allowNull: false },
  first_seen_at: { type: DataTypes.DATE, allowNull: true },
  last_act_at: { type: DataTypes.DATE, allowNull: true },
  /** later · not_today */
  prompt_answer: { type: DataTypes.STRING(16), allowNull: true },
  prompt_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  prompt_snooze_until: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize,
  modelName: 'AttendanceActivity',
  tableName: 'attendance_activity',
  timestamps: true,
  underscored: true,
  indexes: [{ unique: true, fields: ['business_id', 'user_id', 'work_date'], name: 'att_act_uniq' }],
});

module.exports = AttendanceActivity;
