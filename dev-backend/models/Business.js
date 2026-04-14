const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Business extends Model {}

Business.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  // Legacy 호환 (brand_name 로 이전 중, 아직 일부 코드가 name 사용)
  name: {
    type: DataTypes.STRING(200),
    allowNull: true
  },
  slug: {
    type: DataTypes.STRING(200),
    allowNull: false,
    unique: true
  },
  logo_url: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  owner_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' }
  },
  // ─── 기본 언어 (가입 시 선택: ko/en) ───
  default_language: {
    type: DataTypes.STRING(2),
    allowNull: false,
    defaultValue: 'ko'
  },
  // ─── 브랜드 (사용자 표기 BI — 일상 UI·마케팅·대화 헤더) ───
  brand_name: {
    type: DataTypes.STRING(200),
    allowNull: true
  },
  brand_name_en: {
    type: DataTypes.STRING(200),
    allowNull: true
  },
  brand_tagline: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  brand_tagline_en: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  brand_logo_url: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  brand_color: {
    type: DataTypes.STRING(20),
    allowNull: true
  },
  // ─── 법인 정보 (공식 문서·청구서·계약서용) ───
  legal_name: {
    type: DataTypes.STRING(200),
    allowNull: true
  },
  legal_name_en: {
    type: DataTypes.STRING(200),
    allowNull: true
  },
  legal_entity_type: {
    type: DataTypes.ENUM('corporation', 'individual', 'llc', 'other'),
    allowNull: true
  },
  tax_id: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  representative: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  representative_en: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  address: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  address_en: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  phone: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  email: {
    type: DataTypes.STRING(200),
    allowNull: true
  },
  website: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  // ─── 타임존·근무시간 ───
  timezone: {
    type: DataTypes.STRING(50),
    allowNull: true,
    defaultValue: 'Asia/Seoul'
  },
  work_hours: {
    type: DataTypes.JSON,
    allowNull: true
  },
  // ─── 구독 ───
  plan: {
    type: DataTypes.ENUM('free', 'basic', 'pro', 'enterprise'),
    defaultValue: 'free'
  },
  plan_expires_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  subscription_status: {
    type: DataTypes.ENUM('active', 'past_due', 'canceled', 'trialing'),
    defaultValue: 'active'
  },
  // ─── Cue 설정 ───
  cue_mode: {
    type: DataTypes.ENUM('smart', 'auto', 'draft'),
    defaultValue: 'smart'
  },
  cue_user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'users', key: 'id' }
  },
  cue_paused: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  // ─── 스토리지 ───
  storage_used_bytes: {
    type: DataTypes.BIGINT,
    defaultValue: 0
  },
  storage_limit_bytes: {
    type: DataTypes.BIGINT,
    defaultValue: 1073741824 // 1GB
  }
}, {
  sequelize,
  tableName: 'businesses',
  timestamps: true,
  underscored: true
});

module.exports = Business;
