const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class ProjectClient extends Model {}

ProjectClient.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  project_id: { type: DataTypes.BIGINT, allowNull: false },
  client_id: { type: DataTypes.INTEGER, allowNull: true },
  contact_user_id: { type: DataTypes.INTEGER, allowNull: true },
  contact_name: { type: DataTypes.STRING(100), allowNull: true },
  contact_email: { type: DataTypes.STRING(255), allowNull: true },
  invite_token: { type: DataTypes.STRING(100), allowNull: true },
  invite_token_used_at: { type: DataTypes.DATE, allowNull: true },
  invited_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  invited_by: { type: DataTypes.INTEGER, allowNull: true },
}, {
  sequelize,
  tableName: 'project_clients',
  timestamps: false,
  underscored: true,
});

module.exports = ProjectClient;
