const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Task extends Model {}

Task.init({
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
  conversation_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'conversations', key: 'id' }
  },
  source_message_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'messages', key: 'id' }
  },
  title: {
    type: DataTypes.STRING(300),
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  assignee_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'users', key: 'id' }
  },
  client_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'clients', key: 'id' }
  },
  status: {
    type: DataTypes.ENUM('pending', 'in_progress', 'completed', 'canceled'),
    defaultValue: 'pending'
  },
  priority: {
    type: DataTypes.ENUM('low', 'medium', 'high', 'urgent'),
    defaultValue: 'medium'
  },
  due_date: {
    type: DataTypes.DATEONLY,
    allowNull: true
  },
  completed_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  created_by: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' }
  }
}, {
  sequelize,
  tableName: 'tasks',
  timestamps: true,
  underscored: true
});

module.exports = Task;
