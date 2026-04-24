const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Project extends Model {}

Project.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  name: { type: DataTypes.STRING(200), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  client_company: { type: DataTypes.STRING(200), allowNull: true },
  status: {
    type: DataTypes.ENUM('active', 'paused', 'closed'),
    defaultValue: 'active',
  },
  start_date: { type: DataTypes.DATEONLY, allowNull: true },
  end_date: { type: DataTypes.DATEONLY, allowNull: true },
  default_assignee_user_id: { type: DataTypes.INTEGER, allowNull: true },
  owner_user_id: { type: DataTypes.INTEGER, allowNull: false },
  // 타임라인/일정 보기 구분용 프로젝트 색상 (hex) — 프리셋 10색 중 하나 기본
  color: { type: DataTypes.STRING(20), allowNull: true },
  // 프로젝트 타입: fixed(기간 고정) / ongoing(구독·지속)
  project_type: { type: DataTypes.ENUM('fixed', 'ongoing'), allowNull: false, defaultValue: 'fixed' },
  // 프로세스 파트 탭 커스텀 라벨 (프로젝트별) — 기본 '테이블'
  process_tab_label: { type: DataTypes.STRING(80), allowNull: false, defaultValue: '테이블' },
  // 외부 클라우드 폴더 매핑 (Phase 2B+) — 연동 시 루트 폴더 아래 자동 생성
  gdrive_folder_id: { type: DataTypes.STRING(255), allowNull: true },
  // ─── Q Bill (Phase 0) — 계약/청구 ───
  contract_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: true, comment: '총 계약금' },
  billing_type: {
    type: DataTypes.ENUM('fixed', 'hourly', 'subscription', 'milestone', 'internal'),
    defaultValue: 'fixed',
    comment: 'fixed=고정가, hourly=시간단가, subscription=월정액, milestone=마일스톤, internal=내부 프로젝트(비청구)',
  },
  monthly_fee: { type: DataTypes.DECIMAL(12, 2), allowNull: true, comment: 'subscription 전용' },
}, {
  sequelize,
  tableName: 'projects',
  timestamps: true,
  underscored: true,
});

module.exports = Project;
