// 구글 문서 **바로가기 파일**(.gdoc/.gsheet/.gslides/…) — 문서가 아니라 «문서로 가는 링크» 다.
//
// ★ 2026-09-20 (Irene: *"이 구글문서가 플랜큐에 올라갔는데 오픈을 하면 No preview available
//   이렇게 떠. 내가 공유한 아이디가 같은 드라이브인데 왜 이래?"* → *"왜 구글 드라이브에서 열려?
//   문서로 열려야지?"*) — 접근 권한 문제가 아니었다. 운영 실측: 그 파일은 **172 바이트**다.
//   맥/윈도우의 구글 드라이브 폴더에서 끌어온 `.gdoc` 은 본문이 아니라 아래 모양의 JSON 이다:
//       {"url":"https://docs.google.com/open?id=XXXX","doc_id":"XXXX","email":"..."}
//   우리는 그 172 바이트를 그대로 저장했고, 열기는 **그 바로가기 파일의 Drive 주소**를 열었다.
//   Drive 는 172 바이트 JSON 을 미리보기할 수 없으니 "No preview available" 이 뜬다.
//   → 안에 든 문서 id 를 읽어 **문서 자체**(docs.google.com)로 보낸다. 그러면 소유자·공유받은
//     사람은 그대로 열리고, 권한이 없으면 구글이 권한 요청 화면을 보여 준다(우리가 판단하지 않는다).
//
// ★ 링크를 **우리가 만든다** — 파일 안의 `url` 을 그대로 쓰지 않는다. 그 값은 사용자가 올린
//   파일의 내용이고, 꾸며 넣으면 임의 사이트로 보내는 링크가 된다(우리 화면이 보증하는 링크가 된다).
//   id 만 뽑아 형식을 검사하고, 주소는 아래 표로 조립한다.

/** 확장자 → 문서 종류. 값은 docs.google.com 의 경로 조각이다. */
const KINDS = {
  gdoc: { kind: 'document', path: 'document' },
  gsheet: { kind: 'spreadsheet', path: 'spreadsheets' },
  gslides: { kind: 'presentation', path: 'presentation' },
  gdraw: { kind: 'drawing', path: 'drawings' },
  gform: { kind: 'form', path: 'forms' },
  gscript: { kind: 'script', path: null },   // 스크립트는 script.google.com 이라 따로 만든다
  gsite: { kind: 'site', path: null },
};
/** 바로가기 파일은 아주 작다. 이보다 크면 파싱하지 않는다(본문이 든 다른 파일일 수 있다). */
const MAX_BYTES = 8 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{10,200}$/;

function extOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

/** 이 이름이 구글 바로가기인가 — 확장자만 본다(mime 은 octet-stream 으로 온다). */
function isShortcutName(name) {
  return Object.prototype.hasOwnProperty.call(KINDS, extOf(name));
}

/** 이 파일을 파싱해 볼 가치가 있는가 (이름 + 크기). */
function looksLikeShortcut(name, size) {
  if (!isShortcutName(name)) return false;
  const n = Number(size);
  return !Number.isFinite(n) || n <= MAX_BYTES;
}

/**
 * 바로가기 본문에서 **문서 주소**를 만든다. 못 만들면 null.
 * @returns {{url:string, docId:string, kind:string}|null}
 */
function parseShortcut(buf, name) {
  const ext = extOf(name);
  const spec = KINDS[ext];
  if (!spec) return null;
  if (!buf || buf.length > MAX_BYTES) return null;
  let obj;
  try { obj = JSON.parse(buf.toString('utf8')); } catch { return null; }
  if (!obj || typeof obj !== 'object') return null;

  let id = typeof obj.doc_id === 'string' ? obj.doc_id : '';
  if (!ID_RE.test(id)) {
    // 옛 형식은 doc_id 가 없고 url 에만 있다 — **id 만** 뽑는다(주소는 우리가 조립한다).
    const u = typeof obj.url === 'string' ? obj.url : '';
    const m = /[?&]id=([A-Za-z0-9_-]{10,200})/.exec(u) || /\/d\/([A-Za-z0-9_-]{10,200})/.exec(u);
    id = m ? m[1] : '';
  }
  if (!ID_RE.test(id)) return null;

  if (!spec.path) {
    // 스크립트·사이트는 docs.google.com 이 아니다. 여는 주소를 확신할 수 없으면 만들지 않는다.
    return ext === 'gscript'
      ? { url: `https://script.google.com/d/${id}/edit`, docId: id, kind: spec.kind }
      : null;
  }
  return { url: `https://docs.google.com/${spec.path}/d/${id}/edit`, docId: id, kind: spec.kind };
}

module.exports = { isShortcutName, looksLikeShortcut, parseShortcut, MAX_BYTES };
