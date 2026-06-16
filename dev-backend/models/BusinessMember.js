const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class BusinessMember extends Model {}

BusinessMember.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  business_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'businesses', key: 'id' }
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: true, // 초대 pending 단계에서는 아직 user 매칭 전이라 null 허용
    references: { model: 'users', key: 'id' }
  },
  invite_token: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  invite_email: {
    type: DataTypes.STRING(200),
    allowNull: true,
  },
  invited_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  removed_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '워크스페이스에서 제거된 시각 (soft delete). null 이면 활성 멤버',
  },
  removed_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'users', key: 'id' },
  },
  // 'owner' = 관리자 (사용자 표기), 'member' = 멤버, 'ai' = Cue 전용
  role: {
    type: DataTypes.ENUM('owner', 'member', 'ai'),
    defaultValue: 'member'
  },
  // 워크스페이스별 이름 (null 이면 User.name 사용). 한 사용자가 여러 워크스페이스에서 다른 표시 이름을 가질 수 있음.
  name: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  // 워크스페이스별 다국어 이름 — 예: { ko: "김오너", en: "Owen Kim" }. null 이면 User.name_localized fallback.
  name_localized: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: null,
  },
  // 프로젝트에서 사용하는 기본 역할 (예: '기획', '디자인', '개발')
  default_role: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  // ─── 가용시간 설정 ───
  daily_work_hours: {
    type: DataTypes.DECIMAL(4, 1),
    defaultValue: 8.0,
  },
  weekly_work_days: {
    type: DataTypes.INTEGER,
    defaultValue: 5,
  },
  participation_rate: {
    type: DataTypes.DECIMAL(3, 2),
    defaultValue: 1.00,
  },
  // 운영 #50 — 이번 주 휴일 일수 (가용시간 = daily × (days - holidays) × rate). 페이지 이탈 후에도 유지.
  weekly_holidays: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  invited_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'users', key: 'id' }
  },
  joined_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // ─── Q Bill (Phase 0) — 단가·급여 (민감정보, owner 만 조회/편집) ───
  // 본인 단가 조회는 허용. 동료 단가는 owner 만.
  hourly_rate: { type: DataTypes.DECIMAL(10, 2), allowNull: true, comment: '시간당 단가 (청구/수익성 계산용)' },
  monthly_salary: { type: DataTypes.DECIMAL(12, 2), allowNull: true, comment: '월급 (내부 원가 계산용)' },
  // ─── Q Note 답변 생성용 프로필 (워크스페이스 단위) ───
  // 워크스페이스마다 다른 역할/전문성을 가질 수 있어 BusinessMember 단위로 저장.
  // null 이면 User 의 같은 필드 fallback.
  bio: { type: DataTypes.TEXT, allowNull: true },
  expertise: { type: DataTypes.STRING(500), allowNull: true },
  organization: { type: DataTypes.STRING(200), allowNull: true },
  job_title: { type: DataTypes.STRING(100), allowNull: true },
  expertise_level: { type: DataTypes.STRING(20), allowNull: true, comment: 'novice/beginner/intermediate/advanced/expert (5단계)' },
  language_levels: { type: DataTypes.JSON, allowNull: true },
  answer_style_default: { type: DataTypes.STRING(2000), allowNull: true },
  answer_length_default: { type: DataTypes.STRING(20), allowNull: true, defaultValue: 'medium' }
}, {
  sequelize,
  tableName: 'business_members',
  timestamps: true,
  underscored: true,
  // 기본 스코프: 제거된 멤버는 권한 체크/조회에서 자동 제외
  // 제거된 멤버도 조회해야 하면 BusinessMember.unscoped() 사용
  defaultScope: {
    where: { removed_at: null }
  },
  indexes: [
    { unique: true, fields: ['business_id', 'user_id'] },
    { unique: true, fields: ['invite_token'], name: 'business_members_invite_token_unique' },
  ]
});

module.exports = BusinessMember;
