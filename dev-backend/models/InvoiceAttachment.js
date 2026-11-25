// InvoiceAttachment — 청구서에 붙는 **첨부(파일·문서)**. 출처 문서(invoices.source_post_id)와 다른 칸이다.
//
//   Irene(2026-11-25): *"청구서에 출처문서만 연결할 수 있는데 문서든 파일이든 업로드든 첨부문서/파일들도 넣을 수 있어야 해."*
//   설계: docs/INVOICE_ATTACHMENTS_DESIGN.md (Fable 설계 판정)
//
// ★ 바이트를 복사하지 않는다 — 워크스페이스에 있는 자료를 **가리키기만** 한다(CalendarEventAttachment 와 같은 방식).
// ★ file_id · post_id 중 **정확히 하나**. 서버(services/invoiceAttachments)가 강제한다.
// ★ client_visible 기본 false(내부용) — 잘못 숨기면 한 번 눌러 고치지만, 잘못 보이면 되돌릴 수 없다.
//   켜져 있어도 밖으로 나가는지는 매 요청 publicAttachmentReason 이 다시 정한다(원본이 지워지거나 좁혀지면 빠진다).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class InvoiceAttachment extends Model {}

InvoiceAttachment.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  invoice_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'invoices', key: 'id' } },
  file_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'files', key: 'id' } },
  post_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'posts', key: 'id' } },
  client_visible: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  created_by: { type: DataTypes.INTEGER, allowNull: true },
}, {
  sequelize, tableName: 'invoice_attachments', timestamps: true, underscored: true,
  indexes: [
    { fields: ['invoice_id'] }, { fields: ['file_id'] }, { fields: ['post_id'] }, { fields: ['business_id'] },
    { unique: true, fields: ['invoice_id', 'file_id'], name: 'invoice_attachments_invoice_file_unique' },
    { unique: true, fields: ['invoice_id', 'post_id'], name: 'invoice_attachments_invoice_post_unique' },
  ],
});

module.exports = InvoiceAttachment;
