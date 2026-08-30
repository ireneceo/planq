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

/** 이 파일에서 본문을 뽑을 수 있는가 — 화면이 "왜 못 읽는지" 를 말할 수 있게 이유를 함께 준다. */
function extractability(fileRow) {
  if (!fileRow || !fileRow.file_path) return { ok: false, reason: 'no_path' };
  // 외부 연동 파일은 우리 디스크에 없다. 커버리지 선언에 그대로 반영해야 Cue 가 거짓말하지 않는다.
  if (fileRow.storage_provider !== 'planq') return { ok: false, reason: 'external_storage' };
  const mime = String(fileRow.mime_type || '').toLowerCase();
  if (mime.startsWith('text/') || mime === 'application/json') return { ok: true, kind: 'text' };
  if (mime === 'application/pdf') return { ok: true, kind: 'pdf' };
  return { ok: false, reason: 'unsupported_type' };   // docx/xlsx 등은 아직
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

  const abs = path.isAbsolute(fileRow.file_path)
    ? fileRow.file_path
    : path.resolve(__dirname, '..', fileRow.file_path);
  if (!fs.existsSync(abs)) return '';

  const key = `${fileRow.content_hash || fileRow.file_path}:${can.kind}`;
  const hit = cacheGet(key);
  if (hit !== undefined) return hit.slice(0, maxChars);

  let text = '';
  try {
    if (can.kind === 'text') {
      text = fs.readFileSync(abs, 'utf-8').slice(0, DEFAULT_MAX);
    } else if (can.kind === 'pdf') {
      const { PDFParse } = require('pdf-parse');
      const parser = new PDFParse({ data: fs.readFileSync(abs) });
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

module.exports = { extractFileText, extractability, DEFAULT_MAX };
