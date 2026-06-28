// #63 Phase 3 — 자료 이동/내보내기 비동기 작업.
// 대용량 transfer(이동/복사)·export(다운로드 zip) 를 cron 워커가 드레인 처리.
// status: queued → running → done | failed. attempts 로 재시도(최대 3회).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class ExportJob extends Model {}

ExportJob.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  // 요청자(본인) + 출발 워크스페이스
  user_id: {
    type: DataTypes.INTEGER, allowNull: false,
    references: { model: 'users', key: 'id' },
  },
  business_id: {
    type: DataTypes.INTEGER, allowNull: false,
    references: { model: 'businesses', key: 'id' },
  },
  // transfer = 다른 워크스페이스로 이동/복사 / export = 다운로드 zip 생성
  kind: { type: DataTypes.ENUM('transfer', 'export'), allowNull: false },
  // transfer 전용: copy(원본 유지) / move(원본 soft delete)
  mode: { type: DataTypes.ENUM('copy', 'move'), allowNull: true },
  // transfer 전용: 도착 워크스페이스
  target_business_id: {
    type: DataTypes.INTEGER, allowNull: true,
    references: { model: 'businesses', key: 'id' },
  },
  // 본인 Q Note 세션 포함 여부 (요약+전사 → 문서로 변환)
  include_qnote: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  status: {
    type: DataTypes.ENUM('queued', 'running', 'done', 'failed'),
    allowNull: false, defaultValue: 'queued',
  },
  attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  // 처리 결과 카운트 { files_copied, documents_copied, qnote_copied, files_removed, skipped, bytes }
  result: { type: DataTypes.JSON, allowNull: true },
  error: { type: DataTypes.TEXT, allowNull: true },
  // export 전용: 생성된 zip 물리 경로 + 다운로드 토큰 + 만료
  download_path: { type: DataTypes.STRING(500), allowNull: true },
  download_token: { type: DataTypes.STRING(64), allowNull: true },
  expires_at: { type: DataTypes.DATE, allowNull: true },
  started_at: { type: DataTypes.DATE, allowNull: true },
  done_at: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize,
  modelName: 'ExportJob',
  tableName: 'export_jobs',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['status'] },              // cron 드레인
    { fields: ['business_id', 'user_id'] }, // 본인 목록
    { fields: ['download_token'] },      // 다운로드 조회
  ],
});

module.exports = ExportJob;
