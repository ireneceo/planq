// 발신 별칭 (Send-as) — 한 메일함으로 여러 도메인 주소를 받고, 받은 주소로 답장한다.
//
// Gmail·Outlook 의 "다른 주소로 메일 보내기" 와 같은 개념. PlanQ 는 별칭을 등록해 두고 고르게 하고,
// 그 주소로 보낼 권한 자체는 메일 제공자(Gmail 등)에서 인증돼 있어야 한다 — 화면에 그렇게 안내한다.
//
// 서명을 별칭 단위로 둔 이유: 도메인이 다르면 브랜드가 다르다. 다른 브랜드 주소로 보내면서 같은
// 서명이 붙으면 사고다. NULL 이면 계정 서명으로 폴백.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class EmailAccountAlias extends Model {}

EmailAccountAlias.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  account_id: {
    type: DataTypes.INTEGER, allowNull: false,
    references: { model: 'email_accounts', key: 'id' }, onDelete: 'CASCADE',
  },
  email: { type: DataTypes.STRING(200), allowNull: false },
  display_name: { type: DataTypes.STRING(100), allowNull: true },
  signature_html: { type: DataTypes.TEXT, allowNull: true },
  is_default: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, {
  sequelize,
  modelName: 'EmailAccountAlias',
  tableName: 'email_account_aliases',
  timestamps: true,
  underscored: true,
  indexes: [
    // 컬럼 레벨 unique: true 를 쓰면 sync 때마다 인덱스가 쌓여 언젠가 "Too many keys" 로 배포가 죽는다
    { unique: true, fields: ['account_id', 'email'], name: 'email_alias_account_email' },
    { fields: ['business_id'], name: 'email_alias_business' },
  ],
});

module.exports = EmailAccountAlias;
