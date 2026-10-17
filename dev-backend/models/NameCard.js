// 내 명함 — 설계 docs/BUSINESS_CARD_DESIGN.md (2026-10-17 Fable 설계 판정).
//
//   ★ **계정 소유**다(워크스페이스 데이터가 아니다 — 프로필 사진과 같은 축). 워크스페이스를 떠나도 남는다.
//     source_business_id 는 «채울 때 쓴 워크스페이스» 표시일 뿐 권한·범위가 아니다.
//   ★ 칸 값은 명함 자신의 값이다(라이브 연결 아님) — 장마다 직책·하는 일을 바꾸려는 것이 요구다.
//   ★ 공개 판정은 services/nameCard.resolvePublicCard 한 함수, 공개 응답은 cardPublicView 한 함수.
//     이 모델을 통째로(toJSON) 밖으로 내보내지 않는다 — public_token·user_id 가 실린다.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class NameCard extends Model {}

NameCard.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
  label: { type: DataTypes.STRING(60), allowNull: false },
  source_business_id: { type: DataTypes.INTEGER, allowNull: true },
  name: { type: DataTypes.STRING(100), allowNull: true },
  name_en: { type: DataTypes.STRING(100), allowNull: true },
  job_title: { type: DataTypes.STRING(100), allowNull: true },
  department: { type: DataTypes.STRING(100), allowNull: true },
  company: { type: DataTypes.STRING(150), allowNull: true },
  intro: { type: DataTypes.STRING(500), allowNull: true },
  mobile: { type: DataTypes.STRING(40), allowNull: true },
  phone: { type: DataTypes.STRING(40), allowNull: true },
  fax: { type: DataTypes.STRING(40), allowNull: true },
  email: { type: DataTypes.STRING(150), allowNull: true },
  website: { type: DataTypes.STRING(300), allowNull: true },
  address: { type: DataTypes.STRING(300), allowNull: true },
  links: { type: DataTypes.JSON, allowNull: true },
  accent_color: { type: DataTypes.STRING(7), allowNull: true },
  has_photo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  photo_ver: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  public_token: { type: DataTypes.STRING(32), allowNull: false, unique: true },
  is_public: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, {
  sequelize,
  tableName: 'name_cards',
  timestamps: true,
  underscored: true,
  indexes: [{ fields: ['user_id', 'sort_order'] }],
});

module.exports = NameCard;
