// 일정 분류 — 워크스페이스가 직접 추가·이름 바꾸기·삭제한다 (2026-11-27, 설계 docs/CALENDAR_CATEGORIES_DESIGN.md)
//
// ★ 시스템 분류(code 있음: personal·work·meeting·deadline·other)는 name 이 NULL 이면 i18n 라벨, color 가 NULL 이면
//   화면의 기존 팔레트를 쓴다. 지우지 못하고 끄기만 한다(other 는 끌 수도 없다 — 커스텀을 지울 때 옮겨 갈 자리).
// ★ 커스텀 분류는 code NULL · name 필수. 지우면 그 일정은 «기타»(other)로 옮겨진다 — services/calendarCategories 한 곳.
// ★ calendar_events.category(ENUM)는 거울이다 — 시스템이면 그 code, 커스텀이면 'other' 를 같이 적는다(롤백·옛 번들 호환).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class CalendarCategory extends Model {}

CalendarCategory.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  /** 시스템 분류만. 커스텀은 NULL */
  code: { type: DataTypes.STRING(20), allowNull: true },
  /** 회사가 정한 이름. 커스텀은 필수(서비스가 검사) · 시스템은 NULL = 기본 라벨 */
  name: { type: DataTypes.STRING(30), allowNull: true },
  /** #RRGGBB — NULL 이면 시스템 팔레트 */
  color: { type: DataTypes.STRING(7), allowNull: true },
  is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  created_by: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
}, {
  sequelize,
  modelName: 'CalendarCategory',
  tableName: 'calendar_categories',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['business_id', 'code'], name: 'calendar_categories_biz_code' },
    { fields: ['business_id', 'is_active', 'sort_order'], name: 'calendar_categories_biz_active' },
  ],
});

module.exports = CalendarCategory;
