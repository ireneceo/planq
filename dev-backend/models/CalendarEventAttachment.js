// CalendarEventAttachment — 일정에 붙는 **미팅자료**. 파일(File) 또는 문서(Post) 하나를 가리킨다.
//
//   Irene(#411): *"파일첨부 문서찾기 하게 해서 사전 준비한 미팅자료 연결하게 해줘. 미리 참석자들이 보게"*
//
// ★ **바이트를 복사하지 않는다** — 이미 워크스페이스에 있는 자료를 **가리키기만** 한다.
//   업무 첨부(TaskAttachment)는 경로·크기를 복사해 두는데, 그 방식이 오늘(2026-09-17)
//   «같은 바이트를 누가 쓰는가» 를 여섯 곳에서 따로 세게 만든 원인이었다.
//   여기서는 `file_id`/`post_id` 만 들고, 파일이 지워지면 이 행도 같이 사라진다(CASCADE).
//
// ★ 둘 중 **정확히 하나**만 채운다(파일이거나 문서이거나). 서버가 그 규칙을 강제한다.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class CalendarEventAttachment extends Model {}

CalendarEventAttachment.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  // ★ `calendar_events.id` 는 **BIGINT** 다 — INTEGER 로 잡으면 FK 가 거부된다(2026-09-17 실측).
  event_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: 'calendar_events', key: 'id' } },
  file_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'files', key: 'id' } },
  post_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'posts', key: 'id' } },
  sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  created_by: { type: DataTypes.INTEGER, allowNull: true },
}, {
  sequelize, tableName: 'calendar_event_attachments', timestamps: true, underscored: true,
  indexes: [{ fields: ['event_id'] }, { fields: ['file_id'] }, { fields: ['post_id'] }, { fields: ['business_id'] }],
});

module.exports = CalendarEventAttachment;
