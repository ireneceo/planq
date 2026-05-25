const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

// Q Talk 대화 자료 문서 (Cue 답변 소스)
// 사용자 표기: "대화 자료" / 내부 코드: kb_documents
class KbDocument extends Model {}

KbDocument.init({
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
  title: {
    type: DataTypes.STRING(300),
    allowNull: false
  },
  // source_type — 'manual'/'faq'/'policy'/'pricing'/'other' (직접 입력)
  // 'file' (워크스페이스 파일에서 import) / 'post' (Q docs 포스트에서 import)
  source_type: {
    type: DataTypes.ENUM('manual', 'faq', 'policy', 'pricing', 'other', 'file', 'post'),
    defaultValue: 'manual'
  },
  // import 출처 추적 (선택) — 사이클 O2
  source_file_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'files', key: 'id' },
  },
  source_post_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'posts', key: 'id' },
  },
  file_name: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  file_path: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  file_size: {
    type: DataTypes.BIGINT,
    allowNull: true
  },
  mime_type: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  // 원문 텍스트 추출 (간단한 문서는 file 없이 본문만)
  body: {
    type: DataTypes.TEXT('long'),
    allowNull: true
  },
  version: {
    type: DataTypes.INTEGER,
    defaultValue: 1
  },
  status: {
    type: DataTypes.ENUM('pending', 'indexing', 'ready', 'failed'),
    defaultValue: 'pending'
  },
  chunk_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  error_message: {
    type: DataTypes.STRING(1000),
    allowNull: true
  },
  uploaded_by: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' }
  },
  // 사이클 G — Q knowledge 카테고리·스코프
  // category: 지식 분류 (정책/매뉴얼/사고/FAQ/소개/가격) — 검색 필터·UI 탭 그룹
  category: {
    type: DataTypes.ENUM('policy', 'manual', 'incident', 'faq', 'about', 'pricing'),
    allowNull: false,
    defaultValue: 'manual',
  },
  // categories: 멀티 카테고리 (2026-05-04~) — read 시 categories 우선, 없으면 [category] fallback
  categories: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: null,
  },
  // scope: 적용 범위 — private(uploader 본인만, L1) / workspace 전체(L3) /
  //   특정 프로젝트(L2) / 특정 고객 한정(L2-client)
  // 사이클 N+9 (2026-05-11): 'private' 추가 — 개인 보관함 자산 (uploaded_by 본인만 접근)
  // hybridSearch 우선순위: client → project → workspace (threshold 0.78). private 는 검색 제외.
  scope: {
    type: DataTypes.ENUM('private', 'workspace', 'project', 'client'),
    allowNull: false,
    defaultValue: 'workspace',
  },
  project_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'projects', key: 'id' },
  },
  client_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'clients', key: 'id' },
  },
  // 사이클 P3 — LLM 자동 추출 키워드 (5~8개). 리스트 칩 + 클릭 필터.
  tags: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: null,
  },
  // 사이클 P3 — 단일 KbDocument 에 묶인 첨부 파일/문서 IDs (다중 가능).
  // 인덱싱 시 본문 + 첨부 텍스트 통합. 매뉴얼/가이드 1 entry = 다중 첨부.
  attached_file_ids: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: null,
  },
  attached_post_ids: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: null,
  },
  // Q info — 사용자 정의 항목 스키마. 자료별 자유 정의.
  // [{ id: 'c1', name: '항목명', type: 'text|...', show_in_list: bool, options?: [] }]
  custom_columns: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: null,
  },
  // 각 항목의 값. { col_id: value }
  custom_values: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: null,
  },
  // read 정책 — 'all' (스코프 안 멤버 모두) | 'owner' (owner+admin only)
  // 단가표·내부 계정 등 운영진만 보는 자료에 사용.
  read_policy: {
    type: DataTypes.ENUM('all', 'owner'),
    allowNull: false,
    defaultValue: 'all',
  },
  // scope='client' 일 때 다중 고객 지원. 단수 client_id 와 같이 존재 가능.
  // [client_id1, client_id2, ...]
  client_ids: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: null,
  },
  // ─── KB AI/CSV Ingest 사이클 (2026-05-05) — 다국어·자동 번역·visibility ───
  // 입력 원문 언어. 기존 row 는 'ko' fallback.
  source_language: {
    type: DataTypes.ENUM('ko', 'en'),
    allowNull: false,
    defaultValue: 'ko',
  },
  // 다른 언어로 자동 번역할지 (업로드 시 즉시 양쪽 언어 생성). 기본 true.
  auto_translate: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  // 번역 안 할 때 (auto_translate=false) 다른 언어 사용자에게 어떻게 보여줄지
  //   translate     : 번역해서 노출 (auto_translate=true 와 동일 효과)
  //   show_original : 원문 그대로 노출 + "원문(언어)" 뱃지 + 검색에도 포함
  //   hide_other    : 다른 언어에서 안 보임 (검색 결과 제외)
  translation_visibility: {
    type: DataTypes.ENUM('translate', 'show_original', 'hide_other'),
    allowNull: false,
    defaultValue: 'translate',
  },
  // 번역본 캐시. { ko: { title, body }, en: { title, body } }
  // auto_translate=true 또는 visibility='translate' 일 때 채워짐.
  translations: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: null,
  },
  // 다중 포스트 분리 시 원본 그룹 식별. 같은 ingest 에서 분리된 N 포스트는 동일 parent_doc_id.
  parent_doc_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'kb_documents', key: 'id' },
  },
  // ─── 4단계 Visibility (사이클 N+64) — VISIBILITY_VOCABULARY.md 정합 ───
  // L1=개인(uploaded_by 본인만, scope='private') / L2=팀(특정 프로젝트 멤버 또는 특정 멤버) /
  // L3=워크스페이스 전체 / L4=외부(특정 고객 + share_token)
  // 옛 scope/read_policy 와 공존 — 라우트가 항상 vlevel 채움 (legacy row 는 마이그레이션 스크립트로 백필).
  // L2 의 두 분기:
  //   - project_id 있으면 L2-project
  //   - target_member_ids 있으면 L2-members (워크스페이스 안 특정 user 지정)
  vlevel: {
    type: DataTypes.ENUM('L1', 'L2', 'L3', 'L4'),
    allowNull: true,
    defaultValue: null,
  },
  // L2-members 분기 — 워크스페이스 안 특정 user 만 접근 (운영진만 같은 케이스도 여기로).
  // [user_id1, user_id2, ...] 형식.
  target_member_ids: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: null,
  },
  // 공유 링크 (사이클 N+4 — 통합 공유 시스템)
  share_token: { type: DataTypes.STRING(64), allowNull: true },
  shared_at: { type: DataTypes.DATE, allowNull: true },
  share_password_hash: { type: DataTypes.STRING(255), allowNull: true },
  share_expires_at: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize,
  tableName: 'kb_documents',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['business_id', 'status'] },
    { fields: ['business_id', 'category'] },
    { fields: ['business_id', 'scope', 'project_id'] },
    { fields: ['business_id', 'scope', 'client_id'] },
    { fields: ['business_id', 'vlevel'], name: 'kb_documents_biz_vlevel' },
    { unique: true, fields: ['share_token'], name: 'kb_documents_share_token_unique' },
  ]
});

// N+64 — vlevel 자동 백필 hook. 라우트가 vlevel 명시하면 그대로, 안 하면 scope/read_policy 로 매핑.
// upload/import 같은 옛 라우트도 hook 덕분에 vlevel 항상 채워짐.
KbDocument.addHook('beforeSave', (doc) => {
  if (doc.vlevel) return;
  if (doc.scope === 'private') doc.vlevel = 'L1';
  else if (doc.scope === 'project') doc.vlevel = 'L2';
  else if (doc.scope === 'client') doc.vlevel = 'L4';
  else if (doc.scope === 'workspace' && doc.read_policy === 'owner') doc.vlevel = 'L2';
  else doc.vlevel = 'L3';
});

module.exports = KbDocument;
