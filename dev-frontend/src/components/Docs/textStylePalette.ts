// 글자 서식 팔레트 — 문서 편집기(문서 안 표 포함)와 표 문서 칸이 **같은 색·크기**를 쓴다 (2026-10-11)
//   Irene: "표에는 에디터가 왜 안돼? 글자들 색상 굵기 크기 조정이 안되는데? … 문서 안의 표, 표 형식 문서의 표. 어느 것이든 다 같이"
//   한쪽에만 색을 더하면 같은 «빨강» 이 두 곳에서 다른 색이 된다 — 값은 여기 한 곳.
//   ★ 서버 변환(PDF·워드)은 이 값을 모양(#hex · Nem)으로만 받아들인다. 여기 없는 모양을 넣으면 내보내기에서 빠진다.

export interface PaletteItem { key: string; value: string | null; tk: string }   // 이름은 locales qdocs editor.style.*

export const TEXT_COLORS: PaletteItem[] = [
  { key: 'default', value: null,      tk: 'editor.style.color.default' },
  { key: 'gray',    value: '#64748B', tk: 'editor.style.color.gray' },
  { key: 'red',     value: '#DC2626', tk: 'editor.style.color.red' },
  { key: 'orange',  value: '#EA580C', tk: 'editor.style.color.orange' },
  { key: 'green',   value: '#16A34A', tk: 'editor.style.color.green' },
  { key: 'blue',    value: '#2563EB', tk: 'editor.style.color.blue' },
  { key: 'purple',  value: '#9333EA', tk: 'editor.style.color.purple' },
];

export const HIGHLIGHTS: PaletteItem[] = [
  { key: 'none',   value: null,      tk: 'editor.style.bg.none' },
  { key: 'yellow', value: '#FEF08A', tk: 'editor.style.bg.yellow' },
  { key: 'green',  value: '#BBF7D0', tk: 'editor.style.bg.green' },
  { key: 'blue',   value: '#BFDBFE', tk: 'editor.style.bg.blue' },
  { key: 'pink',   value: '#FBCFE8', tk: 'editor.style.bg.pink' },
  { key: 'gray',   value: '#E2E8F0', tk: 'editor.style.bg.gray' },
];

export const FONT_SIZES: PaletteItem[] = [
  { key: 'small',  value: '0.875em', tk: 'editor.style.size.small' },
  { key: 'normal', value: null,      tk: 'editor.style.size.normal' },
  { key: 'large',  value: '1.25em',  tk: 'editor.style.size.large' },
  { key: 'xlarge', value: '1.5em',   tk: 'editor.style.size.xlarge' },
];

const byKey = (list: PaletteItem[], key?: string | null) => list.find((p) => p.key === key) || null;
export const colorOf = (key?: string | null) => byKey(TEXT_COLORS, key)?.value ?? null;
export const highlightOf = (key?: string | null) => byKey(HIGHLIGHTS, key)?.value ?? null;
export const sizeOf = (key?: string | null) => byKey(FONT_SIZES, key)?.value ?? null;
