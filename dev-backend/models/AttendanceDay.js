// 출퇴근 하루 롤업 — 조회 정본 (#208 · #285)
//
// 원장(attendance_events)과 롤업(이 표)을 나눈 것은 qnote_usage / qnote_usage_events 선례를 따른 것이다.
//   조회는 이 표만 보고, 합계는 원장에서 재계산한다(recomputeDay). 두 수가 갈라지면 원장이 정본이다.
//
// ★ 미출근은 **row 없음** 으로 표현한다. state 에 'not_started' 를 두면 "출근 안 한 사람" 만큼
//   빈 row 를 매일 만들어야 하고, 그 생성 주체(cron? 첫 조회?)를 정하는 순간 복잡도가 폭발한다.
// ★ 퇴근 후 재출근하면 state 가 'working' 으로 되돌아오고 clock_out_at 은 NULL 이 된다.
//   그날의 스팬은 원장이 전부 보존하므로 롤업이 되돌아가도 이력은 잃지 않는다.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class AttendanceDay extends Model {}

AttendanceDay.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
  /** 워크스페이스 tz 기준 날짜 (Business.timezone, 기본 Asia/Seoul) */
  work_date: { type: DataTypes.DATEONLY, allowNull: false },
  state: { type: DataTypes.ENUM('working', 'on_break', 'done'), allowNull: false, defaultValue: 'working' },
  /** 그날 **첫** 출근 시각 */
  clock_in_at: { type: DataTypes.DATE, allowNull: false },
  /** 그날 **마지막** 퇴근 시각 (재출근 시 NULL 복귀) */
  clock_out_at: { type: DataTypes.DATE, allowNull: true },
  /** 지금 on_break 면 그 진입 시각 */
  break_started_at: { type: DataTypes.DATE, allowNull: true },
  work_total_sec: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  break_total_sec: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  /** 미퇴근 자동마감 — 화면에 "자동 마감됨" 을 띄워 관리자 정정을 유도한다(조용히 닫지 않는다) */
  auto_closed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  admin_fixed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  note: { type: DataTypes.STRING(500), allowNull: true },
}, {
  sequelize,
  modelName: 'AttendanceDay',
  tableName: 'attendance_days',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['business_id', 'user_id', 'work_date'], name: 'att_day_uniq' },
    { fields: ['business_id', 'work_date'], name: 'att_day_biz_date' },
    { fields: ['user_id', 'work_date'], name: 'att_day_user_date' },
  ],
});

module.exports = AttendanceDay;
