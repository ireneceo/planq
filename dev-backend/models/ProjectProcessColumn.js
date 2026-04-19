const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class ProjectProcessColumn extends Model {}

ProjectProcessColumn.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  project_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: 'projects', key: 'id' } },
  col_key: { type: DataTypes.STRING(40), allowNull: false },
  label: { type: DataTypes.STRING(100), allowNull: false },
  col_type: { type: DataTypes.ENUM('text', 'date', 'select', 'number'), allowNull: false, defaultValue: 'text' },
  order_index: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, {
  sequelize, tableName: 'project_process_columns', timestamps: true, underscored: true,
  indexes: [{ unique: true, fields: ['project_id', 'col_key'] }],
});

module.exports = ProjectProcessColumn;
