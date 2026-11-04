// 시연 영상 일정·작업자 신호 — 1행(id=1) (§20.2). schedule = {enabled, per_day, window:{from,to}(KST), weekdays:[1..7](월=1), publish_spread}.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class VideoSetting extends Model {}

VideoSetting.init({
  id: { type: DataTypes.INTEGER, primaryKey: true },
  schedule: { type: DataTypes.JSON, allowNull: true },
  worker_seen_at: { type: DataTypes.DATE, allowNull: true },
  worker_name: { type: DataTypes.STRING(120), allowNull: true },
}, {
  sequelize,
  tableName: 'video_settings',
  timestamps: true,
  createdAt: false,
  underscored: true,
});

module.exports = VideoSetting;
