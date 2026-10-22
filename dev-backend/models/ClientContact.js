// 고객 담당자 — 고객(회사) 아래 «추가 담당자» 주소록. 설계 docs/NAME_CARD_V3_STRATEGY.md 9절 결정 2 (Fable 2026-10-22)
//   ★ 담당자는 허브가 아니다 — 대화·업무·청구·파일·프로젝트 어디도 contact_id 를 갖지 않는다(메일·대화는 client_id 로 붙는다).
//   ★ 담당자는 로그인하지 않는다 — 초대·계정 연결·고객 한도는 지금처럼 clients 한 행만 본다.
//   읽고 쓰는 문은 services/clientContacts.js 한 곳. business_id 는 테넌트 키로 중복 보유한다(모든 WHERE 에 건다).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class ClientContact extends Model {}

ClientContact.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' }, onDelete: 'CASCADE' },
  client_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'clients', key: 'id' }, onDelete: 'CASCADE' },
  name: { type: DataTypes.STRING(100), allowNull: false },
  name_en: { type: DataTypes.STRING(100), allowNull: true },
  job_title: { type: DataTypes.STRING(100), allowNull: true },
  department: { type: DataTypes.STRING(100), allowNull: true },
  email: { type: DataTypes.STRING(200), allowNull: true },
  mobile: { type: DataTypes.STRING(40), allowNull: true },
  phone: { type: DataTypes.STRING(40), allowNull: true },
  fax: { type: DataTypes.STRING(40), allowNull: true },
  address: { type: DataTypes.STRING(300), allowNull: true },
  memo: { type: DataTypes.STRING(500), allowNull: true },
  photo_file_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'files', key: 'id' }, onDelete: 'SET NULL' },
  source: { type: DataTypes.ENUM('manual', 'name_card', 'photo', 'mail', 'chat'), allowNull: false, defaultValue: 'manual' },
  source_card_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'name_cards', key: 'id' }, onDelete: 'SET NULL' },
  created_by: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
  sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, {
  sequelize,
  tableName: 'client_contacts',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['business_id', 'email'], name: 'client_contacts_biz_email' },
    { fields: ['client_id'], name: 'client_contacts_client' },
  ],
});

module.exports = ClientContact;
