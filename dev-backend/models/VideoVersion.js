// 시연 영상 대본 판 — 되돌리기 단위. 승인 뒤 script 는 고치지 않는다(새 판). 판은 지우지 않는다 (§2 · §20.2).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class VideoVersion extends Model {}

VideoVersion.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  project_id: { type: DataTypes.INTEGER, allowNull: false },
  version_no: { type: DataTypes.INTEGER, allowNull: false },
  parent_version_id: { type: DataTypes.INTEGER, allowNull: true },
  // 대본 정본 — video-engine/storyboards/*.json 과 같은 모양. LONGTEXT 에 JSON 문자열로 둔다(512KB 상한은 라우트가 검사).
  script: {
    type: DataTypes.TEXT('long'), allowNull: false,
    get() { const v = this.getDataValue('script'); try { return v ? JSON.parse(v) : null; } catch { return null; } },
    set(v) { this.setDataValue('script', typeof v === 'string' ? v : JSON.stringify(v)); },
  },
  change_note: { type: DataTypes.STRING(500), allowNull: true },
  source: { type: DataTypes.ENUM('ai', 'human', 'revert', 'auto'), allowNull: false, defaultValue: 'ai' },
  ai_meta: { type: DataTypes.JSON, allowNull: true },
  status: { type: DataTypes.ENUM('draft', 'approved', 'rendering', 'rendered', 'failed'), allowNull: false, defaultValue: 'draft' },
  outputs: { type: DataTypes.JSON, allowNull: true },
  approved_by: { type: DataTypes.INTEGER, allowNull: true },
  approved_at: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize,
  tableName: 'video_versions',
  timestamps: true,
  underscored: true,
  indexes: [{ unique: true, fields: ['project_id', 'version_no'], name: 'video_versions_no' }],
});

module.exports = VideoVersion;
