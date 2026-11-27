const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class File extends Model {}

File.init({
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
  project_id: {
    type: DataTypes.BIGINT,
    allowNull: true,
    references: { model: 'projects', key: 'id' }
  },
  folder_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'file_folders', key: 'id' }
  },
  client_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'clients', key: 'id' }
  },
  uploader_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' }
  },
  file_name: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  file_path: {
    type: DataTypes.STRING(500),
    allowNull: false
  },
  file_size: {
    type: DataTypes.BIGINT,
    allowNull: false
  },
  mime_type: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  description: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  // 검색용 태그 — 문자열 배열. 파일명만으로는 찾기 어려운 자료(영상·스캔본)를 위해 추가.
  tags: {
    type: DataTypes.JSON,
    allowNull: true
  },
  storage_provider: {
    type: DataTypes.ENUM('planq', 'gdrive', 's3'),
    allowNull: false,
    defaultValue: 'planq'
  },
  external_id: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  external_url: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  // GDrive 미러 (storage_provider 는 그대로 'planq' 유지 — 서빙은 로컬, Drive 엔 사본만).
  //   워크스페이스 파일 전체 Drive 가시성 목적. flip 아님 → 다운로드/이미지/ZIP 회귀 없음.
  gdrive_mirror_id: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  gdrive_mirror_url: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
  gdrive_mirrored_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  content_hash: {
    // ★ sha256 전용 (64자). Drive 가 주는 md5 를 여기 넣지 말 것 — drive_md5 가 그 자리다.
    //   2026-08-29 이전에는 gdriveApply 가 md5 를 넣어 오염된 행이 있었다(마이그레이션에서 이전).
    type: DataTypes.CHAR(64),
    allowNull: true
  },
  // Drive 가 준 체크섬 — 변경 감지 비교용. 우리 해시 축(content_hash)과 섞지 않는다.
  drive_md5: {
    type: DataTypes.STRING(32),
    allowNull: true
  },
  // Drive 사본이 PlanQ 와 다른데 반영하지 못한 이유 (2026-11-18 docs/GDRIVE_FINDER_EDIT_SYNC_DESIGN.md §4 B-5).
  //   값: edit_too_large · edit_quota · edit_ext · edit_download_failed(다시 시도) · edit_not_applied · trash_held.
  //   NULL = 문제 없음. 쓰는 곳은 services/gdriveApply 하나. 화면은 모르는 값도 값 그대로 보인다.
  drive_sync_issue: {
    type: DataTypes.STRING(40),
    allowNull: true
  },
  // 정본 축 — 변경의 진실이 어디에 있는가. NULL = PlanQ 가 정본.
  //   서빙 축(storage_provider)과 분리돼 있다. 판정은 services/fileOrigin.js 하나만 쓴다.
  origin_provider: {
    type: DataTypes.ENUM('gdrive'),
    allowNull: true
  },
  ref_count: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1
  },
  // 공유 링크 — 통합 공유 시스템 (Task/KbDocument/CalendarEvent 와 일관)
  // 사이클 N+61 — column-level unique 제거. indexes 배열 명시 (sync 누적 차단)
  share_token: {
    type: DataTypes.STRING(64),
    allowNull: true,
  },
  shared_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  share_password_hash: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  share_expires_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // legacy column — 기존 share-link 라우트 (line 534) 호환용 보관
  share_created_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // ─── 4단계 Visibility (사이클 N+9, 2026-05-11) — VISIBILITY_VOCABULARY.md ───
  // L1=개인(uploader 본인만), L2=팀(프로젝트 멤버), L3=워크스페이스, L4=외부(share_token)
  // NULL = legacy (백필 전. 이후엔 라우트가 항상 값 설정)
  visibility: {
    type: DataTypes.ENUM('L1', 'L2', 'L3', 'L4'),
    allowNull: true,
    defaultValue: null,
  },
  // D4 #62 — 보안등급 (visibility 와 직교 축). general=외부공유·드라이브 OK /
  //   internal=외부공유 차단 / confidential=외부공유·개인드라이브 차단 + export 관리자만.
  security_level: {
    type: DataTypes.ENUM('general', 'internal', 'confidential'),
    allowNull: false,
    defaultValue: 'general',
  },
  // N+74 — vlevel 신컬럼 (Post/KbDocument 와 정합). visibility 는 legacy 유지 + 동시 갱신.
  vlevel: {
    type: DataTypes.ENUM('L1', 'L2', 'L3', 'L4'),
    allowNull: true,
    defaultValue: 'L3',
  },
  // N+74 — L2-members 분기 (project_id 없이 명시 멤버 리스트)
  // «검색에서 숨김» — 제한 자료(L2)를 워크스페이스가 «잠금으로 보이기» 로 켜도 이 항목은 존재를 안 보인다(2026-11-25 · docs/FILE_SEARCH_DISCOVERY_DESIGN.md §2).
  //   올린 사람·작성자·대표·관리자가 공개 범위 창에서 켠다. 판정은 services/lockedDiscovery 한 곳.
  hide_existence: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  // 출처 열쇠 — 서버가 만든 사본이 «무엇에서 몇 번째로» 왔는지(2026-11-27 · 서명 완료 문서 «파일로 저장»).
  //   `signed-post:<post_id>:<회차 지문>` — 같은 회차를 다시 저장하면 새로 만들지 않는다(살아 있는 행 기준 · 유니크 아님:
  //   휴지통 행이 열쇠를 쥐면 다시 저장이 막힌다). 내부 열쇠 — 응답에 싣지 않는다. 판정 services/signedPdfSave 한 곳.
  source_key: {
    type: DataTypes.STRING(100),
    allowNull: true,
    defaultValue: null,
  },
  target_member_ids: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: null,
  },
  deleted_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // 휴지통에서 언제 영구 삭제되는가 (삭제 시점 플랜 기준으로 약속한 날짜).
  //   화면이 사용자에게 이 날짜를 보여준다 — 그러므로 나중에 플랜이 낮아져도 **앞당기지 않는다**
  //   (services/retentionPolicy.js effectiveExpiry 가 현재 플랜과 비교해 긴 쪽을 쓴다).
  //   NULL = 약속을 보여준 적 없음 → 현재 플랜 기간만 적용.
  purge_after: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // 휴지통 — 누가 지웠는가. 복구 화면에 "누가 언제" 를 보여주고, 감사에도 쓴다.
  //   옛 행은 NULL 이다(그때는 기록하지 않았다) — 표시할 때 '알 수 없음' 으로 낮춘다.
  deleted_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  // 어디서 지워졌나 (2026-11-18 §4 A-7) — NULL = PlanQ 에서 · 'gdrive' = Drive(파인더)에서 지움 ·
  //   'gdrive_edit' = Drive 에서 고쳐 생긴 «이전 판» 행. 복구가 NULL 로 지운다(routes/file_trash.js).
  deleted_via: {
    type: DataTypes.STRING(20),
    allowNull: true
  },
  // 바이트를 실제로 제거한 시각. NULL = 아직 되돌릴 수 있다.
  //   왜 컬럼이 필요한가: 휴지통 목록에서 "되돌릴 수 있는 것" 만 보여주려면 SQL 로 걸러야 한다.
  //   행마다 디스크를 뒤지면 페이지네이션이 무너진다(500건 받아 3건 남는 식).
  //   ★ 다만 **최종 판정은 이 컬럼이 아니다.** 복구 직전에 바이트 실존을 한 번 더 본다
  //     (routes/files.js isRestorable) — 컬럼과 디스크가 어긋나도 거짓 복구가 되지 않게.
  purged_at: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  sequelize,
  tableName: 'files',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['business_id', 'project_id'] },
    { fields: ['business_id', 'content_hash'] },
    { unique: true, fields: ['share_token'], name: 'files_share_token_unique' },
    { fields: ['deleted_at'] },
    { fields: ['business_id', 'visibility', 'uploader_id'] },
    { fields: ['business_id', 'source_key'], name: 'files_business_source_key' },
  ]
});

module.exports = File;
