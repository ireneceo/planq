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
    unique: true,
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
  invited_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'users', key: 'id' }
  },
  joined_at: {
    type: DataTypes.DATE,
    allowNull: true
  }
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
    { unique: true, fields: ['business_id', 'user_id'] }
  ]
});

module.exports = BusinessMember;
