const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Message extends Model {}

Message.init({
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
  sender_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' }
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  task_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'tasks', key: 'id' }
  },
  is_edited: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  edited_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  is_deleted: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  deleted_at: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  sequelize,
  tableName: 'messages',
  timestamps: true,
  underscored: true
});

module.exports = Message;
