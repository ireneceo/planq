// 랜딩 순방문자 — 하루 단위 **되돌릴 수 없는 해시**만 (2026-09-21, Plausible 방식).
//   hash = sha256(날마다 바뀌는 비밀 + IP + 브라우저) 앞 32자. 비밀은 저장하지 않으므로 다음 날이면
//   같은 사람도 다른 값이 되고, 값에서 IP 를 되찾을 수 없다. 400일 지나면 지운다(landing_visits 도 같이).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class LandingVisitor extends Model {}

LandingVisitor.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  visit_date: { type: DataTypes.DATEONLY, allowNull: false },
  visitor_hash: { type: DataTypes.CHAR(32), allowNull: false },
}, {
  sequelize,
  tableName: 'landing_visitors',
  timestamps: true,
  underscored: true,
  indexes: [{ unique: true, fields: ['visit_date', 'visitor_hash'], name: 'uk_landing_visitor' }],
});

module.exports = LandingVisitor;
