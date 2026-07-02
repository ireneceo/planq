const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

// Q위키 자기강화 루프 (KNOWLEDGE_LOOP_DESIGN 축2) — Q helper 질문 전량 로그.
// 미답변·불만족 질문이 주간 클러스터링을 거쳐 위키 초안 제안으로 되먹임된다.
class HelpQuestionLog extends Model {}

HelpQuestionLog.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER, allowNull: true, comment: '공개(비로그인) 질문은 NULL' },
  business_id: { type: DataTypes.INTEGER, allowNull: true },
  mode: { type: DataTypes.ENUM('qhelper', 'public'), allowNull: false, defaultValue: 'qhelper' },
  question: { type: DataTypes.STRING(1000), allowNull: false },
  lang: { type: DataTypes.STRING(5), allowNull: true },
  answered: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, comment: '근거 위키 article 검색 hit 여부' },
  top_article_id: { type: DataTypes.INTEGER, allowNull: true, comment: '최상위 근거 help_articles.id' },
  feedback: { type: DataTypes.ENUM('helpful', 'not_helpful'), allowNull: true },
  feedback_at: { type: DataTypes.DATE, allowNull: true },
  processed_article_id: { type: DataTypes.INTEGER, allowNull: true, comment: '클러스터 초안에 반영된 help_articles.id (재처리 방지)' },
}, {
  sequelize,
  tableName: 'help_question_logs',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['created_at'] },
    { fields: ['answered', 'feedback'] },
    { fields: ['processed_article_id'] },
  ],
});

module.exports = HelpQuestionLog;
