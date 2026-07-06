const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Project extends Model {}

Project.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  name: { type: DataTypes.STRING(200), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  client_company: { type: DataTypes.STRING(200), allowNull: true },
  status: {
    type: DataTypes.ENUM('active', 'paused', 'closed'),
    defaultValue: 'active',
  },
  start_date: { type: DataTypes.DATEONLY, allowNull: true },
  end_date: { type: DataTypes.DATEONLY, allowNull: true },
  default_assignee_user_id: { type: DataTypes.INTEGER, allowNull: true },
  owner_user_id: { type: DataTypes.INTEGER, allowNull: false },
  // 타임라인/일정 보기 구분용 프로젝트 색상 (hex) — 프리셋 10색 중 하나 기본
  color: { type: DataTypes.STRING(20), allowNull: true },
  // 프로젝트 타입: fixed(기간 고정) / ongoing(구독·지속)
  project_type: { type: DataTypes.ENUM('fixed', 'ongoing'), allowNull: false, defaultValue: 'fixed' },
  // 내부 vs 고객 구분 (수익성 통계 분리 축) — client=고객 대응(매출 발생), internal=자체 투자(제품/마케팅/운영·비청구)
  //   billing_type='internal'(청구구조)과 별개 — kind 는 수익성 집계에서 고객/내부 세그먼트 분리에 사용.
  kind: { type: DataTypes.ENUM('client', 'internal'), allowNull: false, defaultValue: 'client', comment: 'client=고객 프로젝트(매출), internal=내부 투자(비청구·수익성 제외)' },
  // 프로세스 파트 탭 커스텀 라벨 (프로젝트별) — 기본 '테이블'
  process_tab_label: { type: DataTypes.STRING(80), allowNull: false, defaultValue: '테이블' },
  // 외부 클라우드 폴더 매핑 (Phase 2B+) — 연동 시 루트 폴더 아래 자동 생성
  gdrive_folder_id: { type: DataTypes.STRING(255), allowNull: true },
  // ─── Q Bill (Phase 0) — 계약/청구 ───
  contract_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: true, comment: '총 계약금' },
  billing_type: {
    type: DataTypes.ENUM('fixed', 'hourly', 'subscription', 'milestone', 'internal'),
    defaultValue: 'fixed',
    comment: 'fixed=고정가, hourly=시간단가, subscription=월정액, milestone=마일스톤, internal=내부 프로젝트(비청구)',
  },
  monthly_fee: { type: DataTypes.DECIMAL(12, 2), allowNull: true, comment: 'subscription 전용' },
  // ─── Q Bill 정기 청구 자동화 ───
  auto_invoice_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, comment: '정기 청구 자동 발행 ON/OFF' },
  auto_invoice_mode: {
    type: DataTypes.ENUM('auto', 'draft_review'),
    allowNull: false, defaultValue: 'draft_review',
    comment: 'auto=즉시 발행+이메일, draft_review=초안 생성+검토 알림',
  },
  invoice_billing_day: {
    type: DataTypes.TINYINT, allowNull: false, defaultValue: 1,
    comment: '매월 청구일 (1-28). 29-31 은 매월 말일로 처리',
  },
  last_auto_invoice_at: { type: DataTypes.DATE, allowNull: true, comment: '마지막 자동 청구 시각 (멱등성)' },
  paused_at: { type: DataTypes.DATE, allowNull: true, comment: '연체로 자동 정지된 시각' },
  // ─── D3 #65 프로젝트 캔버스 — 전략 프레임 (컨설팅 SCQA + 피라미드 원칙) ───
  strategy_context: { type: DataTypes.TEXT, allowNull: true, comment: '추진 배경 (Situation)' },
  strategy_key_question: { type: DataTypes.TEXT, allowNull: true, comment: '핵심 과제 (Key Question)' },
  strategy_goal: { type: DataTypes.TEXT, allowNull: true, comment: '목표 (Objective, 정성)' },
  strategy_governing_thought: { type: DataTypes.TEXT, allowNull: true, comment: '핵심 메시지 (Governing Thought, 한 문장)' },
  strategy_approach: { type: DataTypes.TEXT, allowNull: true, comment: '추진 방식 (Approach)' },
  // 성공 지표 (정량 KR) — [{ id, label, target, current, unit }]
  success_metrics: { type: DataTypes.JSON, allowNull: true, comment: '성공 지표 리스트 (구조화)' },
  // R1 — 일정 타임라인 "주요 업무만 보기" 기본값 (프로젝트별 설정)
  timeline_key_only: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, comment: '타임라인 주요 업무만 기본 표시' },
}, {
  sequelize,
  tableName: 'projects',
  timestamps: true,
  underscored: true,
});

module.exports = Project;
