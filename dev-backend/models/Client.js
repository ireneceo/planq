const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Client extends Model {}

Client.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  business_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'businesses', key: 'id' }
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: true, // 초대 pending 단계에서는 아직 user 매칭 전이라 null 허용
    references: { model: 'users', key: 'id' }
  },
  invite_token: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  invite_email: {
    type: DataTypes.STRING(200),
    allowNull: true,
  },
  // (#259 guest_user_id 는 2026-09-02 제거 — 그림자 User 는 이제 guest_links 에 링크당 1개.
  //  운영 전부 NULL 이었다. 운영 ALTER: `ALTER TABLE clients DROP COLUMN guest_user_id;`)
  accepted_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  display_name: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  // 워크스페이스별 다국어 표시명 — 예: { ko: "김고객", en: "Kim" }. null 이면 User.name_localized fallback.
  display_name_localized: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: null,
  },
  company_name: {
    type: DataTypes.STRING(200),
    allowNull: true
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  invited_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'users', key: 'id' }
  },
  invited_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // 운영 #52 — 재발송 횟수 (초대 메일 재발송 시 +1, invited_at 은 최근 발송시각). 0 = 최초 1회만.
  reinvite_count: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  joined_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  status: {
    // ★ 'prospect'(Q sale 문의 고객 — 계정 없음 + 초대 안 함) 는 **끝에 append** 한다(순번 저장).
    //   값 순서를 바꾸면 sync(alter) 가 거부 없이 테이블을 복사한다(Fable 2026-09-11 실측).
    //   NULL 허용은 운영 DDL 그대로 둔다. 운영 적용: scripts/migrate-qsale.js
    type: DataTypes.ENUM('invited', 'active', 'archived', 'prospect'),
    defaultValue: 'invited'
  },
  // ─── Q sale 영업 축 (docs/Q_SALE_DESIGN.md §3.1) ───
  //   status 는 계정·관계 축, sales_stage 는 영업 축이다. 한 컬럼에 섞으면 "초대는 됐는데 협상 중" 을 못 쓴다.
  //   ★ sales_stage 를 직접 update 하지 않는다 — services/salesStage.js setStage 한 곳(이력·broadcast·감사).
  sales_stage: {
    type: DataTypes.ENUM('none', 'inquiry', 'consulting', 'proposal', 'negotiation', 'won', 'lost'),
    allowNull: false,
    defaultValue: 'none',
  },
  sales_stage_changed_at: { type: DataTypes.DATE, allowNull: true },
  sales_source: {
    type: DataTypes.ENUM('guest_link', 'email', 'phone', 'referral', 'web', 'event', 'manual', 'other'),
    allowNull: true,
  },
  lost_reason: {
    type: DataTypes.ENUM('price', 'timing', 'competitor', 'no_response', 'fit', 'other'),
    allowNull: true,
  },
  lost_note: { type: DataTypes.STRING(500), allowNull: true },
  // 상담 전화. billing_contact_phone(세금계산서 담당)과 다르다
  phone: { type: DataTypes.STRING(40), allowNull: true },
  // 예상 규모 — 재무 아님. 표시·집계 전용이고 AI·Cue 가 채우거나 읽지 않는다
  expected_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
  expected_currency: { type: DataTypes.STRING(3), allowNull: true },
  // ★ 파생 컬럼(정렬·정체 표시 전용). 원천은 타임라인이다 — 원본으로 쓰지 않는다
  last_touch_at: { type: DataTypes.DATE, allowNull: true },
  // ─── Cue 자동 히스토리 요약 ───
  summary: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  summary_updated_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  summary_manual: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  // ─── 기본 담당 멤버 (사람) ───
  assigned_member_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'users', key: 'id' }
  },
  // ─── Q Bill (Phase 0) — 국가·사업자 정보 · 세금계산서 · 청구 연락처 ───
  // ISO 2-letter country code. 기본 KR. 포트원 채널 자동 분기에 사용.
  country: { type: DataTypes.STRING(2), allowNull: true, defaultValue: 'KR' },
  // 사업자 여부 — true: 국내 법인/개인사업자 (세금계산서 대상), false: 개인 (현금영수증)
  is_business: { type: DataTypes.BOOLEAN, defaultValue: false },
  // D2 #66 — 외부 파트너 유형. customer(고객)/vendor(협력사)/freelancer(프리랜서)/other(기타).
  kind: { type: DataTypes.ENUM('customer', 'vendor', 'freelancer', 'other'), allowNull: false, defaultValue: 'customer' },
  biz_name: { type: DataTypes.STRING(200), allowNull: true, comment: '사업자등록증상 상호' },
  biz_ceo: { type: DataTypes.STRING(100), allowNull: true, comment: '대표자' },
  biz_tax_id: { type: DataTypes.STRING(20), allowNull: true, comment: '사업자등록번호' },
  biz_type: { type: DataTypes.STRING(100), allowNull: true, comment: '업태' },
  biz_item: { type: DataTypes.STRING(100), allowNull: true, comment: '종목' },
  biz_address: { type: DataTypes.STRING(500), allowNull: true },
  biz_address_en: { type: DataTypes.STRING(500), allowNull: true, comment: '해외 고객 영문 주소' },
  tax_invoice_email: { type: DataTypes.STRING(200), allowNull: true, comment: '세금계산서 수취 이메일' },
  billing_contact_name: { type: DataTypes.STRING(100), allowNull: true },
  billing_contact_email: { type: DataTypes.STRING(200), allowNull: true },
  billing_contact_phone: { type: DataTypes.STRING(40), allowNull: true, comment: '세금계산서 담당자 연락처' },
  email_aliases: { type: DataTypes.JSON, allowNull: true, comment: '추가 이메일 별칭 배열 — 메일 수신 시 client 자동 매칭용' }
}, {
  sequelize,
  tableName: 'clients',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['business_id', 'user_id'] },
    { unique: true, fields: ['invite_token'], name: 'clients_invite_token_unique' },
    { fields: ['business_id', 'sales_stage'], name: 'clients_biz_stage' },
    { fields: ['business_id', 'last_touch_at'], name: 'clients_biz_touch' },
  ]
});

module.exports = Client;
