// SignatureRequest — 문서 서명 요청 (이메일 OTP + 캔버스 + 명시 동의)
//
// entity_type: 'post' | 'document' (현재는 'post' 만 활성, document 는 legacy 유지)
// 한 entity 에 여러 row 가능 (양사 서명 = 2 row · 다자 서명 가능).
// 같은 (entity, signer_email) 의 pending 은 UNIQUE 제약 없이 코드에서 멱등 처리.
//
// 흐름:
//   pending  = 발송 전 (생성 직후 즉시 sent 로 전환 — 일관성 유지용)
//   sent     = 이메일 / 카드 발송 완료
//   viewed   = 서명자가 토큰 페이지 진입 (선택적 추적, viewed_at)
//   signed   = 서명 완료
//   rejected = 거절
//   expired  = 만료일 초과 (cron)
//   canceled = 요청자 취소
//
// 보안:
//   - token: crypto.randomBytes(32).toString('hex') 64자
//   - otp_code_hash: sha256(otp_code) 평문 저장 X
//   - otp_attempts: 5회 초과 시 lock (status 변경 X, 응답 차단)
//   - signature_image_b64: longtext, dataURL 형식
//   - signed_ip / signed_ua: audit
//   - 재서명 차단: signed_at 있으면 sign 라우트 차단
//
// 만료:
//   - expires_at: 발송 후 14일 (생성 시 설정)
//   - cron: 매일 00:30 status='sent'/'viewed' && expires_at < now → 'expired'

const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class SignatureRequest extends Model {}

SignatureRequest.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

  // 엔티티 참조
  entity_type: {
    type: DataTypes.ENUM('post', 'document'),
    allowNull: false,
  },
  entity_id: { type: DataTypes.INTEGER, allowNull: false },

  // 워크스페이스 격리
  business_id: {
    type: DataTypes.INTEGER, allowNull: false,
    references: { model: 'businesses', key: 'id' },
  },

  // 요청자 (워크스페이스 멤버)
  requester_user_id: {
    type: DataTypes.INTEGER, allowNull: false,
    references: { model: 'users', key: 'id' },
  },

  // 서명자 정보 (외부 — 이메일 기반)
  signer_email: { type: DataTypes.STRING(255), allowNull: false },
  signer_name: { type: DataTypes.STRING(100), allowNull: true },

  // 토큰 (URL)
  token: { type: DataTypes.STRING(64), allowNull: false, unique: true },

  // 이메일 OTP 본인 확인
  otp_code_hash: { type: DataTypes.STRING(64), allowNull: true },  // sha256
  otp_sent_at: { type: DataTypes.DATE, allowNull: true },
  otp_expires_at: { type: DataTypes.DATE, allowNull: true },        // sent + 5분
  otp_verified_at: { type: DataTypes.DATE, allowNull: true },
  otp_attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  otp_locked_until: { type: DataTypes.DATE, allowNull: true },      // 5회 실패 시 60분 lock

  // 서명 결과
  signature_image_b64: { type: DataTypes.TEXT('long'), allowNull: true }, // dataURL
  signed_at: { type: DataTypes.DATE, allowNull: true },
  signed_ip: { type: DataTypes.STRING(45), allowNull: true },             // IPv4/IPv6
  signed_ua: { type: DataTypes.STRING(500), allowNull: true },
  signed_consent: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

  // 거절
  rejected_at: { type: DataTypes.DATE, allowNull: true },
  rejected_reason: { type: DataTypes.STRING(500), allowNull: true },

  // 진행
  status: {
    type: DataTypes.ENUM('pending', 'sent', 'viewed', 'signed', 'rejected', 'expired', 'canceled'),
    allowNull: false, defaultValue: 'pending',
  },
  viewed_at: { type: DataTypes.DATE, allowNull: true },

  // 요청자 메모 (이메일에 포함)
  note: { type: DataTypes.STRING(1000), allowNull: true },

  // 만료
  expires_at: { type: DataTypes.DATE, allowNull: false },

  // 알림 (재발송 카운트)
  reminder_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  last_reminder_at: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize, tableName: 'signature_requests', timestamps: true, underscored: true,
  indexes: [
    { fields: ['token'], unique: true },
    { fields: ['entity_type', 'entity_id'] },
    { fields: ['business_id', 'status'] },
    { fields: ['status', 'expires_at'] },           // cron 만료 처리용
    { fields: ['signer_email'] },
  ],
});

module.exports = SignatureRequest;
