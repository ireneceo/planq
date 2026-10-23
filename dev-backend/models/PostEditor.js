// 문서 공동 편집자 — 설계 docs/DOC_COEDITORS_DESIGN.md (2026-10-23 Fable).
//
//   편집 판정은 services/postAccess.canEditPost 한 곳이 이 표를 읽는다(작성자 ∨ 여기 있음 ∧ 활성 멤버 ∧ 지금 읽을 수 있음).
//   행을 지우는 문은 둘뿐 — 명시 해제(routes/post_editors) · 멤버 내보내기. 범위가 좁아져 못 읽게 돼도 행은 둔다.
//   added_by NULL = 백필(migrate-post-editors --apply) — 옛 문서를 실제로 고친 적 있는 사람.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class PostEditor extends Model {}

PostEditor.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  post_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'posts', key: 'id' }, onDelete: 'CASCADE' },
  user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
  added_by: { type: DataTypes.INTEGER, allowNull: true },
}, {
  sequelize,
  tableName: 'post_editors',
  timestamps: true,
  updatedAt: false,
  underscored: true,
  indexes: [
    { unique: true, fields: ['post_id', 'user_id'] },
    { fields: ['user_id'] },
  ],
});

module.exports = PostEditor;
