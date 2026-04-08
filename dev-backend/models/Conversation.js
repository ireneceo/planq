const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Conversation extends Model {}

Conversation.init({
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
  client_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'clients', key: 'id' }
  },
  title: {
    type: DataTypes.STRING(200),
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('active', 'archived'),
    defaultValue: 'active'
  },
  last_message_at: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  sequelize,
  tableName: 'conversations',
  timestamps: true,
  underscored: true
});

module.exports = Conversation;
