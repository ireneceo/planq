const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

// 본인 근태 시각 수정 요청 — «본인 수정» 표시·관리자 확인/승인의 원천 (docs/ATTENDANCE_CHECKIN_PROMPT_DESIGN.md §5·§6)
//   본인이 시각을 바꾸는 세 길(묻는 창 출근 · 어제 퇴근 확인 · 정정 창)이 모두 한 행을 남긴다.
//   status 는 ENUM 이 아니라 문자열 + services/attendanceFix.STATUSES (운영 ENUM ALTER 를 피한다).
class AttendanceFixRequest extends Model {}

AttendanceFixRequest.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  attendance_day_id: { type: DataTypes.INTEGER, allowNull: false },
  work_date: { type: DataTypes.DATEONLY, allowNull: false },
  /** prompt_in(묻는 창 출근) · prompt_out(어제 퇴근) · manual(정정 창) */
  origin: { type: DataTypes.STRING(16), allowNull: false },
  /** 고치기 전 {clock_in_at, clock_out_at, work_total_sec} */
  before: { type: DataTypes.JSON, allowNull: true },
  /** 제출한 그날 타임라인 [{kind, at}] — applyAdminFix 입력 그대로 */
  events: { type: DataTypes.JSON, allowNull: false },
  reason: { type: DataTypes.STRING(300), allowNull: true },
  /** applied · pending · confirmed · approved · rejected · withdrawn */
  status: { type: DataTypes.STRING(16), allowNull: false },
  decided_by: { type: DataTypes.INTEGER, allowNull: true },
  decided_at: { type: DataTypes.DATE, allowNull: true },
  decide_note: { type: DataTypes.STRING(300), allowNull: true },
}, {
  sequelize,
  modelName: 'AttendanceFixRequest',
  tableName: 'attendance_fix_requests',
  timestamps: true,
  underscored: true,
});

module.exports = AttendanceFixRequest;
