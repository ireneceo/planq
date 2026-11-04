// 시연 영상 요청 1건 = 영상 1편 (docs/DEMO_VIDEO_DESIGN.md §20.2). 플랫폼 마케팅 도구 — business_id 없음, platform_admin 전용.
//   상태는 services/video/videoTransition 한 문으로만 바꾼다. 판(대본) 상태는 video_versions 에 따로.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class VideoProject extends Model {}

VideoProject.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  title: { type: DataTypes.STRING(200), allowNull: false },
  mode: { type: DataTypes.ENUM('recording', 'instruction', 'brand'), allowNull: false, defaultValue: 'instruction' },
  brief: { type: DataTypes.TEXT, allowNull: true },
  target_seconds: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 30 },
  aspects: { type: DataTypes.JSON, allowNull: true },
  template: { type: DataTypes.STRING(60), allowNull: true },
  music: { type: DataTypes.STRING(120), allowNull: true },
  placement: { type: DataTypes.STRING(40), allowNull: true },
  channels: { type: DataTypes.JSON, allowNull: true },
  status: { type: DataTypes.ENUM('planned', 'producing', 'needs_review', 'awaiting_link', 'published', 'failed', 'archived'), allowNull: false, defaultValue: 'planned' },
  plan_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  auto_approve: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  attempts: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 0 },
  producing_started_at: { type: DataTypes.DATE, allowNull: true },
  review_reason: { type: DataTypes.STRING(40), allowNull: true },
  review_detail: { type: DataTypes.TEXT, allowNull: true },
  current_version_id: { type: DataTypes.INTEGER, allowNull: true },
  approved_version_id: { type: DataTypes.INTEGER, allowNull: true },
  gate_overrides: { type: DataTypes.JSON, allowNull: true },
  stage_from: { type: DataTypes.ENUM('script', 'render'), allowNull: false, defaultValue: 'script' },
  drive_folder_id: { type: DataTypes.STRING(120), allowNull: true },
  youtube_url: { type: DataTypes.STRING(300), allowNull: true },
  youtube_video_id: { type: DataTypes.STRING(20), allowNull: true },
  youtube_meta: { type: DataTypes.JSON, allowNull: true },
  published_at: { type: DataTypes.DATE, allowNull: true },
  published_by: { type: DataTypes.INTEGER, allowNull: true },
  sns_publish_by: { type: DataTypes.INTEGER, allowNull: true },
  sns_publish_at: { type: DataTypes.DATE, allowNull: true },
  sns_spread: { type: DataTypes.ENUM('all', 'daily'), allowNull: true },
  created_by: { type: DataTypes.INTEGER, allowNull: true },
}, {
  sequelize,
  tableName: 'video_projects',
  timestamps: true,
  paranoid: true,
  underscored: true,
  indexes: [{ fields: ['status', 'plan_order'], name: 'video_projects_plan' }, { fields: ['youtube_video_id'], name: 'video_projects_youtube' }],
});

module.exports = VideoProject;
