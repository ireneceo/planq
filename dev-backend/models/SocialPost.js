// 인사이트 글 SNS 발송 — 채널 한 곳에 나가는 게시물 1건 (docs/SNS_PUBLISH_DESIGN.md §1).
//   상태를 바꾸는 문은 services/social/socialTransition.js 하나다 — status 를 다른 곳에서 update 하지 않는다.
//   반자동 채널(naver·kakao)은 account_id NULL 이고 사람이 [게시함 표시] 로 sent 를 만든다.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');
const SocialAccount = require('./SocialAccount');

class SocialPost extends Model {}

SocialPost.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  article_id: { type: DataTypes.INTEGER, allowNull: false },
  account_id: { type: DataTypes.INTEGER, allowNull: true },
  provider: { type: DataTypes.ENUM(...SocialAccount.PROVIDERS), allowNull: false },
  // 같은 글을 다른 각도로 다시 쓸 때 1, 2, 3 …
  angle: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  kind: { type: DataTypes.ENUM('text', 'image', 'carousel', 'video'), allowNull: false, defaultValue: 'image' },
  body: { type: DataTypes.TEXT, allowNull: true },
  first_comment: { type: DataTypes.TEXT, allowNull: true },
  // 서버가 만든다(우리 도메인 + utm) — 화면이 보낸 링크를 그대로 쓰지 않는다
  link_url: { type: DataTypes.STRING(500), allowNull: true },
  // [{ file, jpg, w, h, mime, template }] — file·jpg 는 uploads 아래 상대 경로
  media: { type: DataTypes.JSON, allowNull: true },
  status: {
    type: DataTypes.ENUM('draft', 'approved', 'scheduled', 'sending', 'sent', 'failed', 'canceled'),
    allowNull: false, defaultValue: 'draft',
  },
  scheduled_at: { type: DataTypes.DATE, allowNull: true },
  sent_at: { type: DataTypes.DATE, allowNull: true },
  approved_by: { type: DataTypes.INTEGER, allowNull: true },
  approved_at: { type: DataTypes.DATE, allowNull: true },
  external_post_id: { type: DataTypes.STRING(200), allowNull: true },
  external_url: { type: DataTypes.STRING(500), allowNull: true },
  error_message: { type: DataTypes.STRING(500), allowNull: true },
  metrics: { type: DataTypes.JSON, allowNull: true },
  metrics_at: { type: DataTypes.DATE, allowNull: true },
  created_by: { type: DataTypes.INTEGER, allowNull: true },
}, {
  sequelize,
  tableName: 'social_posts',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['article_id', 'provider'], name: 'social_posts_article' },
    { fields: ['status', 'scheduled_at'], name: 'social_posts_status' },
  ],
});

module.exports = SocialPost;
