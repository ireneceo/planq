// 플랫폼(=PlanQ 자체) 운영 정보 — 단일 row 테이블 (id=1 고정).
// 메일 푸터·법적 표기·지원 메일·로고 같이 자주 안 변하지만 .env 직접 수정 대신 관리자 UI 에서.
// emailService 가 5분 캐시로 조회. 첫 row 가 없으면 .env 또는 hard-coded fallback.

const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class PlatformSetting extends Model {}

PlatformSetting.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  brand: {
    type: DataTypes.STRING(100),
    allowNull: false,
    defaultValue: 'PlanQ',
  },
  tagline: {
    type: DataTypes.STRING(300),
    allowNull: true,
  },
  website: {
    type: DataTypes.STRING(300),
    allowNull: true,
  },
  support_email: {
    type: DataTypes.STRING(200),
    allowNull: true,
  },
  legal_entity: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  email_logo_url: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
  updated_by_user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'users', key: 'id' },
  },
}, {
  sequelize,
  tableName: 'platform_settings',
  timestamps: true,
  underscored: true,
});

module.exports = PlatformSetting;
