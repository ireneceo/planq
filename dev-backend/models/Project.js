const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Project extends Model {}

Project.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  name: { type: DataTypes.STRING(200), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  client_company: { type: DataTypes.STRING(200), allowNull: true },
  status: {
    type: DataTypes.ENUM('active', 'paused', 'closed'),
    defaultValue: 'active',
  },
  start_date: { type: DataTypes.DATEONLY, allowNull: true },
  end_date: { type: DataTypes.DATEONLY, allowNull: true },
  default_assignee_user_id: { type: DataTypes.INTEGER, allowNull: true },
  owner_user_id: { type: DataTypes.INTEGER, allowNull: false },
}, {
  sequelize,
  tableName: 'projects',
  timestamps: true,
  underscored: true,
});

module.exports = Project;
