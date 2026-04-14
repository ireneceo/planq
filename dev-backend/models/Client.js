const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Client extends Model {}

Client.init({
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
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' }
  },
  display_name: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  company_name: {
    type: DataTypes.STRING(200),
    allowNull: true
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  invited_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'users', key: 'id' }
  },
  invited_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  joined_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('invited', 'active', 'archived'),
    defaultValue: 'invited'
  },
  // ─── Cue 자동 히스토리 요약 ───
  summary: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  summary_updated_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  summary_manual: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  // ─── 기본 담당 멤버 (사람) ───
  assigned_member_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'users', key: 'id' }
  }
}, {
  sequelize,
  tableName: 'clients',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['business_id', 'user_id'] }
  ]
});

module.exports = Client;
