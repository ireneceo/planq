const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class ConversationParticipant extends Model {}

ConversationParticipant.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  conversation_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'conversations', key: 'id' }
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' }
  },
  role: {
    type: DataTypes.ENUM('owner', 'member', 'client'),
    defaultValue: 'member'
  },
  joined_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  sequelize,
  tableName: 'conversation_participants',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  underscored: true,
  indexes: [
    { unique: true, fields: ['conversation_id', 'user_id'] }
  ]
});

module.exports = ConversationParticipant;
