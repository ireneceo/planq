// DiagnosisResponse — 무료 업무체계 자가진단 응답 (#426, 설계 docs/FREE_DIAGNOSIS_DESIGN.md).
//
//   이메일이 없으면 **개인정보가 없다** — 익명 응답(답·점수·업종·인원)만 쌓인다(케이스 통계용).
//   이메일을 남기고 동의하면 contact_inquiries(kind='diagnosis')에도 한 건 — 관리자 문의 인박스·알림이 그대로 동작한다.
//   쿠키·IP·UA 는 저장하지 않는다(랜딩 방문 집계와 같은 원칙).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class DiagnosisResponse extends Model {}

DiagnosisResponse.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  answers: { type: DataTypes.JSON, allowNull: false },          // { S1:0..2, … } — 서버가 검증한 12개
  scores: { type: DataTypes.JSON, allowNull: false },           // { structure:0..4, … } — 서버가 계산
  total: { type: DataTypes.INTEGER, allowNull: false },
  weakest: { type: DataTypes.STRING(20), allowNull: false },
  industry: { type: DataTypes.STRING(20), allowNull: true },
  team_size: { type: DataTypes.STRING(10), allowNull: true },
  lang: { type: DataTypes.STRING(5), allowNull: true },
  source: { type: DataTypes.STRING(100), allowNull: true },     // utm 등(검증된 짧은 문자열만)
  email: { type: DataTypes.STRING(200), allowNull: true },
  company: { type: DataTypes.STRING(200), allowNull: true },
  consent_at: { type: DataTypes.DATE, allowNull: true },
  inquiry_id: { type: DataTypes.INTEGER, allowNull: true },
  // 결과를 본 뒤 «메일로 받기» 를 같은 응답에 붙이는 일회용 키(sha256). 1시간 · 한 번. 다시 제출하면 응답이 두 번 세진다.
  claim_hash: { type: DataTypes.STRING(64), allowNull: true },
}, {
  sequelize, tableName: 'diagnosis_responses', timestamps: true, underscored: true,
  indexes: [{ fields: ['created_at'] }, { fields: ['email'] }],
});

module.exports = DiagnosisResponse;
