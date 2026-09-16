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

// ★ 2026-09-16 — **프론트와 같은 술어여야 한다** (memory feedback_predicate_must_match_both_sides).
//   프론트 `services/files.ts isImage(mime, name)` 는 mime 을 모르면 **확장자로** 판정하는데
//   서버는 mime 만 봤다. 그 차이가 그대로 기능 결손이 된다 — 브라우저가 mime 을 모르고 보낸
//   PNG(`application/octet-stream`. 드래그앤드롭·모바일 공유시트·일부 OS 에서 실제로 그렇게 온다)는
//   **preview_url 이 영영 없어** 화면이 파일 카드로 떨어뜨리고, 눌러도 미리보기 분기가
//   `hasValidUrl(preview_url)` 에서 막혀 "다운로드 후 확인" 이 된다.
//   dev 실측(2026-09-16): octet-stream 으로 올린 `octet-test.png` → preview_url 없음.
//   두 목록은 프론트 `RENDERABLE_IMAGE_EXTS` 와 **같은 값**이다. 한쪽만 고치면 다시 갈라진다.
const RENDERABLE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico']);
const NON_RENDERABLE_EXT = new Set(['heic', 'heif', 'tiff', 'tif', 'raw', 'cr2', 'cr3', 'nef', 'arw', 'dng']);
/** 확장자 → 브라우저가 <img> 로 그릴 수 있는 Content-Type. mime 이 없거나 일반값일 때만 쓴다. */
const EXT_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon',
  pdf: 'application/pdf',
};
/** 값이 있으나 아무것도 알려주지 않는 mime — 이럴 때 파일명으로 되묻는다. */
const GENERIC_MIME = new Set(['application/octet-stream', 'binary/octet-stream', 'application/download', '']);

function extOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

/**
 * 이 첨부를 <img> 로 그릴 수 있는가. **파일명까지 본다** — 프론트 isImage(mime, name) 와 같은 규칙.
 * fileName 을 넘기지 않으면 종전대로 mime 만 본다(옛 호출부 호환).
 */
function isRenderableImage(mime, fileName) {
  const m = (mime || '').toLowerCase();
  if (NON_RENDERABLE.has(m)) return false;
  if (m.startsWith('image/')) return true;
  const ext = extOf(fileName);
  if (!ext) return false;
  if (NON_RENDERABLE_EXT.has(ext)) return false;
  // mime 이 image/* 도 아니고 generic 도 아닌데 확장자만 이미지면(예: text/plain 인 .png)
  //   신뢰하지 않는다 — 서버가 모르는 것을 확장자로 덮어쓰는 것이 아니라, 모를 때만 되묻는다.
  if (!GENERIC_MIME.has(m)) return false;
  return RENDERABLE_EXT.has(ext);
}

/**
 * 실제로 내보낼 Content-Type. 저장된 mime 이 generic 이면 확장자에서 되살린다 —
 * 그러지 않으면 판정만 통과하고 브라우저는 `application/octet-stream` 을 받아 **여전히 안 그린다**
 * (판정과 서빙이 갈라지면 "된다고 했는데 안 된다" 가 된다).
 */
function effectiveMimeType(mime, fileName) {
  const m = (mime || '').toLowerCase();
  if (m && !GENERIC_MIME.has(m)) return mime;
  const ext = extOf(fileName);
  return EXT_MIME[ext] || mime || null;
}

/**
 * File 레코드(또는 같은 모양의 평문 객체)의 미리보기 URL.
 * 이미지가 아니거나 서빙할 수 없으면 undefined — 호출측은 그대로 넣으면 된다.
 */
function previewUrlForFile(f) {
  if (!f || !isRenderableImage(f.mime_type, f.file_name || f.original_name)) return undefined;
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
  if (!att || !isRenderableImage(att.mime_type, att.file_name || att.original_name)) return undefined;
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
  // Drive 편집기로 열 수 있는가 — 화면이 "편집" 버튼을 **보여줄지** 판단하는 데만 쓴다.
  //   실제 권한은 여는 순간 `POST /api/files/:biz/:id/drive-edit` 가 다시 본다(canDownloadFile 단일 술어).
  //   저장 경로(external_id)는 그대로 감춘 채 불리언만 내보낸다.
  const drive_editable = a.storage_provider === 'gdrive' && !!(a.external_id || a.file_path) && !!a.file_id;
  delete a.file_path;
  delete a.external_id;
  delete a.storage_provider;
  const out = { ...a, drive_editable };
  return preview_url ? { ...out, preview_url } : out;
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
  effectiveMimeType,
  messageAttachmentToken,
  previewUrlForMessageAttachment,
  serializeMessageAttachment,
  serializeMessageAttachments,
};
