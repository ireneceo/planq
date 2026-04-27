const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Business extends Model {}

Business.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  // Legacy 호환 (brand_name 로 이전 중, 아직 일부 코드가 name 사용)
  name: {
    type: DataTypes.STRING(200),
    allowNull: true
  },
  slug: {
    type: DataTypes.STRING(200),
    allowNull: false,
    unique: true
  },
  logo_url: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  owner_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' }
  },
  // ─── 기본 언어 (가입 시 선택: ko/en) ───
  default_language: {
    type: DataTypes.STRING(2),
    allowNull: false,
    defaultValue: 'ko'
  },
  // ─── 브랜드 (사용자 표기 BI — 일상 UI·마케팅·대화 헤더) ───
  brand_name: {
    type: DataTypes.STRING(200),
    allowNull: true
  },
  brand_name_en: {
    type: DataTypes.STRING(200),
    allowNull: true
  },
  brand_tagline: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  brand_tagline_en: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  brand_logo_url: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  brand_color: {
    type: DataTypes.STRING(20),
    allowNull: true
  },
  // ─── 법인 정보 (공식 문서·청구서·계약서용) ───
  legal_name: {
    type: DataTypes.STRING(200),
    allowNull: true
  },
  legal_name_en: {
    type: DataTypes.STRING(200),
    allowNull: true
  },
  legal_entity_type: {
    type: DataTypes.ENUM('corporation', 'individual', 'llc', 'other'),
    allowNull: true
  },
  tax_id: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  representative: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  representative_en: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  address: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  address_en: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  phone: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  email: {
    type: DataTypes.STRING(200),
    allowNull: true
  },
  website: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  // ─── 타임존·근무시간 ───
  timezone: {
    type: DataTypes.STRING(50),
    allowNull: true,
    defaultValue: 'Asia/Seoul'
  },
  // 워크스페이스 참조 타임존 배열 (문자열 배열 JSON)
  reference_timezones: {
    type: DataTypes.JSON,
    allowNull: true
  },
  work_hours: {
    type: DataTypes.JSON,
    allowNull: true
  },
  // ─── 구독 ───
  plan: {
    type: DataTypes.ENUM('free', 'starter', 'basic', 'pro', 'enterprise'),
    defaultValue: 'free'
  },
  plan_expires_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // 체험 14일 종료 시각 (Starter 이상 체험 적용)
  trial_ends_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // 결제 실패 grace period (7일) 또는 다운그레이드 grace (30일 read-only) 종료 시각
  grace_ends_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // 다음 결제주기 말 적용 예정 다운그레이드 플랜
  scheduled_plan: {
    type: DataTypes.ENUM('free', 'starter', 'basic', 'pro', 'enterprise'),
    allowNull: true
  },
  subscription_status: {
    type: DataTypes.ENUM('active', 'past_due', 'canceled', 'trialing'),
    defaultValue: 'active'
  },
  // ─── Cue 설정 ───
  cue_mode: {
    type: DataTypes.ENUM('smart', 'auto', 'draft'),
    defaultValue: 'smart'
  },
  cue_user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'users', key: 'id' }
  },
  cue_paused: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  // ─── 스토리지 ───
  storage_used_bytes: {
    type: DataTypes.BIGINT,
    defaultValue: 0
  },
  storage_limit_bytes: {
    type: DataTypes.BIGINT,
    defaultValue: 1073741824 // 1GB
  },
  // ─── Q Bill (Phase 0) — 발행자 정보 · 은행 · PG · 세금계산서 ───
  biz_registration_img: { type: DataTypes.STRING(500), allowNull: true },
  bank_name: { type: DataTypes.STRING(100), allowNull: true },
  bank_account_name: { type: DataTypes.STRING(100), allowNull: true },
  bank_account_number: { type: DataTypes.STRING(50), allowNull: true },
  // 해외 송금용 — 외화 청구서 공개 결제 페이지에 자동 노출
  swift_code: { type: DataTypes.STRING(20), allowNull: true, comment: 'SWIFT/BIC 은행 식별 코드 (해외 송금)' },
  bank_name_en: { type: DataTypes.STRING(200), allowNull: true, comment: '영문 은행명 (해외 송금)' },
  bank_account_name_en: { type: DataTypes.STRING(200), allowNull: true, comment: '영문 예금주명 (해외 송금)' },

  // 메일 발송 설정 (Phase E2/E3) — 사용자에게 보낼 이메일의 발신 표시이름과 회신 주소
  mail_from_name: { type: DataTypes.STRING(100), allowNull: true, comment: '메일 발신 표시이름 (예: "워프로랩 청구팀")' },
  mail_reply_to: { type: DataTypes.STRING(200), allowNull: true, comment: '회신 주소 (Reply-To 헤더, 비우면 발신 주소 사용)' },
  tax_invoice_email: { type: DataTypes.STRING(200), allowNull: true },
  // 포트원 V2 — 암호화는 Phase 6 에서
  portone_store_id: { type: DataTypes.STRING(100), allowNull: true },
  portone_api_secret: { type: DataTypes.STRING(500), allowNull: true },
  portone_channel_domestic: { type: DataTypes.STRING(100), allowNull: true },
  portone_channel_overseas: { type: DataTypes.STRING(100), allowNull: true },
  portone_webhook_secret: { type: DataTypes.STRING(500), allowNull: true },
  // 팝빌 (세금계산서)
  popbill_link_id: { type: DataTypes.STRING(100), allowNull: true },
  popbill_secret_key: { type: DataTypes.STRING(500), allowNull: true },
  // 기본 부가세율 (국내 10%)
  default_vat_rate: { type: DataTypes.DECIMAL(4, 3), defaultValue: 0.100 },
  // 청구서 기본 결제 기한 (발행일 + N일)
  default_due_days: { type: DataTypes.INTEGER, defaultValue: 14, comment: '청구서 기본 결제 기한 (일)' },
  // 청구서 기본 통화
  default_currency: { type: DataTypes.STRING(3), defaultValue: 'KRW', comment: '청구서 기본 통화' },
  // ─── 권한 토글 (PERMISSION_MATRIX §4) ───
  // financial / schedule / client_info — 기본값 모두 "all" (열린 문화).
  // 값이 "pm" 이면 해당 카테고리 액션은 프로젝트 PM 또는 오너만.
  permissions: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: { financial: 'all', schedule: 'all', client_info: 'all' },
  }
}, {
  sequelize,
  tableName: 'businesses',
  timestamps: true,
  underscored: true
});

module.exports = Business;
