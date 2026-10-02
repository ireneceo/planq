// 워크스페이스 휴일 (#424) — 국가 공휴일(물질화) + 직접 추가. 설계 docs/WORKDAY_HOLIDAY_DESIGN.md §2.2
//
// ★ 국가 공휴일은 데이터셋(config/holidays/<CC>.json)에서 **행으로 옮겨 둔다.** 실시간으로 "데이터셋 − 예외" 를
//   계산하지 않는 이유: ①계산이 읽는 술어가 `is_off=1 AND date BETWEEN` 하나가 된다 ②owner 가 보는 목록이
//   곧 계산이 쓰는 목록이다 ③데이터셋을 나중에 고쳐도 지나간 주의 숫자가 조용히 바뀌지 않는다.
// ★ 국가 행은 지우지 않고 `is_off=0` 으로 끈다 — 재동기화가 되살리지 않게 하는 툼스톤이다.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class WorkspaceHoliday extends Model {}

WorkspaceHoliday.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  date: { type: DataTypes.DATEONLY, allowNull: false },
  name: { type: DataTypes.STRING(100), allowNull: false },
  name_en: { type: DataTypes.STRING(100), allowNull: true },
  source: { type: DataTypes.ENUM('national', 'custom'), allowNull: false, defaultValue: 'custom' },
  is_off: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  created_by: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
}, {
  sequelize,
  modelName: 'WorkspaceHoliday',
  tableName: 'workspace_holidays',
  timestamps: true,
  underscored: true,
  indexes: [{ unique: true, fields: ['business_id', 'date'], name: 'ws_holiday_biz_date' }],
});

module.exports = WorkspaceHoliday;
