// 메일 발신자 분류 규칙 (학습형) — LLM 0.
//
// 사용자가 운영하면서 클릭한 결과로 규칙이 쌓인다:
//   같은 발신자를 2번 "답변 완료" 하면 → no_reply 규칙 자동 생성
//   → 그 발신자의 기존 미처리 건 일괄 정리 + 앞으로는 애초에 "답변 필요" 로 안 들어옴
//   그 발신자에게 답장을 보내면 → 규칙 즉시 해제 (사람이 대응한다는 강한 신호가 우선)
//
// 원칙:
//   - 워크스페이스별 격리 (한 고객사가 배운 규칙이 다른 곳에 새지 않는다)
//   - 투명성 — 사용자가 규칙 목록·근거를 보고 지울 수 있어야 한다. 모르는 사이 메일이 사라지면 안 된다.
//   - 규칙은 원본 메일을 건드리지 않는다. 삭제 = 즉시 원상복구.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class MailSenderRule extends Model {}

MailSenderRule.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false },

  // 주소 단위(person@corp.com) 또는 도메인 단위(corp.com)
  pattern: { type: DataTypes.STRING(255), allowNull: false },
  pattern_type: { type: DataTypes.ENUM('address', 'domain'), allowNull: false, defaultValue: 'address' },

  //   no_reply     — 답장 불필요 (자동 알림·영수증 등). "답변 필요" 에서 제외
  //   always_reply — 항상 답변 필요 (자동화 헤더가 붙어도 사람이 챙길 메일)
  //   marketing    — 마케팅으로 분류
  //   spam         — 스팸으로 분류
  verdict: { type: DataTypes.ENUM('no_reply', 'always_reply', 'marketing', 'spam'), allowNull: false },

  //   learned — 사용자의 반복 행동에서 자동 학습
  //   manual  — 설정 화면에서 직접 추가
  source: { type: DataTypes.ENUM('learned', 'manual'), allowNull: false, defaultValue: 'learned' },

  // 왜 이 규칙이 생겼는지 (투명성) — { signal: 'dismiss_x2', thread_ids: [...], subjects: [...], learned_at }
  evidence: { type: DataTypes.JSON, allowNull: true },

  hit_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  last_hit_at: { type: DataTypes.DATE, allowNull: true },

  created_by: { type: DataTypes.INTEGER, allowNull: true },   // 학습이면 그 행동을 한 사용자
}, {
  sequelize,
  modelName: 'MailSenderRule',
  tableName: 'mail_sender_rules',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['business_id', 'pattern'], name: 'mail_sender_rules_unique' },
    { fields: ['business_id', 'verdict'], name: 'mail_sender_rules_verdict' },
  ],
});

module.exports = MailSenderRule;
