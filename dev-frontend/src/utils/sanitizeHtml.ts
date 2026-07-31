// 사용자 작성 리치텍스트를 화면에 렌더하기 전 정화 — 단일 원천.
//
// 공개 페이지(로그인 없이 링크로 열리는 문서·업무·청구서)는 특히 중요하다.
// 여태 PublicKbDocumentPage / PublicKbBundlePage 가 dangerouslySetInnerHTML 에 원문을 그대로
// 넣고 있었다 (script/onerror 가 그대로 실행될 수 있는 상태). 새로 만드는 화면이 그 패턴을
// 베끼지 않도록 여기로 모은다.
import DOMPurify from 'dompurify';

// 리치에디터(RichEditor)가 실제로 만드는 태그만 허용
const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'code', 'pre', 'blockquote',
  'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'a', 'img', 'hr',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span',
];
const ALLOWED_ATTR = ['href', 'target', 'rel', 'src', 'alt', 'title', 'class', 'colspan', 'rowspan'];

// ★ #226 — DOMPurify 는 **URI 속성만이 아니라 모든 속성 값**을 이 정규식으로 검사한다.
//   그래서 스킴 목록만 나열한 옛 정규식은 `align="center"`·`width="600"`·`colspan="2"` 처럼
//   URI 가 아닌 평범한 값까지 통째로 지웠다(실측: 운영 메일 1통에서 align 5·width 11 전멸).
//   메일은 20년째 table 레이아웃 + presentational 속성으로 짜이므로, 그게 지워지면 가운데 정렬이
//   풀려 왼쪽으로 쏠리고 고정폭 박스가 무너진다 — 사용자 보고 #226 의 증상 그대로다.
//   뒤 두 대안(`[^a-z]` · 스킴 없는 토큰)은 DOMPurify 기본 정규식에서 그대로 가져온 것으로
//   "스킴이 아닌 값" 을 통과시킨다. 위험 스킴(javascript: 등)은 여전히 어느 대안에도 안 걸려 차단된다.
//   ★ 두 정화기의 허용 스킴은 **다르다** — 메일만 cid:(첨부 인라인 이미지)를 쓴다. 상수를 통째로
//     공유하면 리치텍스트에 cid: 가 딸려 들어가므로(무해하지만 범위 밖 확대), 스킴 부분만 갈라 둔다.
const NON_URI_VALUE = '[^a-z]|[a-z+.\\-]+(?:[^a-z+.\\-:]|$)';
const RICH_URI_RE = new RegExp(`^(?:https?:|mailto:|tel:|/|#|data:image/|${NON_URI_VALUE})`, 'i');
const MAIL_URI_RE = new RegExp(`^(?:https?:|mailto:|tel:|cid:|/|#|data:image/|${NON_URI_VALUE})`, 'i');

/**
 * 평문이면 <p>+<br> 로 감싸고, 이미 HTML 이면 그대로 돌려준다.
 * #219 — 리치텍스트 에디터는 평문의 개행을 무시하고 한 문단으로 합쳐버린다.
 *   읽기 화면(pre-wrap)에선 멀쩡하다가 편집으로 바꾸는 순간 줄이 사라지는 이유.
 *   에디터에 넣기 전 이 함수로 한 번 통과시킨다(정화기를 태우면 taskList 의 data-type 이 날아간다).
 */
export function plainTextToHtml(value: string | null | undefined): string {
  if (!value) return '';
  if (/<[a-z][\s\S]*>/i.test(value)) return value;
  const esc = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.split(/\n{2,}/).map((para) => `<p>${para.replace(/\n/g, '<br/>')}</p>`).join('');
}

/** 리치텍스트 HTML 정화. 평문이면 <p>+<br> 로 감싼다. */
export function sanitizeRichText(value: string | null | undefined): string {
  if (!value) return '';
  const html = plainTextToHtml(value);
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // javascript:, data: 등 위험 스킴 차단 (이미지 data: 는 인라인 붙여넣기에 쓰이므로 허용)
    ALLOWED_URI_REGEXP: RICH_URI_RE,
  });
}

// 받은 메일 본문 정화 — 뉴스레터·거래 메일은 우리가 쓰는 리치텍스트와 완전히 다른 물건이다.
//   <style> 블록 + table 레이아웃 + body bgcolor 로 짜여 있고, 그걸 지우면 가운데 정렬이 풀리고
//   배경이 사라지고 여백이 잘린다(실제 증상). 그래서 여기서는 **문서를 통째로** 살린다:
//     - DOMPurify 기본 허용집합 + <style> 허용 (DOMPurify 가 CSS 도 정화한다)
//     - WHOLE_DOCUMENT: html/head/body 구조와 body 속성(bgcolor 등) 보존
//     - script·on* 핸들러·iframe·form·object 는 제거
//   위험하지 않은 이유: 결과는 sandbox iframe(allow-scripts 만, same-origin 없음) 안에서만 렌더된다.
//   부모 DOM·쿠키·스토리지에 접근할 수 없다. 스크립트는 우리가 넣는 높이 보고용 한 줄뿐이다.
export function sanitizeMailHtml(value: string | null | undefined): string {
  if (!value) return '';
  return DOMPurify.sanitize(value, {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ['style'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'base'],
    FORBID_ATTR: ['srcdoc', 'formaction'],
    ALLOWED_URI_REGEXP: MAIL_URI_RE,
  });
}
