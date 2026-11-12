// 게스트 업로드 내용 검사 — 확장자만 믿지 않는다 (docs/GUEST_UPLOAD_DESIGN.md §2).
//   ① 파일 머리(매직바이트)가 확장자와 맞아야 한다 — .exe 를 .jpg 로 바꿔 올리는 것을 막는다.
//   ② jpeg/png/webp/gif 는 sharp 가 실제로 읽을 수 있어야 한다(깨진 그림 거절).
//   ③ mime 은 **서버가 판정한 값**만 저장한다(브라우저가 보낸 값은 버린다).
const fs = require('fs');
const path = require('path');

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.heic': 'image/heic', '.heif': 'image/heif', '.pdf': 'application/pdf',
};
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'heif']);

function headMatches(ext, b) {
  if (!b || b.length < 12) return false;
  switch (ext) {
    case '.jpg': case '.jpeg': return b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF;
    case '.png': return b.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47]));
    case '.gif': return b.slice(0, 4).toString('latin1') === 'GIF8';
    case '.webp': return b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP';
    case '.heic': case '.heif': return b.slice(4, 8).toString('latin1') === 'ftyp' && HEIF_BRANDS.has(b.slice(8, 12).toString('latin1'));
    case '.pdf': return b.slice(0, 5).toString('latin1') === '%PDF-';
    default: return false;
  }
}

/** @returns {Promise<{ok:true, mime:string}|{ok:false}>} */
async function checkGuestFile(absPath, originalName) {
  const ext = path.extname(String(originalName || '')).toLowerCase();
  if (!MIME[ext]) return { ok: false };
  let head;
  try {
    const fd = await fs.promises.open(absPath, 'r');
    try { const buf = Buffer.alloc(16); const { bytesRead } = await fd.read(buf, 0, 16, 0); head = buf.slice(0, bytesRead); }
    finally { await fd.close(); }
  } catch { return { ok: false }; }
  if (!headMatches(ext, head)) return { ok: false };
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) {
    try {
      const meta = await require('sharp')(absPath).metadata();
      if (!meta || !meta.width || !meta.height) return { ok: false };
    } catch { return { ok: false }; }
  }
  return { ok: true, mime: MIME[ext] };
}

/** 파일명 — 제어문자·경로 구분자 제거, 120자 */
function cleanGuestFileName(raw) {
  const { decodeOriginalName } = require('./filename');
  const s = String(decodeOriginalName(raw) || '').replace(/<[^>]*>/g, '').replace(/[<>]/g, '').replace(/[\u0000-\u001F\u007F]/g, '').replace(/[\\/]/g, '_').trim();   // 태그·꺾쇠도 걷는다(이 이름을 HTML 로 그리는 곳이 생겨도 통로가 안 되게, Fable N4)
  return (s || 'file').slice(0, 120);
}

module.exports = { checkGuestFile, cleanGuestFileName, headMatches };
