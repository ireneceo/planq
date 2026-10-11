// 문서 편집기 글자색·배경색·크기 (2026-10-11) — 문서 본문과 문서 안 표가 같은 서식을 쓴다.
//   Irene: "표에는 에디터가 왜 안돼? 글자들 색상 굵기 크기 조정이 안되는데?"
//   ★ 확장 목록은 보기 변환(utils/postContentHtml)에도 **같이** 들어가야 한다 — 빠지면 generateHTML 이
//     모르는 mark 에서 throw 해 게스트 보기·AI 기준 HTML 이 **빈 문서**가 된다.
import type { Editor } from '@tiptap/core';
import { TextStyle, Color, BackgroundColor, FontSize } from '@tiptap/extension-text-style';
import { TEXT_COLORS, HIGHLIGHTS, FONT_SIZES, type PaletteItem } from './textStylePalette';
import type { TextStyleKeys } from './TextStyleButton';

export const textStyleExtensions = [TextStyle, Color, BackgroundColor, FontSize];

const norm = (v: unknown) => String(v || '').replace(/\s+/g, '').toLowerCase();
const keyOf = (list: PaletteItem[], v: unknown, dflt: string) =>
  (v ? list.find((p) => p.value && norm(p.value) === norm(v))?.key : null) || dflt;

/** 지금 선택 위치의 서식을 팔레트 key 로 — 버튼에 «지금 무엇이 걸렸나» 를 보여 준다 */
export function currentTextStyleKeys(editor: Editor): TextStyleKeys {
  const a = editor.getAttributes('textStyle') || {};
  return {
    color: keyOf(TEXT_COLORS, a.color, 'default'),
    bg: keyOf(HIGHLIGHTS, a.backgroundColor, 'none'),
    size: keyOf(FONT_SIZES, a.fontSize, 'normal'),
  };
}

export function applyTextStyle(editor: Editor, kind: 'color' | 'bg' | 'size', item: PaletteItem) {
  const c = editor.chain().focus();
  if (kind === 'color') (item.value ? c.setColor(item.value) : c.unsetColor()).run();
  else if (kind === 'bg') (item.value ? c.setBackgroundColor(item.value) : c.unsetBackgroundColor()).run();
  else (item.value ? c.setFontSize(item.value) : c.unsetFontSize()).run();
}

/** 바깥(웹·워드)에서 붙여 넣은 글의 색·크기·배경은 걷는다 — 다크모드 흰 글자·11pt 같은 것이 문서에 박히지 않게.
 *  우리 편집기에서 복사한 것(ProseMirror 가 data-pm-slice 를 붙인다)은 그대로 둔다. */
export function stripForeignTextStyle(html: string): string {
  if (!html || html.includes('data-pm-slice')) return html;
  return html.replace(/style="([^"]*)"/gi, (_m, css: string) => {
    const kept = css.split(';').filter((d) => !/^\s*(color|background(-color)?|font-size)\s*:/i.test(d)).join(';');
    return kept.trim() ? `style="${kept}"` : '';
  });
}
