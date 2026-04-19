const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class ProjectNote extends Model {}

ProjectNote.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  project_id: { type: DataTypes.BIGINT, allowNull: false },
  author_user_id: { type: DataTypes.INTEGER, allowNull: false },
  visibility: {
    type: DataTypes.ENUM('personal', 'internal', 'shared'),
    allowNull: false,
    comment: 'personal: 본인만 | internal: 내부 멤버 | shared: 내부 + 관련 고객',
  },
  body: { type: DataTypes.TEXT, allowNull: false },
}, {
  sequelize,
  tableName: 'project_notes',
  timestamps: true,
  underscored: true,
});

module.exports = ProjectNote;
