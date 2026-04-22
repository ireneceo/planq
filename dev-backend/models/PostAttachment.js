// PostAttachment — 포스팅 첨부 파일 (File 테이블 참조)
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class PostAttachment extends Model {}

PostAttachment.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  post_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'posts', key: 'id' } },
  file_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'files', key: 'id' } },
  sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, {
  sequelize, tableName: 'post_attachments', timestamps: true, underscored: true,
  indexes: [{ fields: ['post_id'] }, { fields: ['file_id'] }]
});

module.exports = PostAttachment;
