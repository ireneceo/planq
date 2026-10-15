// 문서(Q docs post) 댓글 — 설계 docs/DOC_COMMENTS_DESIGN.md (2026-10-15 Fable).
//
//   볼 수 있는 사람 = 문서를 읽을 수 있는 사람(services/postAccess.canReadPost). 새 술어를 만들지 않는다.
//   visibility: internal = 멤버만 · shared = 멤버 + 그 문서를 읽을 수 있는 고객.
//   ★ personal 은 없다 — 댓글은 남에게 보이는 글이다(나만 보는 메모는 Q note).
//   ★ 문서 밖(공유 링크·PDF·서명본·검색·AI get_document)으로 나가지 않는다.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class PostComment extends Model {}

PostComment.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  post_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'posts', key: 'id' }, onDelete: 'CASCADE' },
  // 테넌트 WHERE 용 — 문서의 business_id 를 서버가 복사한다(입력으로 받지 않는다)
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
  content: { type: DataTypes.TEXT, allowNull: false },
  visibility: { type: DataTypes.ENUM('internal', 'shared'), allowNull: false, defaultValue: 'internal' },
}, {
  sequelize,
  tableName: 'post_comments',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['post_id', 'created_at'] },
    { fields: ['business_id'] },
  ],
});

module.exports = PostComment;
