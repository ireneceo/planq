// 게스트(로그인 없음)에게 보이는 첨부의 모양·미리보기 판정 — 한 벌 (docs/GUEST_UPLOAD_DESIGN.md §1).
// ★ 목록의 has_preview 와 미리보기 라우트의 200 조건은 **같은 함수**다(guestAttachmentPreviewable).
// ★ preview_url·저장 이름·mime·file_id·저장소를 게스트에게 싣지 않는다 — `serializeMessageAttachment` 는
//   영구 공개 주소(/api/message-attachments/public/<uuid>)를 실으므로 쓰지 않는다(링크를 회수해도 안 닫힌다).
const { isRenderableImage, effectiveMimeType } = require('./filePreview');
const { RESIZABLE } = require('./imageResize');

function guestAttachmentPreviewable(att) {
  if (!att) return false;
  const provider = att.storage_provider || 'planq';
  if (provider === 'planq' ? !att.file_path : provider === 'gdrive' ? !(att.external_id || att.file_path) : true) return false;
  if (!isRenderableImage(att.mime_type, att.file_name)) return false;
  return RESIZABLE.test(String(effectiveMimeType(att.mime_type, att.file_name) || ''));
}

function serializeGuestAttachment(att) {
  const a = att && att.toJSON ? att.toJSON() : att;
  return {
    id: a.id,
    file_name: a.file_name,
    file_size: a.file_size,
    kind: isRenderableImage(a.mime_type, a.file_name) ? 'image' : 'file',
    has_preview: guestAttachmentPreviewable(a),
  };
}

module.exports = { guestAttachmentPreviewable, serializeGuestAttachment };
