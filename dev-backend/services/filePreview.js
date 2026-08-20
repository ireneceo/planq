// 파일 미리보기 URL — **단일 원천**.
//
// 왜 이 파일이 있는가: 같은 규칙("이미지면 <img> 가 쓸 수 있는 URL 을 준다")이 라우트마다
//   복사돼 있었고, 그중 Q File 계열만 `storage_provider === 'planq'` 를 하드코딩해
//   **드라이브에 저장된 이미지는 어느 화면에서도 미리보기가 안 됐다**
//   (Irene: "왜 미리보기가 안돼? png가 왜 미리보기가 안돼?" — 운영 실측 33건 전부 미리보기 0).
//   task 첨부(#134)는 이미 같은 문제를 고쳐 뒀는데 파일 쪽만 남아 있었다.
//   규칙이 여러 벌이면 또 한쪽만 갈라진다 → 여기 하나만 둔다.
//
// 접근 제어 모델은 기존과 **동일**하다(넓히지 않는다):
//   경로에 들어가는 값이 추측 불가능한 토큰이라는 전제. 로컬은 UUID 파일명, Drive 는 Drive 파일 ID.
//   task 첨부의 `/api/tasks/public/attach/:storedName`(UUID) 과 같은 계약이다.
const path = require('path');

/** 브라우저가 직접 렌더하지 못하는 이미지 — 미리보기를 주면 깨진 아이콘이 뜬다 (프론트 files.ts 와 같은 목록) */
const NON_RENDERABLE = new Set([
  'image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence',
  'image/tiff', 'image/x-tiff',
  'image/x-canon-cr2', 'image/x-canon-cr3', 'image/x-nikon-nef', 'image/x-sony-arw', 'image/x-adobe-dng',
]);

function isRenderableImage(mime) {
  const m = (mime || '').toLowerCase();
  return m.startsWith('image/') && !NON_RENDERABLE.has(m);
}

/**
 * File 레코드(또는 같은 모양의 평문 객체)의 미리보기 URL.
 * 이미지가 아니거나 서빙할 수 없으면 undefined — 호출측은 그대로 넣으면 된다.
 */
function previewUrlForFile(f) {
  if (!f || !isRenderableImage(f.mime_type)) return undefined;
  const provider = f.storage_provider || 'planq';
  if (provider === 'gdrive') {
    // Drive 저장분: file_path 에는 로컬 경로가 아니라 Drive 파일 ID 가 들어 있다(운영 실측).
    //   그래서 basename 을 쓰면 안 되고 external_id 를 쓴다. 서빙은 서버가 Drive 토큰으로 스트림.
    return f.external_id ? `/api/files/public-image/${f.external_id}` : undefined;
  }
  if (provider === 'planq') {
    return f.file_path ? `/api/files/public-image/${path.basename(f.file_path)}` : undefined;
  }
  // s3 등은 아직 공개 미리보기 경로가 없다 — 다운로드로 간다(옛 동작 그대로).
  return undefined;
}

/**
 * 채팅 첨부(MessageAttachment)가 <img> 로 쓸 수 있는 URL. **단일 원천.**
 *
 * ★ 왜 서버가 계산해서 내려주나: 프론트가 `/api/message-attachments/:id/raw` 를 쓰고 있었는데
 *   그 경로는 **무인증 + 순차 정수 id** 라 1,2,3… 열거만으로 **타 워크스페이스 채팅 이미지**가
 *   열렸다(통제 데이터로 크로스테넌트 실증). 접근 제어를 "추측 불가능한 토큰" 하나로 통일한다.
 *
 * 토큰 규칙:
 *   planq  — UUID 파일명 (file_path 의 basename)
 *   gdrive — Drive 파일 ID. **external_id 가 정본**이다. file_path 에 Drive ID 를 넣던 옛 행이
 *            있어 폴백을 둔다(옛 행은 external_id 가 비어 있다).
 */
function messageAttachmentToken(att) {
  if (!att) return null;
  const provider = att.storage_provider || 'planq';
  if (provider === 'gdrive') return att.external_id || att.file_path || null;
  return att.file_path ? path.basename(att.file_path) : null;
}

function previewUrlForMessageAttachment(att) {
  if (!att || !isRenderableImage(att.mime_type)) return undefined;
  const token = messageAttachmentToken(att);
  return token ? `/api/message-attachments/public/${token}` : undefined;
}

/**
 * 응답에 실을 채팅 첨부 한 건. **원본 저장 정보(file_path·external_id·storage_provider)는 빼고**
 * 미리보기 URL 만 내려준다 — 프론트가 토큰을 조립할 필요가 없고, 저장 경로도 새지 않는다.
 */
function serializeMessageAttachment(att) {
  if (!att) return att;
  const a = typeof att.toJSON === 'function' ? att.toJSON() : { ...att };
  const preview_url = previewUrlForMessageAttachment(a);
  delete a.file_path;
  delete a.external_id;
  delete a.storage_provider;
  return preview_url ? { ...a, preview_url } : a;
}

/** 메시지 배열(평문 JSON)의 attachments 를 일괄 직렬화. 메시지 응답 경로 어디서나 이 함수만 부른다. */
function serializeMessageAttachments(messages) {
  const list = Array.isArray(messages) ? messages : [messages];
  for (const m of list) {
    if (m && Array.isArray(m.attachments)) m.attachments = m.attachments.map(serializeMessageAttachment);
  }
  return messages;
}

module.exports = {
  previewUrlForFile,
  isRenderableImage,
  messageAttachmentToken,
  previewUrlForMessageAttachment,
  serializeMessageAttachment,
  serializeMessageAttachments,
};
