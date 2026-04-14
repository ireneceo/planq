const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class BusinessMember extends Model {}

BusinessMember.init({
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
  // 'owner' = 관리자 (사용자 표기), 'member' = 멤버, 'ai' = Cue 전용
  role: {
    type: DataTypes.ENUM('owner', 'member', 'ai'),
    defaultValue: 'member'
  },
  invited_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'users', key: 'id' }
  },
  joined_at: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  sequelize,
  tableName: 'business_members',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['business_id', 'user_id'] }
  ]
});

module.exports = BusinessMember;
