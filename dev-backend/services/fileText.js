// services/fileText.js — 파일 본문 텍스트 추출 **단일 원천** (#227).
//
// 왜 승격했는가:
//   brief_service.js 안에만 있던 추출 함수를 Cue 컨텍스트에서도 써야 한다. 복사하면
//   반드시 갈라진다 — 한쪽만 형식을 늘리거나 한쪽만 상한을 고치는 일이 이 저장소에서
//   여러 번 있었다(memory: 베낀 컴포넌트는 반드시 갈라진다 — 껍데기를 뽑아라).
//   brief_service 는 이제 이 파일을 부른다.
//
// ★ pdf-parse 는 **정식 의존성**이다. 예전엔 optional require 였는데 dev·운영 어디에도
//   설치돼 있지 않아 PDF 는 늘 빈 문자열을 돌려줬다 — 오류도 안 나서 아무도 몰랐다
//   (memory: feedback_prod_only_system_dependency / feedback_silent_no_output_paths).
//   그리고 v2 는 함수가 아니라 **PDFParse 클래스**다. 옛 호출 형태(`await pdfParse(buf)`)를
//   그대로 두면 설치해도 TypeError 로 떨어져 여전히 빈 문자열이 된다.
const fs = require('fs');
const path = require('path');

// 한 파일에서 뽑을 최대 길이. 호출부가 더 짧게 자를 수 있다(Cue 는 건당 1,500자).
const DEFAULT_MAX = 50_000;

// 외부 저장소에서 본문 추출용으로 받아 올 최대 바이트. 통째로 받을 이유가 없다.
const REMOTE_FETCH_MAX_BYTES = 20 * 1024 * 1024;

// 같은 파일을 반복해 읽지 않는다. 물리 파일은 UUID + content_hash 로 **불변**이라
//   해시가 같으면 내용도 같다 — 캐시가 stale 해질 수 없다.
const CACHE_MAX = 60;
const cache = new Map();   // key → text (Map 은 삽입 순서 보장 → 가장 오래된 것부터 버린다)

function cacheGet(key) {
  if (!cache.has(key)) return undefined;
  const v = cache.get(key);
  cache.delete(key); cache.set(key, v);   // LRU — 쓴 것을 뒤로
  return v;
}
function cacheSet(key, val) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, val);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

/** HTML → 읽을 수 있는 글. routes/kb.js 의 import 경로와 같은 규칙(스타일·스크립트 먼저 제거). */
function stripHtml(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 이 파일에서 본문을 뽑을 수 있는가 — 화면이 "왜 못 읽는지" 를 말할 수 있게 이유를 함께 준다. */
function extractability(fileRow) {
  if (!fileRow || !fileRow.file_path) return { ok: false, reason: 'no_path' };
  // ★ 2026-09-08 — 여기서 `storage_provider !== 'planq'` 를 막고 있었다. 그런데 워크스페이스가
  //   Drive 를 연결하면 새 파일은 전부 `gdrive` 로 저장된다 — 운영 실측 46건이 **한 글자도**
  //   Cue 에게 안 읽혔다. 오류도 안 나고 그냥 빈 문자열이라 아무도 몰랐다.
  //   저장소는 읽는 쪽이 신경 쓸 일이 아니다 — `services/attachmentStorage.readAttachmentBody`
  //   가 planq/gdrive/s3 를 이미 단일 지점에서 가른다. 그것을 쓴다.
  //   (같은 계열 사고: memory `feedback_storage_branch_single_source`)
  const mime = String(fileRow.mime_type || '').toLowerCase();
  // HTML 은 태그를 벗겨야 쓸 만한 본문이 된다 — 안 벗기면 style/script 덩어리가 그대로 색인돼
  //   검색이 태그에 걸리고 임베딩도 쓰레기를 학습한다(수동 "파일 → Q info" 경로는 이미 벗기고 있었다).
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return { ok: true, kind: 'html' };
  if (mime.startsWith('text/') || mime === 'application/json') return { ok: true, kind: 'text' };
  if (mime === 'application/pdf') return { ok: true, kind: 'pdf' };
  // ★ 2026-09-08 — 워드·엑셀·파워포인트. 여태 `unsupported_type` 이라 **한 글자도** 안 읽혔다.
  //   계약서·견적서가 대개 이 형식이라 가장 물어볼 만한 파일이 정확히 사각지대였다.
  //   구현은 `services/officeText.js` (ZIP+XML — 새 의존성 없음).
  const office = officeKind(mime, fileRow.file_name);
  if (office) return { ok: true, kind: office };
  return { ok: false, reason: 'unsupported_type' };   // .doc/.xls(옛 바이너리)·이미지·압축 등
}

// OOXML 판별. mime 을 먼저 믿되 **확장자로도 받는다** — 모바일·일부 브라우저 업로드가
//   `application/octet-stream` 으로 올려서, mime 만 보면 같은 파일이 기기에 따라 읽히고 안 읽힌다.
const OFFICE_MIME = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};
const OFFICE_EXT = { docx: 'docx', xlsx: 'xlsx', pptx: 'pptx' };
function officeKind(mime, fileName) {
  if (OFFICE_MIME[mime]) return OFFICE_MIME[mime];
  const ext = String(fileName || '').toLowerCase().split('.').pop();
  return OFFICE_EXT[ext] || null;
}

/** 저장소와 무관하게 파일 바이트를 가져온다. 못 가져오면 null (예외 아님). */
async function readFileBuffer(fileRow) {
  const provider = fileRow.storage_provider || 'planq';
  if (provider === 'planq') {
    const abs = path.isAbsolute(fileRow.file_path)
      ? fileRow.file_path
      : path.resolve(__dirname, '..', fileRow.file_path);
    if (!fs.existsSync(abs)) return null;
    return fs.readFileSync(abs);
  }
  // 외부 저장소 — 서버가 워크스페이스 토큰으로 받아서 흘려준다.
  const body = await require('./attachmentStorage').readAttachmentBody({
    storage_provider: provider,
    file_path: fileRow.file_path,
    external_id: fileRow.external_id || fileRow.file_path,
    business_id: fileRow.business_id,
  });
  if (!body.ok || !body.stream) return null;    // redirect(S3 presign)는 여기서 읽지 않는다
  const chunks = [];
  let bytes = 0;
  for await (const c of body.stream) {
    chunks.push(c);
    bytes += c.length;
    // 본문 추출용이라 통째로 받을 이유가 없다 — 상한을 넘으면 거기서 끊는다.
    if (bytes > REMOTE_FETCH_MAX_BYTES) { body.stream.destroy(); break; }
  }
  return Buffer.concat(chunks);
}

/**
 * 파일 본문 텍스트. 못 뽑으면 **빈 문자열**(예외 아님) — 텍스트가 없다고 기능이 죽으면 안 된다.
 * @param {object} fileRow  File 인스턴스 또는 plain (file_path·mime_type·storage_provider·content_hash·id)
 * @param {{ maxChars?: number }} [opts]
 */
async function extractFileText(fileRow, opts = {}) {
  const maxChars = opts.maxChars || DEFAULT_MAX;
  const can = extractability(fileRow);
  if (!can.ok) return '';

  // 캐시는 **바이트를 받기 전**에 본다 — Drive 왕복을 매번 하지 않기 위해서다.
  const key = `${fileRow.content_hash || fileRow.file_path}:${can.kind}`;
  const hit = cacheGet(key);
  if (hit !== undefined) return hit.slice(0, maxChars);

  let buf = null;
  try {
    buf = await readFileBuffer(fileRow);
  } catch (e) {
    console.warn('[fileText] 본문 가져오기 실패:', fileRow.id, e.message);
    return '';
  }
  if (!buf) return '';

  let text = '';
  try {
    if (can.kind === 'text') {
      text = buf.toString('utf-8').slice(0, DEFAULT_MAX);
    } else if (can.kind === 'html') {
      text = stripHtml(buf.toString('utf-8')).slice(0, DEFAULT_MAX);
    } else if (can.kind === 'docx' || can.kind === 'xlsx' || can.kind === 'pptx') {
      text = require('./officeText').extractOfficeText(buf, can.kind).slice(0, DEFAULT_MAX);
    } else if (can.kind === 'pdf') {
      const { PDFParse } = require('pdf-parse');
      const parser = new PDFParse({ data: buf });
      try {
        const r = await parser.getText();
        text = String(r?.text || '').slice(0, DEFAULT_MAX);
      } finally {
        // 파서가 워커를 붙잡고 있으면 프로세스가 안 죽는다 — 반드시 놓아준다.
        if (typeof parser.destroy === 'function') await parser.destroy().catch(() => null);
      }
    }
  } catch (e) {
    console.warn('[fileText] 추출 실패:', fileRow.id, e.message);
    return '';
  }
  cacheSet(key, text);
  return text.slice(0, maxChars);
}

module.exports = { extractFileText, extractability, readFileBuffer, DEFAULT_MAX };
