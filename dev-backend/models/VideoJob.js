// 시연 영상 작업자 대기열 — 운영 DB 에 두고 dev 작업자가 /api/video-worker/claim 으로 받아 간다 (§20.2 · §20.4).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class VideoJob extends Model {}

VideoJob.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  kind: { type: DataTypes.ENUM('produce', 'revise', 'prep_voice', 'reupload'), allowNull: false },
  project_id: { type: DataTypes.INTEGER, allowNull: false },
  version_id: { type: DataTypes.INTEGER, allowNull: true },
  payload: { type: DataTypes.JSON, allowNull: true },
  status: { type: DataTypes.ENUM('queued', 'running', 'done', 'failed', 'canceled'), allowNull: false, defaultValue: 'queued' },
  attempts: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 0 },
  priority: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  claimed_by: { type: DataTypes.STRING(120), allowNull: true },
  claimed_at: { type: DataTypes.DATE, allowNull: true },
  heartbeat_at: { type: DataTypes.DATE, allowNull: true },
  stage: { type: DataTypes.STRING(20), allowNull: true },
  progress: { type: DataTypes.DECIMAL(5, 3), allowNull: true },
  log: { type: DataTypes.TEXT, allowNull: true },
  result: { type: DataTypes.JSON, allowNull: true },
  error_code: { type: DataTypes.STRING(40), allowNull: true },
  error_message: { type: DataTypes.STRING(2000), allowNull: true },
  finished_at: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize,
  tableName: 'video_jobs',
  timestamps: true,
  underscored: true,
  indexes: [{ fields: ['status', 'priority', 'id'], name: 'video_jobs_queue' }, { fields: ['project_id'], name: 'video_jobs_project' }],
});

module.exports = VideoJob;
