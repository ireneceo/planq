// 플랫폼(=PlanQ 자체) 운영 정보 — 단일 row 테이블 (id=1 고정).
// 메일 푸터·법적 표기·지원 메일·로고 같이 자주 안 변하지만 .env 직접 수정 대신 관리자 UI 에서.
// emailService 가 5분 캐시로 조회. 첫 row 가 없으면 .env 또는 hard-coded fallback.

const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class PlatformSetting extends Model {}

PlatformSetting.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  brand: {
    type: DataTypes.STRING(100),
    allowNull: false,
    defaultValue: 'PlanQ',
  },
  tagline: {
    type: DataTypes.STRING(300),
    allowNull: true,
  },
  website: {
    type: DataTypes.STRING(300),
    allowNull: true,
  },
  support_email: {
    type: DataTypes.STRING(200),
    allowNull: true,
  },
  legal_entity: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  email_logo_url: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
  // ─── 결제 설정 (이전: .env → DB+관리자 UI) ───
  // 자체 결제 (계좌이체) — 청구서·결제 안내 메일에 자동 노출
  bank_name: { type: DataTypes.STRING(100), allowNull: true },
  bank_account_number: { type: DataTypes.STRING(50), allowNull: true },
  bank_account_holder: { type: DataTypes.STRING(100), allowNull: true },
  // PortOne (2순위) — 채널키·스토어ID·웹훅시크릿. PortOne 비활성 시 빈 값 유지
  portone_store_id: { type: DataTypes.STRING(100), allowNull: true },
  portone_channel_key: { type: DataTypes.STRING(200), allowNull: true },
  portone_channel_key_billing: { type: DataTypes.STRING(200), allowNull: true },
  portone_webhook_secret: { type: DataTypes.STRING(200), allowNull: true },
  // 결제 정책
  default_vat_rate: { type: DataTypes.DECIMAL(4, 3), allowNull: false, defaultValue: 0.100 }, // 10%
  default_due_days: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 7 },
  // ─── 약관 현재 버전 (2026-05-05) — User 가 다른 버전 동의 시 재동의 모달 트리거 ───
  terms_version: { type: DataTypes.STRING(20), allowNull: false, defaultValue: '1.0' },
  privacy_version: { type: DataTypes.STRING(20), allowNull: false, defaultValue: '1.0' },
  // ─── 점검 모드 + 운영 공지 배너 (2026-05-05) ───
  // maintenance_mode=true 면 platform_admin 외 모든 요청 503. message 가 사용자에게 표시.
  maintenance_mode: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  maintenance_message: { type: DataTypes.STRING(500), allowNull: true },
  // 사이드바 상단 공지 배너 — 운영자 일괄 안내 (점검 일정·신규 기능·약관 변경 등)
  announcement_text: { type: DataTypes.STRING(500), allowNull: true },
  announcement_dismissible: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  announcement_severity: { type: DataTypes.ENUM('info', 'warn', 'critical'), allowNull: false, defaultValue: 'info' },
  updated_by_user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'users', key: 'id' },
  },
}, {
  sequelize,
  tableName: 'platform_settings',
  timestamps: true,
  underscored: true,
});

module.exports = PlatformSetting;
