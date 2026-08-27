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

  // 운영 #239 — 서명 요청(sign) vs 확인 요청(confirm).
  //   확인은 "그냥 확인했다 / 의견 남기기" 로, 서명(OTP·캔버스·법적 무게)과 절차가 다르다.
  //   같은 테이블을 쓰는 이유: 토큰·만료·멱등 재발송·수신함·워크스페이스 격리가 90% 동일하다.
  //   ★ 옛 행은 DEFAULT 'sign' 으로 채워진다 — 기존 서명 플로우는 무변화.
  //   ★ 이 선언을 **되돌리지 마라.** Sequelize alter:true 는 모델에 없는 컬럼을 DROP 한다
  //     (롤백 정책: scripts/migrate-doc-external-confirm.js 헤더 참조).
  kind: {
    type: DataTypes.ENUM('sign', 'confirm'),
    allowNull: false, defaultValue: 'sign',
  },

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
  token: { type: DataTypes.STRING(64), allowNull: false },

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

  // #239 확인(confirm) 결과 — 서명과 달리 이미지·동의체크가 없다. 누가 언제 확인했고 뭐라 했는지만.
  confirmed_at: { type: DataTypes.DATE, allowNull: true },
  comment: { type: DataTypes.TEXT, allowNull: true },
  comment_at: { type: DataTypes.DATE, allowNull: true },

  // 진행
  status: {
    // #239 — 'confirmed','commented' 는 **끝에 append**. ENUM 은 내부적으로 순번 저장이라
    //   앞쪽 순서를 건드리면 기존 행의 의미가 통째로 뒤바뀐다.
    type: DataTypes.ENUM('pending', 'sent', 'viewed', 'signed', 'rejected', 'expired', 'canceled',
      'confirmed', 'commented'),
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

  // ── 서명 대상 동결 (2026-08-27) ────────────────────────────────
  // ★ 여태 이 표에는 "누가·언제·어디서 서명했다" 만 있고 **무엇에 서명했는지가 없었다.**
  //   서명 페이지는 열 때마다 문서의 *현재* 본문을 읽어 왔으므로, 서명 뒤에 본문을 고치면
  //   그 서명이 무엇에 붙은 것인지 증명할 수단이 사라진다(운영 실사용 직전 발견).
  //   → 요청 생성 시점에 대상(본문+첨부 목록)을 동결하고, 서명 완료 시점에 한 번 더 대조한다.
  //   본문은 전문을 남긴다(계약서는 재현이 곧 증거다). 첨부는 파일 자체가 아니라
  //   files.content_hash 로 지문만 남긴다 — 파일은 스토리지에 그대로 있고 중복 저장은 낭비다.
  title_snapshot: { type: DataTypes.STRING(255), allowNull: true },      // 동결된 제목(제목도 계약의 일부다)
  content_snapshot: { type: DataTypes.TEXT('long'), allowNull: true },   // 동결된 본문(content_json 직렬화)
  content_hash: { type: DataTypes.STRING(64), allowNull: true },          // 위 본문의 SHA-256
  attachments_snapshot: { type: DataTypes.JSON, allowNull: true },        // [{file_id,name,size,mime,content_hash}]
  snapshot_at: { type: DataTypes.DATE, allowNull: true },                 // 동결 시각(요청 생성 시점)
  // 서명 완료 시점에 대상이 그대로였는가 — 다르면 그 사실 자체를 증거로 남긴다(막지 않고 기록).
  signed_content_hash: { type: DataTypes.STRING(64), allowNull: true },
  snapshot_mismatch: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  // 서명자가 첨부를 실제로 열어봤는가 — [{file_id, at}] (열람 사실도 증거의 일부)
  attachments_viewed: { type: DataTypes.JSON, allowNull: true },
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
