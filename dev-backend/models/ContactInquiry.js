const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

// 플랫폼 문의 — Enterprise 문의·랜딩 "문의하기"·일반 고객 문의 통합.
// platform_admin 이 관리자 대시보드에서 확인/답변.
class ContactInquiry extends Model {}
// 종류 목록 정본 — 라우트의 «받는 종류» 도 여기서 고른다(두 벌이 되면 한쪽만 늘어난다).
ContactInquiry.KINDS = ['enterprise', 'general', 'landing', 'diagnosis', 'onboarding_call'];

ContactInquiry.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  kind: {
    // diagnosis — #426 자가진단에서 이메일을 남긴 잠재고객(끝에 append)
    // onboarding_call — 화상 업무설계·사용안내 신청(2026-10-22, docs/ONBOARDING_CALL_DESIGN.md · scripts/migrate-onboarding-call.js)
    type: DataTypes.ENUM(...ContactInquiry.KINDS),
    allowNull: false,
    defaultValue: 'general',
  },
  source: { type: DataTypes.STRING(50), allowNull: true, comment: 'plan_page · landing_home 등' },
  // 인증된 사용자/워크스페이스 있을 때 연결
  business_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'businesses', key: 'id' } },
  from_user_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
  // unauthenticated 도 접수 가능하도록 name/email 직접 받음
  from_name: { type: DataTypes.STRING(100), allowNull: false },
  from_email: { type: DataTypes.STRING(200), allowNull: false },
  from_company: { type: DataTypes.STRING(200), allowNull: true },
  from_phone: { type: DataTypes.STRING(50), allowNull: true },
  message: { type: DataTypes.TEXT, allowNull: false },
  // 문의자 워크스페이스 timezone — admin 페이지에서 양쪽 시간 동시 표시.
  // 로그인 사용자는 활성 워크스페이스의 Business.timezone. 비로그인 화상 안내 신청은 브라우저 시간대(검사한 IANA 이름), 그 외 게스트는 null.
  from_user_timezone: { type: DataTypes.STRING(64), allowNull: true },
  // 문의자 언어(ko/en) — 접수 확인 메일과 답변을 그 언어로 보내기 위한 것.
  //   여태 기록하지 않아 영어로 문의해도 한국어 안내가 나갔다(2026-08-25).
  locale: { type: DataTypes.STRING(8), allowNull: true },
  // 화상 안내 신청(onboarding_call)만 — 희망 시간·인원·도구·하고 싶은 일 + 신청 당시 plan·trial_ends_at 박제.
  //   정규화는 services/onboardingCall.normalizeDetails 한 곳(아는 키만). 다른 종류는 null.
  details: { type: DataTypes.JSON, allowNull: true },
  status: {
    type: DataTypes.ENUM('new', 'in_progress', 'resolved', 'spam'),
    defaultValue: 'new',
  },
  replied_at: { type: DataTypes.DATE, allowNull: true },
  replied_by_user_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
  reply_note: { type: DataTypes.TEXT, allowNull: true },
}, {
  sequelize,
  tableName: 'contact_inquiries',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['status', 'created_at'] },
    { fields: ['kind', 'status'] },
    { name: 'contact_inquiries_business_kind_status', fields: ['business_id', 'kind', 'status'] },
  ],
});

module.exports = ContactInquiry;
