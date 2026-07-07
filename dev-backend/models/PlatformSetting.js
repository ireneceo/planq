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
  // ─── 사업자 정보 (전자상거래법 §10 표시의무 — 랜딩 푸터·PG 심사) ───
  // legal_entity = 상호(법인명). 아래는 등록번호·대표자·연락처·주소. 관리자 UI 에서 입력.
  biz_registration_no: { type: DataTypes.STRING(20), allowNull: true },   // 사업자등록번호
  mail_order_no: { type: DataTypes.STRING(60), allowNull: true },          // 통신판매업 신고번호 (있으면)
  representative_name: { type: DataTypes.STRING(80), allowNull: true },    // 대표자명
  company_phone: { type: DataTypes.STRING(40), allowNull: true },          // 유선(고객센터) 번호
  company_email: { type: DataTypes.STRING(200), allowNull: true },         // 전자상거래 표시용 이메일 (전송용 support_email 과 별개)
  company_address: { type: DataTypes.STRING(300), allowNull: true },       // 사업장 주소
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
  // ─── SEO / SNS 공유 메타 (사이클 N+23, 2026-05-18) ───
  // SNS 공유 시 썸네일/제목/설명. PublicPostPage 같은 페이지별 라우트는 자기 컨텐츠 (post.title/summary) 우선,
  // fallback 으로 platform_settings 의 seo_* 사용. og_image_url 은 1200x630 권장 (Open Graph 표준).
  seo_title: { type: DataTypes.STRING(255), allowNull: true },
  seo_description: { type: DataTypes.STRING(500), allowNull: true },
  seo_keywords: { type: DataTypes.STRING(500), allowNull: true },
  og_image_url: { type: DataTypes.STRING(500), allowNull: true },
  // 모바일 앱 다운로드 URL — /app 다운로드 페이지가 환경별로 노출. 앱 출시 시 관리자가 채움.
  //   iOS: App Store 또는 TestFlight 초대 링크 / Android: Play Store 또는 직접 APK URL.
  app_ios_url: { type: DataTypes.STRING(500), allowNull: true },
  app_android_url: { type: DataTypes.STRING(500), allowNull: true },
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
