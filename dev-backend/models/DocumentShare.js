const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

// 문서 공유 / 발송 로그 — Q Docs §3.1
// 한 문서가 여러 사람에게 다른 토큰으로 발송될 수 있음 (수신자별 추적).
class DocumentShare extends Model {}

DocumentShare.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  document_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: 'documents', key: 'id' } },
  share_method: { type: DataTypes.ENUM('link', 'email', 'qtalk'), allowNull: false },
  recipient_email: { type: DataTypes.STRING(200), allowNull: true },
  recipient_name: { type: DataTypes.STRING(100), allowNull: true },
  share_token: { type: DataTypes.STRING(64), allowNull: false },
  expires_at: { type: DataTypes.DATE, allowNull: true },
  viewed_at: { type: DataTypes.DATE, allowNull: true },
  viewed_count: { type: DataTypes.INTEGER, defaultValue: 0 },
  signed_at: { type: DataTypes.DATE, allowNull: true },
  shared_by: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
}, {
  sequelize,
  tableName: 'document_shares',
  timestamps: true,
  updatedAt: false,
  underscored: true,
  indexes: [
    { fields: ['document_id'] },
    { fields: ['share_token'] },
  ],
});

module.exports = DocumentShare;
