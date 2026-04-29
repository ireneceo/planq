// 사용자 → PlanQ 운영팀 피드백 (사이클 P6).
// 우측 하단 floating 위젯에서 제출. platform_admin 이 /admin/feedback 에서 관리.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class FeedbackItem extends Model {}

FeedbackItem.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  // 사용자/워크스페이스 컨텍스트
  user_id: {
    type: DataTypes.INTEGER, allowNull: false,
    references: { model: 'users', key: 'id' },
  },
  business_id: {
    type: DataTypes.INTEGER, allowNull: true,
    references: { model: 'businesses', key: 'id' },
  },
  // 분류 (사용자 선택)
  category: {
    type: DataTypes.ENUM('bug', 'improve', 'feature', 'other'),
    allowNull: false,
    defaultValue: 'other',
  },
  // 우선순위 — 사용자가 "긴급" 체크 시 high
  priority: {
    type: DataTypes.ENUM('normal', 'high'),
    allowNull: false,
    defaultValue: 'normal',
  },
  // 본문
  title: { type: DataTypes.STRING(200), allowNull: false },
  body: { type: DataTypes.TEXT, allowNull: false },
  // 스크린샷 / 첨부 (간단 — 파일 path 배열)
  attachments: {
    type: DataTypes.JSON, allowNull: true, defaultValue: null,
  },
  // 자동 수집 메타
  page_url: { type: DataTypes.STRING(500), allowNull: true },
  user_agent: { type: DataTypes.STRING(500), allowNull: true },
  // 처리 상태
  status: {
    type: DataTypes.ENUM('pending', 'reviewing', 'done', 'wontfix'),
    allowNull: false,
    defaultValue: 'pending',
  },
  admin_response: { type: DataTypes.TEXT, allowNull: true },
  // 처리한 platform_admin
  responded_by: {
    type: DataTypes.INTEGER, allowNull: true,
    references: { model: 'users', key: 'id' },
  },
  responded_at: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize,
  tableName: 'feedback_items',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['status'] },
    { fields: ['user_id'] },
    { fields: ['business_id'] },
    { fields: ['category', 'status'] },
  ],
});

module.exports = FeedbackItem;
