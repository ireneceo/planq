// services/fontScale.ts — 글씨 크기 배율 단일 착지점 (2026-08-30)
//
// 앱 전체 font-size 는 rem 이고, 루트 크기는 index.css 의
//   html { font-size: calc(16px * var(--planq-font-scale, 1)) }
// 하나로 정해진다. 여기서 그 변수만 바꾼다 — 화면마다 따로 계산하면 반드시 갈라진다.
//
// 저장은 **기기별**(localStorage) 이다. 폰과 데스크탑은 필요한 크기가 다르므로 계정에
// 묶지 않는다(계정 동기화는 이 값에 대해 틀린 의미론이다).
//
// 여백·아이콘은 커지지 않는다 — 의도된 것이다. 그것까지 키우는 것은 화면 확대(zoom)이고,
// 좁은 폰에서 유효 가로폭을 깎아 레이아웃을 무너뜨린다.

export const FONT_SCALES = [1, 1.15, 1.3] as const;
export type FontScale = (typeof FONT_SCALES)[number];

const KEY = 'planq_font_scale';
const DEFAULT: FontScale = 1;

function coerce(v: unknown): FontScale {
  const n = Number(v);
  return (FONT_SCALES as readonly number[]).includes(n) ? (n as FontScale) : DEFAULT;
}

export function getFontScale(): FontScale {
  try { return coerce(localStorage.getItem(KEY)); } catch { return DEFAULT; }
}

/** 배율 적용 — CSS 변수 하나만 건드린다. */
export function applyFontScale(scale: FontScale): void {
  const s = coerce(scale);
  try { document.documentElement.style.setProperty('--planq-font-scale', String(s)); } catch { /* 무시 */ }
}

export function setFontScale(scale: FontScale): void {
  const s = coerce(scale);
  try { localStorage.setItem(KEY, String(s)); } catch { /* 사생활 모드 등 — 이번 세션만 적용 */ }
  applyFontScale(s);
  // 같은 탭의 설정 화면들이 즉시 서로를 따라가게 (다른 탭은 storage 이벤트가 담당).
  window.dispatchEvent(new CustomEvent('planq:font-scale', { detail: { scale: s } }));
}

/** 부팅 시 1회 — 저장값을 화면에 반영한다. 값이 없으면 기본 1(무변경). */
export function initFontScale(): void {
  applyFontScale(getFontScale());
  // 다른 탭/창에서 바꾸면 따라간다 (같은 기기 안에서는 한 값으로 보여야 한다).
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) applyFontScale(coerce(e.newValue));
  });
}
