// ReportShare — 통합보고서 외부 공유 링크 (D3 #64 후속).
//   통합보고서는 동적 롤업이라 token → {기간} 매핑을 저장. 공개 read-only 조회 시 롤업 재계산.
//   owner/admin 발급. 같은 biz+period+dim 은 토큰 재사용(멱등). 30일 미사용 cleanup 대상(share_token 정책).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class ReportShare extends Model {}

ReportShare.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: {
    type: DataTypes.INTEGER, allowNull: false,
    references: { model: 'businesses', key: 'id' },
  },
  token: { type: DataTypes.STRING(64), allowNull: false, unique: true },
  period_type: { type: DataTypes.ENUM('weekly', 'monthly'), allowNull: false },
  period_start: { type: DataTypes.STRING(10), allowNull: false }, // YYYY-MM-DD
  dim: { type: DataTypes.ENUM('project', 'member'), allowNull: false, defaultValue: 'project' },
  created_by: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
  last_viewed_at: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize,
  tableName: 'report_shares',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['business_id'] },
    { unique: true, fields: ['business_id', 'period_type', 'period_start', 'dim'] },
  ],
});

module.exports = ReportShare;
