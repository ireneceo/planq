// 받은 명함(명함첩) — 설계 docs/BUSINESS_CARD_DESIGN.md.
//
//   snapshot = 보관한 순간의 공개 응답(services/nameCard.cardPublicView 출력 그대로) — 종이 명함처럼 내 것이다.
//   원본이 지워지면 source_card_id 가 NULL 이 되고 보관본은 남는다. 사진도 따로 복사해 둔다.
//   ★ 응답에 원본의 public_token 을 싣지 않는다(Fable 차단2) — 원본 열기는 서버가 공개 판정 뒤 302.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class SavedNameCard extends Model {}

SavedNameCard.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
  source_card_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'name_cards', key: 'id' }, onDelete: 'SET NULL' },
  snapshot: { type: DataTypes.JSON, allowNull: false },
  source_updated_at: { type: DataTypes.DATE, allowNull: true },
  has_photo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  memo: { type: DataTypes.STRING(500), allowNull: true },
}, {
  sequelize,
  tableName: 'saved_name_cards',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['user_id', 'source_card_id'] },
  ],
});

module.exports = SavedNameCard;
