// services/fileServing.js — 업로드된 바이트를 브라우저로 내보낼 때의 규칙. **단일 원천.**
//
// 왜 이 파일이 있는가 (2026-09-02 Fable 게이트 실증):
//   `GET /api/files/public/by-token/:token/download?inline=1` 이 **클라이언트가 준 MIME** 을
//   그대로 `Content-Type` 에 싣고 `inline` 으로 흘렸다. 업로드에 확장자·MIME 화이트리스트가
//   없어서, `.html` 을 올려 공유하면 **planq.kr origin 에서 그 HTML 이 렌더**됐다.
//   실측 응답: `content-type: text/html`, `content-disposition: inline`, body `<p>fable-probe</p>`.
//   같은 자원의 다른 문(`public-image`·서명 미디어)은 image/video 로 게이트하고 있었다 —
//   **목록은 막고 검색은 열려 있는** 그 계열이다. 그래서 술어를 여기 하나로 모은다.
//
// 두 번째 구멍(같은 날 발견): `isRenderableImage('image/svg+xml') === true` 라
//   **무인증** `public-image` 가 SVG 를 inline 으로 내보내고 있었다. SVG 는 이미지가 아니라
//   스크립트를 담을 수 있는 문서다(`<img>` 안에서는 죽지만 주소창으로 직접 열면 실행된다).
//
// 방어는 세 겹이고, 셋 다 이 파일에서 나간다:
//   ① inline 은 **안전한 형식에만** — 그 외는 attachment (렌더 자체를 안 시킨다)
//   ② `X-Content-Type-Options: nosniff` — 브라우저가 확장자를 보고 되짚어 HTML 로 읽는 것을 막는다
//   ③ `Content-Security-Policy: default-src 'none'; sandbox` — 렌더되더라도 스크립트가 죽는다
//      (SVG 처럼 <img> 로는 살려 둬야 하는 형식의 마지막 방어선)
const path = require('path');

/** 브라우저가 스크립트를 실행할 수 있는 형식 — 무슨 일이 있어도 inline 금지 */
const ACTIVE_CONTENT = new Set([
  'text/html', 'application/xhtml+xml', 'image/svg+xml',
  'application/xml', 'text/xml', 'application/mathml+xml',
  'text/javascript', 'application/javascript', 'application/x-javascript', 'module',
  'multipart/related', 'application/x-mimearchive', 'message/rfc822',
]);

/** 확장자 → 형식. **클라이언트가 준 MIME 을 그대로 믿지 않기 위해** 서버가 따로 본다. */
const EXT_ACTIVE = new Set([
  '.html', '.htm', '.xhtml', '.shtml', '.svg', '.svgz', '.xml',
  '.js', '.mjs', '.mhtml', '.mht', '.eml', '.htc', '.xsl', '.xslt',
]);

function isActiveContent(mime, fileName) {
  const m = String(mime || '').toLowerCase().split(';')[0].trim();
  if (ACTIVE_CONTENT.has(m)) return true;
  const ext = path.extname(String(fileName || '')).toLowerCase();
  return EXT_ACTIVE.has(ext);
}

/**
 * inline 으로 내보내도 되는가.
 * ★ 선언된 MIME 과 **파일명 확장자** 둘 다 안전해야 한다 — 한쪽만 보면
 *   `evil.html` 을 `image/png` 라고 우기는 업로드를 통과시킨다(업로드에 화이트리스트가 없다).
 */
function isSafeInline(mime, fileName) {
  if (isActiveContent(mime, fileName)) return false;
  const m = String(mime || '').toLowerCase().split(';')[0].trim();
  if (m.startsWith('image/')) return true;            // svg 는 위 ACTIVE_CONTENT 에서 이미 걸러졌다
  if (m.startsWith('video/') || m.startsWith('audio/')) return true;
  if (m === 'application/pdf') return true;
  if (m === 'text/plain') return true;
  return false;
}

/**
 * 업로드 바이트를 내보내는 **모든 라우트**가 부른다.
 * @param res              express response
 * @param file             { mime_type, file_name } 모양이면 무엇이든 (File·Attachment 공용)
 * @param opts.inline      호출측이 inline 을 원하는가 (안전하지 않으면 무시되고 attachment)
 * @param opts.disposition 이미 만들어 둔 Content-Disposition 문자열(파일명 인코딩 포함)
 * @returns {boolean} 실제로 inline 으로 나갔는가
 */
function applyFileResponseHeaders(res, file, opts = {}) {
  const mime = file && file.mime_type;
  const name = (file && (file.file_name || file.original_name)) || '';
  const wantInline = !!opts.inline;
  const inline = wantInline && isSafeInline(mime, name);

  res.setHeader('Content-Type', mime || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // ★ 렌더되더라도 스크립트·네트워크·폼이 죽는다. 업로드 바이트에는 예외 없이 붙인다.
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  if (opts.disposition) {
    // 호출측이 만든 문자열의 앞머리만 실제 판정으로 교체한다 (파일명 인코딩은 그대로 살린다).
    res.setHeader('Content-Disposition', opts.disposition.replace(/^\s*(inline|attachment)/i, inline ? 'inline' : 'attachment'));
  } else {
    const { buildContentDisposition } = require('./filename');
    res.setHeader('Content-Disposition', buildContentDisposition(name || 'file', inline ? 'inline' : 'attachment'));
  }
  return inline;
}

module.exports = { isActiveContent, isSafeInline, applyFileResponseHeaders, ACTIVE_CONTENT, EXT_ACTIVE };
