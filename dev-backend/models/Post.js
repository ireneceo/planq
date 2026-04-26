// Post — 포스팅 기반 문서 (매뉴얼/가이드/공지/회사소개 등)
// project_id NULL = 워크스페이스 전역 문서, NOT NULL = 프로젝트 소속
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Post extends Model {}

Post.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  project_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: 'projects', key: 'id' } },
  conversation_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'conversations', key: 'id' } },
  title: { type: DataTypes.STRING(200), allowNull: false },
  content_json: { type: DataTypes.TEXT('long'), allowNull: true },       // Tiptap JSON
  content_text: { type: DataTypes.TEXT('long'), allowNull: true },       // 검색/프리뷰용 plain text
  category: { type: DataTypes.STRING(40), allowNull: true },             // 자유 분류 라벨
  author_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
  editor_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
  status: { type: DataTypes.ENUM('draft', 'published'), allowNull: false, defaultValue: 'published' },
  visibility: { type: DataTypes.ENUM('internal', 'public'), allowNull: false, defaultValue: 'internal' },
  is_pinned: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  view_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  share_token: { type: DataTypes.STRING(64), allowNull: true, unique: true },
  shared_at: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize, tableName: 'posts', timestamps: true, underscored: true,
  indexes: [
    { fields: ['business_id', 'project_id', 'created_at'] },
    { fields: ['business_id', 'is_pinned'] },
    { fields: ['business_id', 'conversation_id'] },
    { fields: ['share_token'] },
  ]
});

module.exports = Post;
