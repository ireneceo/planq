// 사용자 → PlanQ 운영팀 피드백 (사이클 P6).
// 우측 하단 floating 위젯에서 제출. platform_admin 이 /admin/feedback 에서 관리.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class FeedbackItem extends Model {}

FeedbackItem.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  // 사용자/워크스페이스 컨텍스트
  user_id: {
    type: DataTypes.INTEGER, allowNull: false,
    references: { model: 'users', key: 'id' },
  },
  business_id: {
    type: DataTypes.INTEGER, allowNull: true,
    references: { model: 'businesses', key: 'id' },
  },
  // #70 — 추가 문의(스레드). 답변 받은 원 피드백에 꼬리 질문을 달면 그 부모를 가리키는 자식 row.
  // null = 최상위(원 피드백). 1단계만 허용(자식의 자식 금지 — 모든 추가문의는 root 에 붙음).
  parent_id: {
    type: DataTypes.INTEGER, allowNull: true,
    references: { model: 'feedback_items', key: 'id' },
  },
  // 분류 (사용자 선택)
  // 문의(질문·도움 요청)와 피드백(버그·개선·기능 요청)을 가르는 축 — 2026-09-21.
  //   Irene: *"문의인지 피드백인지 관리되게 해. 알아보기 쉽게."* 분류(category)와 다른 축이라 컬럼을 따로 둔다.
  //   기존 행은 전부 feedback(기본값). 추가 문의(parent_id)는 부모의 kind 를 물려받는다.
  kind: {
    type: DataTypes.ENUM('feedback', 'inquiry'),
    allowNull: false,
    defaultValue: 'feedback',
  },
  category: {
    type: DataTypes.ENUM('bug', 'improve', 'feature', 'other'),
    allowNull: false,
    defaultValue: 'other',
  },
  // 우선순위 — 사용자가 "긴급" 체크 시 high
  priority: {
    type: DataTypes.ENUM('normal', 'high'),
    allowNull: false,
    defaultValue: 'normal',
  },
  // 본문
  title: { type: DataTypes.STRING(200), allowNull: false },
  body: { type: DataTypes.TEXT, allowNull: false },
  // 스크린샷 / 첨부 (간단 — 파일 path 배열)
  attachments: {
    type: DataTypes.JSON, allowNull: true, defaultValue: null,
  },
  // 자동 수집 메타
  page_url: { type: DataTypes.STRING(500), allowNull: true },
  // ★ 무엇이 어디서 잘못됐는지 — 사용자가 다시 설명하지 않아도 되게 화면이 실어 보낸다.
  //   client_env(브라우저·기기)와 성격이 다르다: 이것은 **그 순간의 사건**이다.
  //   { area, action, code, message, entity_type, entity_id, extra } 형태.
  //   ★ 여기에 사용자 데이터 본문을 담지 않는다 — 오류 식별에 필요한 것만.
  error_context: { type: DataTypes.JSON, allowNull: true, defaultValue: null },
  user_agent: { type: DataTypes.STRING(500), allowNull: true },
  // #162 — 디바이스·앱 환경(vw/vh/dpr/lang/platform/standalone 등) + 팝아웃 여부. 트리아지 정확도.
  client_env: { type: DataTypes.JSON, allowNull: true, defaultValue: null },
  is_popout: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  // 처리 상태 — 전이는 services/feedbackStatus 한 곳(접수 → 검토중 → 진행대기 → 반영중 → 완료/보류).
  //   queued·in_progress 는 2026-10-22 끝에 append(scripts/migrate-feedback-approval.js) — 순서 = DB 순서.
  status: {
    type: DataTypes.ENUM('pending', 'reviewing', 'done', 'wontfix', 'queued', 'in_progress'),
    allowNull: false,
    defaultValue: 'pending',
  },
  admin_response: { type: DataTypes.TEXT, allowNull: true },
  // 처리한 platform_admin
  responded_by: {
    type: DataTypes.INTEGER, allowNull: true,
    references: { model: 'users', key: 'id' },
  },
  responded_at: { type: DataTypes.DATE, allowNull: true },
  // 플랫폼관리자 승인(진행대기로 올림) — «승인됨» 의 정본은 approved_at IS NOT NULL (services/feedbackStatus).
  //   승인을 거두면(진행대기→검토중, 다시 열기) 비운다. 사용자 응답(/mine)에는 싣지 않는다.
  approved_by: {
    type: DataTypes.INTEGER, allowNull: true,
    references: { model: 'users', key: 'id' },
  },
  approved_at: { type: DataTypes.DATE, allowNull: true },
  // 보고자가 답을 읽은 시각 (2026-10-15). 답(admin_response)이 있는데 NULL 이면 «확인필요» 에 뜬다
  //   (routes/dashboard.collectFeedbackReplies). 답할 때 NULL 로 되돌리고(services/feedbackRespond),
  //   보고자가 /me/feedback 에서 그 스레드를 열면 찍는다(POST /api/feedback/:id/seen).
  //   운영: scripts/migrate-feedback-reply-seen.js(멱등 · 옛 답변은 읽은 것으로 백필) — 코드보다 먼저.
  reply_seen_at: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize,
  tableName: 'feedback_items',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['status'] },
    { fields: ['user_id'] },
    { fields: ['business_id'] },
    { fields: ['category', 'status'] },
    { fields: ['parent_id'] },
  ],
});

module.exports = FeedbackItem;
