const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class ProjectNote extends Model {}

ProjectNote.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  // 프로젝트 혹은 conversation 둘 중 하나 이상은 반드시 세팅. 독립 대화는 project_id null + conversation_id.
  project_id: { type: DataTypes.BIGINT, allowNull: true },
  conversation_id: { type: DataTypes.INTEGER, allowNull: true },
  author_user_id: { type: DataTypes.INTEGER, allowNull: false },
  visibility: {
    type: DataTypes.ENUM('personal', 'internal', 'shared'),
    allowNull: false,
    comment: 'personal: 본인만 | internal: 내부 멤버 | shared: 내부 + 관련 고객',
  },
  // N+67 — 4단계 visibility 통합. personal→L1 / internal→L3 / shared→L4.
  vlevel: {
    type: DataTypes.ENUM('L1', 'L2', 'L3', 'L4'),
    allowNull: true,
    defaultValue: null,
  },
  target_member_ids: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: null,
  },
  body: { type: DataTypes.TEXT, allowNull: false },
}, {
  sequelize,
  tableName: 'project_notes',
  timestamps: true,
  underscored: true,
});

// N+67 — vlevel ↔ visibility 양방향 동기
ProjectNote.addHook('beforeSave', (n) => {
  if (n.vlevel) {
    n.visibility = n.vlevel === 'L1' ? 'personal' : n.vlevel === 'L4' ? 'shared' : 'internal';
  } else {
    n.vlevel = n.visibility === 'personal' ? 'L1' : n.visibility === 'shared' ? 'L4' : 'L3';
  }
});

module.exports = ProjectNote;
