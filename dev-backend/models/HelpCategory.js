const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

// Q위키 카테고리 — PlanQ 제품 사용법 도움말 분류.
// 플랫폼 공통 콘텐츠(business_id 없음). 격리 축은 article.visibility 만.
class HelpCategory extends Model {}

HelpCategory.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  // URL·라우트 매칭 (예: 'getting-started', 'qtalk', 'qbill')
  slug: {
    type: DataTypes.STRING(60),
    allowNull: false,
    unique: true,
  },
  title_ko: {
    type: DataTypes.STRING(120),
    allowNull: false,
  },
  title_en: {
    type: DataTypes.STRING(120),
    allowNull: false,
  },
  // 첫 접속 오버뷰 한 줄 요약
  summary_ko: {
    type: DataTypes.STRING(300),
    allowNull: true,
  },
  summary_en: {
    type: DataTypes.STRING(300),
    allowNull: true,
  },
  // 아이콘 키 (프론트 아이콘 매핑)
  icon: {
    type: DataTypes.STRING(40),
    allowNull: true,
  },
  sort_order: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
}, {
  sequelize,
  tableName: 'help_categories',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['slug'], name: 'help_categories_slug_unique' },
    { fields: ['sort_order'] },
  ],
});

module.exports = HelpCategory;
