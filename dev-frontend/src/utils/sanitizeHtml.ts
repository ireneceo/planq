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

/** 리치텍스트 HTML 정화. 평문이면 <p>+<br> 로 감싼다. */
export function sanitizeRichText(value: string | null | undefined): string {
  if (!value) return '';
  const looksHtml = /<[a-z][\s\S]*>/i.test(value);
  const html = looksHtml
    ? value
    : `<p>${value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')}</p>`;
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // javascript:, data: 등 위험 스킴 차단 (이미지 data: 는 인라인 붙여넣기에 쓰이므로 허용)
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|\/|#|data:image\/)/i,
  });
}

// 받은 메일 본문 정화 — 뉴스레터/서명은 리치텍스트보다 태그·속성이 넓다(table 레이아웃, 인라인 style).
// script·on* 핸들러·iframe·form 은 DOMPurify 가 제거한다. 정화한 뒤 sandbox iframe 안에 넣으므로
// (allow-scripts 만, same-origin 없음) 스타일이 살아 있어도 우리 화면을 건드리지 못한다.
const MAIL_TAGS = [
  ...ALLOWED_TAGS,
  'div', 'center', 'font', 'small', 'big', 'sub', 'sup', 'dl', 'dt', 'dd', 'caption',
  'col', 'colgroup', 'tfoot', 'figure', 'figcaption', 'address', 'h5', 'h6',
];
const MAIL_ATTR = [
  ...ALLOWED_ATTR,
  'style', 'width', 'height', 'align', 'valign', 'bgcolor', 'color', 'border',
  'cellpadding', 'cellspacing', 'size', 'face', 'srcset', 'id',
];

/** 받은 메일 본문(HTML) 정화. sandbox iframe 안에서 표시하는 것을 전제로 한다. */
export function sanitizeMailHtml(value: string | null | undefined): string {
  if (!value) return '';
  return DOMPurify.sanitize(value, {
    ALLOWED_TAGS: MAIL_TAGS,
    ALLOWED_ATTR: MAIL_ATTR,
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'link', 'meta', 'base'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|cid:|\/|#|data:image\/)/i,
  });
}
