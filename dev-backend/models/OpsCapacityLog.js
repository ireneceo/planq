const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class OpsCapacityLog extends Model {}

OpsCapacityLog.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  snapshot_at: {
    type: DataTypes.DATE,
    allowNull: false
  },
  businesses_count: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  total_bytes_used: {
    type: DataTypes.BIGINT,
    allowNull: false
  },
  total_files: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  planq_share: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  gdrive_share: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  stage_reached: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  sequelize,
  tableName: 'ops_capacity_log',
  timestamps: true,
  underscored: true
});

module.exports = OpsCapacityLog;
