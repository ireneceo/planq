// Post — 포스팅 기반 문서 (매뉴얼/가이드/공지/회사소개 등)
// project_id NULL = 워크스페이스 전역 문서, NOT NULL = 프로젝트 소속
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Post extends Model {}

Post.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  project_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: 'projects', key: 'id' } },
  conversation_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'conversations', key: 'id' } },
  title: { type: DataTypes.STRING(200), allowNull: false },
  content_json: { type: DataTypes.TEXT('long'), allowNull: true },       // Tiptap JSON
  content_text: { type: DataTypes.TEXT('long'), allowNull: true },       // 검색/프리뷰용 plain text
  category: { type: DataTypes.STRING(40), allowNull: true },             // 자유 분류 라벨
  author_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
  editor_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
  status: { type: DataTypes.ENUM('draft', 'published'), allowNull: false, defaultValue: 'published' },
  visibility: { type: DataTypes.ENUM('internal', 'public'), allowNull: false, defaultValue: 'internal' },
  is_pinned: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  view_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  share_token: { type: DataTypes.STRING(64), allowNull: true },
  shared_at: { type: DataTypes.DATE, allowNull: true },
  // N+43 — share_token 만료. NULL = 무제한 (legacy). 만료된 token 은 공개 endpoint 가 410 응답 + 친절한 만료 페이지.
  // 철회 (revoke) 는 share_token = NULL 로 통일 (File 패턴, 별도 컬럼 불필요).
  share_expires_at: { type: DataTypes.DATE, allowNull: true },
  // 자료정리(Brief) 메타 — category='brief' 인 post 의 source 자료, 시점·파일 보기 토글, 추천 후속 문서 종류
  // 일반 post 는 null
  brief_meta: { type: DataTypes.JSON, allowNull: true },
  // 자료정리에서 파생된 후속 문서 → parent post id (양방향 링크). 자료정리 post 자체는 null
  parent_post_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'posts', key: 'id' } },
  // Q docs 통합 — 문서 종류:
  //   doc      = Tiptap 본문 (기존)
  //   table    = 표 (q_record_id 연결, QRecord 그리드를 본문으로 표시)
  //   brief    = AI 자료정리 (brief_meta 사용)
  //   template = 템플릿 (워크스페이스 공유용)
  kind: { type: DataTypes.ENUM('doc', 'table', 'brief', 'template'), allowNull: false, defaultValue: 'doc' },
  // kind='table' 일 때 연결된 QRecord. 그 외 null.
  q_record_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'q_records', key: 'id' } },
  // 다른 post (문서/표) 연결 — 본문 하단 "관련 문서" 영역. 단방향 (양방향 표시는 향후).
  // [postId, postId, ...] 형식. 표시 시 join 으로 title/kind 같이 fetch.
  linked_post_ids: { type: DataTypes.JSON, allowNull: true },
  // ─── 4단계 Visibility (사이클 N+9, 2026-05-11) — VISIBILITY_VOCABULARY.md ───
  // 기존 visibility(internal/public) 와 별개 — 신규 vocabulary.
  // L1=개인(author 본인만), L2=팀(프로젝트 멤버), L3=워크스페이스, L4=외부(share_token)
  // NULL = legacy. 마이그레이션 후 모든 row 에 값 있음.
  vlevel: {
    type: DataTypes.ENUM('L1', 'L2', 'L3', 'L4'),
    allowNull: true,
    defaultValue: null,
  },
}, {
  sequelize, tableName: 'posts', timestamps: true, underscored: true,
  indexes: [
    { fields: ['business_id', 'project_id', 'created_at'] },
    { fields: ['business_id', 'is_pinned'] },
    { fields: ['business_id', 'conversation_id'] },
    { unique: true, fields: ['share_token'], name: 'posts_share_token_unique' },
    { fields: ['business_id', 'kind'] },
    { fields: ['q_record_id'] },
    { fields: ['business_id', 'vlevel', 'author_id'] },
  ]
});

module.exports = Post;
