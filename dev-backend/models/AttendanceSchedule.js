// 근태 근무 일정 이력 — 고정 근무·지각 판정의 기준 (docs/ATTENDANCE_FIXED_SCHEDULE_DESIGN.md §2.1)
//   user_id NULL = 워크스페이스 기본 · 값 있음 = 그 사람 예외. effective_from 부터 적용(이력 — 지난 판정이 안 바뀐다).
//   행이 하나도 없으면 = 유연 근무 = 지금 동작 그대로. 쓰는 문은 services/attendanceSchedule.save 한 곳.
//   ★ businesses.work_hours(예약 받는 시간·공개 영업시간·Cue)와 다른 뜻이다 — 섞지 않는다(설계 D1).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class AttendanceSchedule extends Model {}

AttendanceSchedule.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  user_id: { type: DataTypes.INTEGER, allowNull: true },
  effective_from: { type: DataTypes.DATEONLY, allowNull: false },
  /** 워크스페이스 행: flex · fixed / 사람 행: inherit · flex · fixed */
  mode: { type: DataTypes.STRING(10), allowNull: false },
  /** {mon:[9,18], …} — work_hours 와 같은 모양(0.5h 단위, 없는 요일 = 쉬는 날) */
  schedule: { type: DataTypes.JSON, allowNull: true },
  grace_min: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  half_day_at: { type: DataTypes.DECIMAL(3, 1), allowNull: true },
  created_by: { type: DataTypes.INTEGER, allowNull: false },
}, {
  sequelize,
  modelName: 'AttendanceSchedule',
  tableName: 'attendance_schedules',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['business_id', 'user_id', 'effective_from'], name: 'att_sched_uniq' },
    { fields: ['business_id', 'effective_from'], name: 'att_sched_biz_from' },
  ],
});

module.exports = AttendanceSchedule;
