// services/filename.js
//
// multipart/form-data 파일명 한글 깨짐 복구 + 다운로드 Content-Disposition 안전 인코딩.
//
// 문제:
//   multer 2.x 는 multipart 의 filename 을 latin1 로 받는다. 브라우저(Chrome/Edge/Safari)는
//   UTF-8 바이트로 전송하지만 multer 가 latin1 로 해석 → 한글이 mojibake (`â`, `ä` 등 포함) 으로
//   저장됨. DB.File.file_name 에 깨진 채로 저장돼 화면·다운로드 모두 깨짐.
//
// 해결:
//   업로드 시 originalname 을 latin1 바이트로 다시 풀어 UTF-8 로 디코딩.
//   이미 ASCII-only / valid UTF-8 인 이름은 변경 없음.

// originalname → 정상 UTF-8.
//   1) Buffer.from(name, 'latin1') → 원본 바이트 복원
//   2) toString('utf8') 로 디코딩 시도
//   3) 디코드 결과가 latin1 mojibake 패턴을 잃었고 (∵ 글자 수 일반적으로 줄어듦) replacement char 가
//      들어가지 않으면 채택. 아니면 원본 그대로 (이미 ASCII 거나 multer 가 utf8 로 받은 경우).
// ★ 한글 정규화 (NFD → NFC). 운영 #364.
//   macOS 는 파일명을 **분해형(NFD)** 으로 준다 — "스" 가 U+C2A4 한 글자가 아니라
//   U+1109(ᄉ) + U+1173(ᅳ) 두 글자다. 눈에는 똑같이 보이는데 바이트가 달라서:
//     · 검색이 조용히 실패한다. 운영 실측 — 사용자가 "스크린샷" 을 치면 DB LIKE 는 **0건**,
//       실제로 그 이름인 파일은 **33건**이었다. 사용자는 "파일이 없다" 로 읽는다.
//     · 폰트·환경에 따라 자모가 분리돼 보인다(#364 신고 원문의 "ㅇㅣㄹㅓㅎㄱㅔ" 가 이 모양이다).
//   운영 파일 1010건 중 41건이 이 상태였다(전부 맥 스크린샷).
//   → 들어오는 순간 조합형(NFC)으로 통일한다. 업로드 5경로가 전부 이 함수를 지나므로 여기 한 곳이면 된다.
const toNFC = (s) => (typeof s === 'string' ? s.normalize('NFC') : s);

function decodeOriginalName(name) {
  return toNFC(decodeOriginalNameRaw(name));
}

function decodeOriginalNameRaw(name) {
  if (typeof name !== 'string' || !name) return name;
  // ASCII-only 면 변환 불필요
  if (/^[\x00-\x7F]*$/.test(name)) return name;
  try {
    const recovered = Buffer.from(name, 'latin1').toString('utf8');
    // 복구 후 U+FFFD (replacement) 포함이면 실패 — 원본 그대로 (이미 utf8 였을 가능성)
    if (recovered.includes('�')) return name;
    // mojibake 마커: 'â' (0xE2), 'ä' (0xE4), 'ã' (0xE3) 등 latin1 representation 들이 사라졌는지
    const hadMojibake = /[À-ÿ]/.test(name);
    const stillMojibake = /[À-ÿ]/.test(recovered);
    if (hadMojibake && !stillMojibake) return recovered;
    // 한글/CJK 문자 등장 == 성공 신호
    //   ᄀ-ᇿ(조합용 자모)도 성공으로 본다 — 맥에서 온 분해형(NFD) 한글은 '가-힯' 에 안 걸린다.
    //   이게 빠져 있으면 NFD 한글 파일명은 mojibake 복구를 통과 못 하고 깨진 채 남는다.
    if (/[　-鿿가-힯ᄀ-ᇿ]/.test(recovered)) return recovered;
    return name;
  } catch { return name; }
}

// Content-Disposition 안전 헤더 — ASCII fallback + UTF-8 RFC 5987.
function buildContentDisposition(filename, disposition = 'attachment') {
  const safe = (filename || 'download').replace(/[\\/]/g, '_');
  // ASCII fallback: 한글 → '?' 같은 placeholder. 주 클라이언트는 filename* 사용.
  const asciiFallback = safe.replace(/[^\x20-\x7E]/g, '_');
  const encoded = encodeURIComponent(safe);
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

module.exports = { decodeOriginalName, buildContentDisposition, toNFC };
