const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class User extends Model {}

User.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  email: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true
  },
  username: {
    type: DataTypes.STRING(50),
    allowNull: true,
    unique: true
  },
  password_hash: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  phone: {
    type: DataTypes.STRING(20),
    allowNull: true
  },
  avatar_url: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  platform_role: {
    type: DataTypes.ENUM('platform_admin', 'user'),
    defaultValue: 'user'
  },
  status: {
    type: DataTypes.ENUM('active', 'suspended', 'deleted'),
    defaultValue: 'active'
  },
  last_login_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  refresh_token: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  reset_token: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  reset_token_expires: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // 사용자 인터페이스/번역 기본 언어 (ISO 639-1 코드: ko, en, ja, zh, ...)
  // Q Note 등에서 "내가 보고 싶은 언어"의 디폴트로 사용. 회원가입 시 브라우저 언어로 자동 세팅.
  language: {
    type: DataTypes.STRING(10),
    allowNull: false,
    defaultValue: 'ko'
  },
  // 사용자 프로필 (Q Note 답변을 "나"로서 생성할 때 사용)
  bio: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  expertise: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  organization: {
    type: DataTypes.STRING(200),
    allowNull: true
  },
  job_title: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  // 언어별 4개 skill (reading/speaking/listening/writing) 수준 1-6
  // 예: {"ko":{"reading":6,"speaking":6,"listening":6,"writing":6},"en":{"reading":4,"speaking":3,"listening":3,"writing":3}}
  language_levels: {
    type: DataTypes.JSON,
    allowNull: true
  },
  // 전문 지식 수준: 'layman' | 'practitioner' | 'expert'
  expertise_level: {
    type: DataTypes.STRING(20),
    allowNull: true
  },
  // 답변 스타일 기본값 (회의 시작 시 override 가능)
  answer_style_default: {
    type: DataTypes.STRING(2000),
    allowNull: true
  },
  // 답변 길이 기본값: 'short' | 'medium' | 'long'
  answer_length_default: {
    type: DataTypes.STRING(20),
    allowNull: true,
    defaultValue: 'medium'
  },
  // AI 팀원(Cue) 플래그. true 면 로그인 불가, 자동 생성된 시스템 계정
  is_ai: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  },
  // 마지막으로 선택한 워크스페이스 — 로그인 후 자동 진입 + 워크스페이스 스위처 기본값
  // 멤버십이 끊기거나 삭제되면 SET NULL → 첫 가용 워크스페이스로 fallback
  active_business_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  }
}, {
  sequelize,
  tableName: 'users',
  timestamps: true,
  underscored: true
});

module.exports = User;
