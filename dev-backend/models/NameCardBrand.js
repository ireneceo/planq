// 명함 ↔ 브랜드 연결 — 명함은 «무엇을 고를지» 만 갖고 브랜드 내용은 갖지 않는다(브랜드를 고치면 명함이 따라간다).
//   JSON 배열이 아니라 연결표인 이유: 삭제가 FK 로 깨끗하고 «이 브랜드를 쓰는 명함 n장» 을 셀 수 있다(Fable 결정 1).
//   보여 줄 때는 services/brands.brandsForCard 가 지금 쓸 수 있는 것만 거른다(멤버 이탈 시 워크스페이스 브랜드가 빠진다).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class NameCardBrand extends Model {}

NameCardBrand.init({
  card_id: { type: DataTypes.INTEGER, primaryKey: true, references: { model: 'name_cards', key: 'id' }, onDelete: 'CASCADE' },
  brand_id: { type: DataTypes.INTEGER, primaryKey: true, references: { model: 'brands', key: 'id' }, onDelete: 'CASCADE' },
  sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, {
  sequelize,
  tableName: 'name_card_brands',
  timestamps: false,
  underscored: true,
  indexes: [{ fields: ['brand_id'], name: 'name_card_brands_brand' }],
});

module.exports = NameCardBrand;
