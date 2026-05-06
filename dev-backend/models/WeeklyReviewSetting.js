// WeeklyReviewSetting — 주간 보고 자동 박제 설정
//
// 사용자별 + 워크스페이스별 자동 박제 ON/OFF.
// row 없으면 default ON (열린 문화).

const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class WeeklyReviewSetting extends Model {}

WeeklyReviewSetting.init({
  user_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    references: { model: 'users', key: 'id' },
  },
  business_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    references: { model: 'businesses', key: 'id' },
  },
  auto_enabled: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
}, {
  sequelize,
  tableName: 'weekly_review_settings',
  timestamps: true,
  underscored: true,
});

module.exports = WeeklyReviewSetting;
