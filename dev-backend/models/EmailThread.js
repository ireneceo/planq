// EmailThread — 메일 스레드 (Q Mail M1)
// 같은 In-Reply-To 또는 Subject+참여자 set 으로 클러스터링.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class EmailThread extends Model {}

EmailThread.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  account_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'email_accounts', key: 'id' } },
  subject: { type: DataTypes.STRING(500), allowNull: true },
  // 자동 매칭
  client_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'clients', key: 'id' } },
  project_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: 'projects', key: 'id' } },
  // 상태
  status: {
    type: DataTypes.ENUM('open', 'spam', 'uncertain', 'archived'),
    allowNull: false, defaultValue: 'open',
  },
  // 답변 필요 (★ 사용자 호소 #3)
  reply_needed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  reply_needed_reason: { type: DataTypes.STRING(200), allowNull: true },
  reply_needed_at: { type: DataTypes.DATE, allowNull: true },
  // Uncertain (★ 사용자 호소 #6)
  uncertain_reason: { type: DataTypes.STRING(200), allowNull: true },
  spam_score: { type: DataTypes.FLOAT, allowNull: true },
  // Inbound 트리아지 (사이클 N+83) — human(답장필요) / automated(자동알림) / marketing(벌크) / spam / unknown(미분류)
  //   인박스 노이즈 분리 + reply_needed 자동 판정 근거. emailTriage.js 가 IMAP 수집 시 계산.
  triage: { type: DataTypes.STRING(20), allowNull: true, defaultValue: 'unknown' },
  // AI 스레드 요약 (N+87 Phase C) — on-demand 생성. 긴 스레드 빠른 파악.
  ai_summary: { type: DataTypes.TEXT, allowNull: true },
  ai_summary_at: { type: DataTypes.DATE, allowNull: true },
  ai_summary_model: { type: DataTypes.STRING(50), allowNull: true },
  // 핀
  is_starred: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  // 라벨
  labels: { type: DataTypes.JSON, allowNull: true, defaultValue: null },
  // 메타
  message_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  unread_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  last_message_at: { type: DataTypes.DATE, allowNull: true },
  last_message_direction: { type: DataTypes.ENUM('inbound', 'outbound'), allowNull: true },
  last_message_preview: { type: DataTypes.STRING(500), allowNull: true },
  participants: { type: DataTypes.JSON, allowNull: true, defaultValue: null },
  // visibility 4단계 통일
  vlevel: { type: DataTypes.ENUM('L1', 'L2', 'L3', 'L4'), allowNull: true, defaultValue: 'L3' },
  target_member_ids: { type: DataTypes.JSON, allowNull: true, defaultValue: null },
  // 공유
  share_token: { type: DataTypes.STRING(64), allowNull: true },
  shared_at: { type: DataTypes.DATE, allowNull: true },
  share_expires_at: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize, tableName: 'email_threads', timestamps: true, underscored: true,
  indexes: [
    { fields: ['business_id', 'status', 'last_message_at'], name: 'email_threads_biz_status_time' },
    { fields: ['business_id', 'reply_needed', 'last_message_at'], name: 'email_threads_biz_reply' },
    { fields: ['business_id', 'triage', 'last_message_at'], name: 'email_threads_biz_triage' },
    { fields: ['business_id', 'client_id'], name: 'email_threads_biz_client' },
    { fields: ['business_id', 'project_id'], name: 'email_threads_biz_project' },
    { fields: ['business_id', 'vlevel'], name: 'email_threads_biz_vlevel' },
    { unique: true, fields: ['share_token'], name: 'email_threads_share_token_unique' },
  ],
});

module.exports = EmailThread;
