const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class ProjectStatusOption extends Model {}

ProjectStatusOption.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  project_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: 'projects', key: 'id' } },
  status_key: { type: DataTypes.STRING(40), allowNull: false },
  label: { type: DataTypes.STRING(80), allowNull: false },
  color: { type: DataTypes.STRING(20), allowNull: true },
  order_index: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, {
  sequelize, tableName: 'project_status_options', timestamps: true, underscored: true,
  indexes: [{ unique: true, fields: ['project_id', 'status_key'] }],
});

module.exports = ProjectStatusOption;
