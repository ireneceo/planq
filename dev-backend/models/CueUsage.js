const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

// 월별·액션종류별 Cue 사용량 집계 (월 한도 검사 + 비용 대시보드)
class CueUsage extends Model {}

CueUsage.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  business_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'businesses', key: 'id' }
  },
  // 'YYYY-MM' — 월 단위 리셋 기준
  year_month: {
    type: DataTypes.STRING(7),
    allowNull: false
  },
  // 'answer' | 'task_execute' | 'summary' | 'kb_embed' 등
  action_type: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  action_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  token_input: {
    type: DataTypes.BIGINT,
    defaultValue: 0
  },
  token_output: {
    type: DataTypes.BIGINT,
    defaultValue: 0
  },
  cost_usd: {
    type: DataTypes.DECIMAL(10, 6),
    defaultValue: 0
  }
}, {
  sequelize,
  tableName: 'cue_usage',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['business_id', 'year_month', 'action_type'] },
    { fields: ['business_id', 'year_month'] }
  ]
});

module.exports = CueUsage;
