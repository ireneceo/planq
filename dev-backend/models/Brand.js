// 브랜드 — 회사(워크스페이스) 하나에 브랜드 여럿 · 개인 브랜드. 설계 docs/NAME_CARD_V2_DESIGN.md 6절 결정 1·2 (Fable 2026-10-22)
//
//   ★ 쓰는 문은 services/brands.js 한 곳 — 워크스페이스 기본 브랜드는 businesses.brand_name/_en/brand_tagline/_en/brand_logo_url 로
//     같은 트랜잭션에서 사본을 쓴다(write-through). 옛 칸을 읽는 곳(268곳)은 그대로 둔다. 가드 --category=brandwrite.
//   ★ owner_kind business ⇒ business_id NN ∧ user_id NULL / user ⇒ 반대 (서비스가 검증).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Brand extends Model {}

Brand.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  owner_kind: { type: DataTypes.ENUM('business', 'user'), allowNull: false },
  business_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'businesses', key: 'id' }, onDelete: 'CASCADE' },
  user_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
  name: { type: DataTypes.STRING(100), allowNull: false },
  name_en: { type: DataTypes.STRING(100), allowNull: true },
  tagline: { type: DataTypes.STRING(200), allowNull: true },
  tagline_en: { type: DataTypes.STRING(200), allowNull: true },
  logo_url: { type: DataTypes.STRING(500), allowNull: true },
  links: { type: DataTypes.JSON, allowNull: true },
  is_default: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  created_by: { type: DataTypes.INTEGER, allowNull: true },
}, {
  sequelize,
  tableName: 'brands',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['business_id', 'sort_order'], name: 'brands_biz_sort' },
    { fields: ['user_id', 'sort_order'], name: 'brands_user_sort' },
  ],
});

module.exports = Brand;
