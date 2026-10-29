import { continueRender, delayRender, staticFile } from 'remotion';

const WEIGHTS: [string, number][] = [['Regular', 400], ['Medium', 500], ['SemiBold', 600], ['Bold', 700], ['ExtraBold', 800], ['Black', 900]];
let loaded = false;
export function loadFonts() {
  if (loaded || typeof document === 'undefined') return;
  loaded = true;
  const h = delayRender('fonts');
  Promise.all(WEIGHTS.map(([n, w]) => new FontFace('Pretendard', `url(${staticFile(`fonts/Pretendard-${n}.woff2`)}) format('woff2')`, { weight: String(w) })
    .load().then((f) => { (document.fonts as unknown as { add: (f: FontFace) => void }).add(f); })))
    .then(() => continueRender(h)).catch(() => continueRender(h));
}
export const FONT = "'Pretendard', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
