// BusinessMemberPermission — 워크스페이스 멤버별 메뉴 권한 (사이클 N+21)
//
// 정책 (PERMISSION_MATRIX §4.6 "열린 문화" 일관):
//   - row 없음 = 'write' 기본 (전권). 명시적 row 만 제한.
//   - level: 'none' (메뉴 hide + 403) / 'read' (GET only) / 'write' (CUD 가능)
//
// menu_key 9종 (사이드바 정합):
//   qtalk · qtask · qnote · qdocs · qbill · qcalendar · qfile · clients · insights
//
// 권한 무관 영역 (항상 RW): 본인 프로필·인박스·설정·Cue (워크스페이스 공용).

const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class BusinessMemberPermission extends Model {}

BusinessMemberPermission.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: {
    type: DataTypes.INTEGER, allowNull: false,
    references: { model: 'businesses', key: 'id' },
  },
  user_id: {
    type: DataTypes.INTEGER, allowNull: false,
    references: { model: 'users', key: 'id' },
  },
  menu_key: {
    type: DataTypes.STRING(30), allowNull: false,
    comment: 'qtalk | qtask | qnote | qdocs | qbill | qcalendar | qfile | clients | insights',
  },
  level: {
    type: DataTypes.ENUM('none', 'read', 'write'),
    allowNull: false, defaultValue: 'write',
  },
  updated_by: {
    type: DataTypes.INTEGER, allowNull: true,
    references: { model: 'users', key: 'id' },
  },
}, {
  sequelize,
  tableName: 'business_member_permissions',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['business_id', 'user_id', 'menu_key'], unique: true, name: 'uk_member_menu' },
    { fields: ['user_id', 'business_id'], name: 'idx_user_biz' },
  ],
});

module.exports = BusinessMemberPermission;
