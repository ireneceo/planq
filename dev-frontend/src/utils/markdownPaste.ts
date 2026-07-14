/**
 * markdownPaste — 붙여넣은 마크다운을 서식 있는 HTML 로 바꾼다 (#151).
 *
 * 왜 필요한가:
 *   TipTap(StarterKit)의 마크다운 input rule 은 **타이핑할 때만** 발동한다(`# ` 를 치면 제목이 됨).
 *   붙여넣기는 그 경로를 타지 않아서, ChatGPT 답변 같은 마크다운을 붙이면 `# 제목`·파이프 표가
 *   전부 평문 한 덩어리로 들어갔다. 파이프 표는 input rule 자체가 없어 타이핑으로도 안 된다.
 *
 * 설계:
 *   - text/plain 이 **마크다운으로 보일 때만** 변환한다. 평범한 문장을 붙였는데 멋대로 서식이
 *     붙으면 그게 더 나쁘다 — 확실한 신호(제목·표·목록·코드펜스·인용·굵게)가 있을 때만 손댄다.
 *   - 붙여넣기가 HTML(text/html)을 함께 들고 오면 그건 이미 서식이 있으므로 건드리지 않는다
 *     (워드·구글독스·웹페이지 복사 — ProseMirror 기본 파서가 더 정확하다).
 *   - 변환 결과는 sanitizeRichText 를 통과시킨다 → 붙여넣기가 새 XSS 입구가 되지 않는다.
 *     (허용 태그에 table 계열이 이미 있다.)
 */
import { marked } from 'marked';
import { sanitizeRichText } from './sanitizeHtml';

/** 마크다운이라고 확신할 수 있는 신호. 하나라도 있으면 변환한다. */
const SIGNALS: RegExp[] = [
  /^\s{0,3}#{1,6}\s+\S/m,            // # 제목
  /^\s*\|.*\|\s*$[\r\n]+\s*\|[\s:|-]+\|\s*$/m, // 파이프 표 (헤더 + 구분선)
  /^\s{0,3}```/m,                    // 코드 펜스
  /^\s{0,3}>\s+\S/m,                 // > 인용
  /^\s{0,3}[-*+]\s+\S/m,             // - 목록
  /^\s{0,3}\d+\.\s+\S/m,             // 1. 번호 목록
  /\*\*[^*\n]+\*\*/,                 // **굵게**
  /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/m, // --- 구분선
];

export function looksLikeMarkdown(text: string): boolean {
  if (!text || text.length < 3) return false;
  return SIGNALS.some((re) => re.test(text));
}

/** 마크다운 → 정화된 HTML. 마크다운이 아니면 null (호출부가 기본 붙여넣기로 넘긴다). */
export function markdownToHtml(text: string): string | null {
  if (!looksLikeMarkdown(text)) return null;
  try {
    const html = marked.parse(text, { gfm: true, breaks: true, async: false }) as string;
    const clean = sanitizeRichText(html);
    return clean || null;
  } catch {
    return null;   // 파싱 실패 시 평문 그대로 (기본 동작)
  }
}

/**
 * TipTap editorProps 에 얹는 붙여넣기 핸들러.
 * true 를 돌려주면 "내가 처리했다" — ProseMirror 기본 파서로 넘어가지 않는다.
 */
export function handleMarkdownPaste(view: {
  pasteHTML: (html: string) => boolean;
}, event: ClipboardEvent): boolean {
  const cb = event.clipboardData;
  if (!cb) return false;
  // 서식 있는 HTML 을 들고 온 붙여넣기는 기본 파서가 처리하는 게 정확하다
  if (cb.getData('text/html')) return false;
  const text = cb.getData('text/plain');
  const html = markdownToHtml(text);
  if (!html) return false;
  event.preventDefault();
  return view.pasteHTML(html);
}
