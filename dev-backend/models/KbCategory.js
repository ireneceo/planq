// KbCategory — Q info(KB) 카테고리 마스터 (PostCategory 패턴 — 사이클 N+64)
// KbDocument.category / categories JSON 은 자유 문자열 유지. 이 테이블은 "미리 만들어 둔 카테고리".
// 워크스페이스 단위 (project 단위 분기 X — Q info 는 워크스페이스 전역 자료 컨테이너).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class KbCategory extends Model {}

KbCategory.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  name: { type: DataTypes.STRING(40), allowNull: false },
  sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, {
  sequelize, tableName: 'kb_categories', timestamps: true, underscored: true,
  indexes: [
    { unique: true, fields: ['business_id', 'name'], name: 'kb_categories_biz_name_unique' },
    { fields: ['business_id', 'sort_order'], name: 'kb_categories_biz_sort' },
  ]
});

module.exports = KbCategory;
