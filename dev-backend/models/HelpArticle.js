const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

// Q위키 article — PlanQ 제품 사용법 문서 (정적·플랫폼 공통).
// body 는 블록 배열 JSON (heading/text/step/image/callout). image 블록은 file_id 참조(File 재사용).
// 본문 임베딩은 kb_chunks 재사용(source_type='wiki', source_id=article.id) — 새 테이블 안 만듦.
// 스크린샷은 File 테이블 재사용 — 별도 매핑 테이블 없음.
class HelpArticle extends Model {}

HelpArticle.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  // /wiki/a/:slug
  slug: {
    type: DataTypes.STRING(80),
    allowNull: false,
    unique: true,
  },
  category_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'help_categories', key: 'id' },
  },
  title_ko: {
    type: DataTypes.STRING(160),
    allowNull: false,
  },
  title_en: {
    type: DataTypes.STRING(160),
    allowNull: false,
  },
  // 카드·검색결과 노출
  summary_ko: {
    type: DataTypes.STRING(400),
    allowNull: true,
  },
  summary_en: {
    type: DataTypes.STRING(400),
    allowNull: true,
  },
  // 블록 배열 [{ type:'heading'|'text'|'step'|'image'|'callout', ... }]
  // image 블록: { type:'image', file_id, caption_ko, caption_en }
  body_ko: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: null,
  },
  body_en: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: null,
  },
  // public=게스트·랜딩 노출 / authenticated=로그인 사용자만
  visibility: {
    type: DataTypes.ENUM('public', 'authenticated'),
    allowNull: false,
    defaultValue: 'authenticated',
  },
  // "이 화면 열기" + 드로어 맥락 매칭 (예: '/qtask', '/qbill')
  linked_route: {
    type: DataTypes.STRING(120),
    allowNull: true,
  },
  // 소요 시간 (분)
  est_minutes: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  sort_order: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  is_published: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  view_count: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  // KNOWLEDGE_LOOP 축3 — 랜딩 블로그 발행 (public + published 글만 허용)
  blog_published_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'NULL = 블로그 미발행. 발행 시점 = 블로그 표기 날짜',
  },
  blog_category: {
    type: DataTypes.STRING(40),
    allowNull: true,
    comment: '랜딩 블로그 카테고리 (guide-video/brand-video/how-to/insights/cases)',
  },
  // KNOWLEDGE_LOOP 축2 — 자동 클러스터 제안 초안 구분
  origin: {
    type: DataTypes.ENUM('manual', 'auto_cluster'),
    allowNull: false,
    defaultValue: 'manual',
  },
  origin_meta: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: '자동 제안 근거 — 질문 샘플·건수·log_ids',
  },
}, {
  sequelize,
  tableName: 'help_articles',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['slug'], name: 'help_articles_slug_unique' },
    { fields: ['category_id'] },
    { fields: ['visibility', 'is_published'], name: 'help_articles_vis_pub' },
    { fields: ['linked_route'] },
  ],
});

module.exports = HelpArticle;
