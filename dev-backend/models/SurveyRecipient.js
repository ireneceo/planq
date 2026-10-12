// 설문 회차의 받는 사람 1명 = 1줄. 설계 docs/SURVEY_V2_DESIGN.md §3.3
//   token = 개인 열쇠(응답 1회). ★ 어느 목록·상세 응답에도 싣지 않는다 — 전역 toJSON 이 내린다(models/index.js).
//   회수 = token NULL(받는 사람 줄은 남는다 — «그때 누구에게» 기록).
//   email·display_name 은 보낸 시점 스냅샷(고객 정보가 바뀌어도 기록이 남는다).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class SurveyRecipient extends Model {}

SurveyRecipient.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  issue_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'survey_issues', key: 'id' } },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  client_id: { type: DataTypes.INTEGER, allowNull: true },
  email: { type: DataTypes.STRING(254), allowNull: false },
  display_name: { type: DataTypes.STRING(100), allowNull: true },
  token: { type: DataTypes.STRING(64), allowNull: true, unique: true },
  status: { type: DataTypes.ENUM('queued', 'sent', 'failed', 'responded'), allowNull: false, defaultValue: 'queued' },
  sent_at: { type: DataTypes.DATE, allowNull: true },
  opened_at: { type: DataTypes.DATE, allowNull: true },
  responded_at: { type: DataTypes.DATE, allowNull: true },
  reminded_at: { type: DataTypes.DATE, allowNull: true },
  revoked_at: { type: DataTypes.DATE, allowNull: true },
  email_log_id: { type: DataTypes.INTEGER, allowNull: true },
}, {
  sequelize, tableName: 'survey_recipients', timestamps: true, underscored: true,
  indexes: [{ fields: ['issue_id'] }, { fields: ['client_id', 'created_at'] }, { fields: ['business_id', 'sent_at'] }],
});

// 개인 열쇠는 응답 직렬화에서 항상 뺀다 — 담당자가 쥐면 «고객인 척 응답» 이 된다(설계 §5.2).
//   전역 toJSON(models/index.js)은 «token» 이라는 흔한 이름을 모르므로 이 모델에서 내린다. 서버 안에서는 인스턴스 속성으로 읽는다.
SurveyRecipient.prototype.toJSON = function () {
  const obj = Model.prototype.toJSON.call(this);
  delete obj.token;
  return obj;
};

module.exports = SurveyRecipient;
