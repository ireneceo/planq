// 메일 알림 — 사람 × 메일함 덮어쓰기 (2026-10-22, docs/MAIL_NOTIFY_PER_ADDRESS_DESIGN.md D1)
//
// 계정의 notify_scope 는 «기본값» 이고, 사람마다 계정별로 덮어쓴다(«받지 않음» 포함).
// ★ «기본값 따름» 은 값이 아니라 **행의 부재**다 — ENUM 에 'default' 를 두지 않는다(같은 뜻이 둘이면 판정이 갈린다).
//   API 의 'default' 는 행 삭제로 번역한다(routes/email_accounts.js my-notify).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class EmailAccountNotifyPref extends Model {}

EmailAccountNotifyPref.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' }, onDelete: 'CASCADE' },
  email_account_id: {
    type: DataTypes.INTEGER, allowNull: false,
    references: { model: 'email_accounts', key: 'id' }, onDelete: 'CASCADE',
  },
  user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
  notify_scope: { type: DataTypes.ENUM('off', 'reply_only', 'recommended', 'all'), allowNull: false },
}, {
  sequelize,
  modelName: 'EmailAccountNotifyPref',
  tableName: 'email_account_notify_prefs',
  timestamps: true,
  underscored: true,
  indexes: [
    // 컬럼 레벨 unique: true 금지 — sync 때마다 인덱스가 쌓인다(EmailAccountAlias 와 같은 이유)
    { unique: true, fields: ['email_account_id', 'user_id'], name: 'uq_mail_notify_pref_account_user' },
    { fields: ['user_id', 'business_id'], name: 'mail_notify_pref_user_biz' },
  ],
});

module.exports = EmailAccountNotifyPref;
