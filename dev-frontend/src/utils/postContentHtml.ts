// 문서 본문(TipTap `content_json`) → **정화된 HTML**.
//
// 왜 공용인가: 같은 변환이 문서 상세(components/Docs/PostsPage)와 무로그인 열람
//   (pages/Guest/GuestDocsTab)에 둘 다 필요하다. 각자 만들면 확장 목록이 갈라져
//   한쪽에서만 표가 사라지거나 링크가 죽는다(memory feedback_copied_component_drifts_extract_shell).
//
// 왜 편집기를 안 쓰나: 읽기 전용 화면에 TipTap 인스턴스를 띄우면 편집기 번들을 통째로 싣고
//   **편집 표면**이 생긴다. 무인증 게스트 화면에는 둘 다 줄 이유가 없다. headless 변환이면
//   확장 목록만 공유하면 된다.
//
// ★ 정화는 **DOM 에 넣을 때만** 한다(`postContentToSafeHtml`). 변환 결과를 서버로 보내는
//   호출부도 있어서(AI 재작성 base_html · 문서 템플릿 저장) 변환 단계에서 깎으면 서식이 사라진다
//   — DOMPurify 설정 하나로 align·width 가 전멸한 전례가 있다
//   (memory feedback_dompurify_uri_regexp_all_attrs). 두 단계를 섞지 않는다.
import { generateHTML } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { sanitizeRichText } from './sanitizeHtml';

/** 편집기와 **같은 확장 목록**. 여기서만 늘린다. */
const EXTENSIONS = [StarterKit, Link, Image, Table, TableRow, TableHeader, TableCell];

/**
 * 변환만 한다(정화 없음). 서버로 보낼 HTML 은 이 함수를 쓴다.
 * @returns 내용이 없거나 파싱에 실패하면 빈 문자열 — 호출부가 "본문 없음" 을 그릴 수 있게
 *   예외를 던지지 않는다.
 */
export function postContentToHtml(contentJson: unknown): string {
  if (!contentJson) return '';
  try {
    return generateHTML(contentJson as Record<string, unknown>, EXTENSIONS);
  } catch { return ''; }
}

/** 화면에 넣을 HTML — 변환 + 정화. `dangerouslySetInnerHTML` 에는 **이것만** 쓴다. */
export function postContentToSafeHtml(contentJson: unknown): string {
  const html = postContentToHtml(contentJson);
  return html ? sanitizeRichText(html) : '';
}
