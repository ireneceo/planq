// 랜딩 방문 — 날짜 × 페이지 × 유입 × 기기 별 **숫자만** (2026-09-21).
//   쿠키 없음 · IP·브라우저 정보 저장 없음. 순방문자는 LandingVisitor(하루 단위 해시)로 따로 센다.
//   워크스페이스(그룹웨어) 화면은 세지 않는다 — 랜딩 공개 페이지만(routes/landing_visits.js).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class LandingVisit extends Model {}

LandingVisit.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  visit_date: { type: DataTypes.DATEONLY, allowNull: false },
  path: { type: DataTypes.STRING(200), allowNull: false },
  // naver · google · daum · bing · direct · internal · other(그 밖의 도메인은 host 로)
  source: { type: DataTypes.STRING(80), allowNull: false, defaultValue: 'direct' },
  device: { type: DataTypes.ENUM('mobile', 'desktop'), allowNull: false, defaultValue: 'desktop' },
  views: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, {
  sequelize,
  tableName: 'landing_visits',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['visit_date', 'path', 'source', 'device'], name: 'uk_landing_visit' },
    { fields: ['visit_date'] },
  ],
});

module.exports = LandingVisit;
