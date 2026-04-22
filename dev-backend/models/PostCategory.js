// PostCategory — 문서 카테고리 마스터 (문서 없는 빈 카테고리도 유지 가능)
// Post.category 는 여전히 자유 문자열. 이 테이블은 "미리 만들어 둔 카테고리" 전용.
// meta 응답은 두 소스를 통합해 반환.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class PostCategory extends Model {}

PostCategory.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  project_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: 'projects', key: 'id' } },
  name: { type: DataTypes.STRING(40), allowNull: false },
  sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, {
  sequelize, tableName: 'post_categories', timestamps: true, underscored: true,
  indexes: [
    { unique: true, fields: ['business_id', 'project_id', 'name'] },
    { fields: ['business_id', 'project_id', 'sort_order'] },
  ]
});

module.exports = PostCategory;
