// GdriveSyncLog — Drive ↔ PlanQ 동기화 원장 (#379)
//
// 왜 처음부터 만드나: 운영 안정성 원칙 6 — "외부 연동은 처음 release 부터 Log 테이블".
//   양방향 동기화는 **에코 루프·충돌·유실**이 조용히 일어나는 영역이다. 로그가 없으면
//   "왜 파일이 사라졌지" 를 영영 설명할 수 없다. 운영 시작 후 추가하면 히스토리가 없다.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class GdriveSyncLog extends Model {}

GdriveSyncLog.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  // 어느 쪽에서 시작된 변경인가
  direction: { type: DataTypes.ENUM('drive_to_planq', 'planq_to_drive'), allowNull: false },
  gdrive_file_id: { type: DataTypes.STRING(128), allowNull: true },
  file_id: { type: DataTypes.INTEGER, allowNull: true },      // PlanQ File.id (매칭됐을 때)
  // 무엇을 했는가. skipped 계열은 **왜 안 했는지**가 핵심이라 reason 과 짝으로 본다.
  action: {
    type: DataTypes.ENUM('rename', 'move', 'content', 'trash', 'untrash', 'unmirror', 'create', 'skip'),
    allowNull: false,
  },
  // skip 사유: echo(우리가 만든 변경) · unknown_file(모르는 파일) · no_change(멱등 비교 diff 0) ·
  //   unsupported(구글 네이티브 문서 등) · scope_limited(drive.file 범위 밖)
  reason: { type: DataTypes.STRING(60), allowNull: true },
  detail: { type: DataTypes.JSON, allowNull: true, defaultValue: null },
}, {
  sequelize,
  tableName: 'gdrive_sync_logs',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['business_id', 'created_at'] },
    { fields: ['gdrive_file_id'] },
    { fields: ['file_id'] },
  ],
});

module.exports = GdriveSyncLog;
