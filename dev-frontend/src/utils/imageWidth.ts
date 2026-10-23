// 이미지 주소에 리사이즈 폭(?w=)을 붙인다 — 서버(services/imageResize)가 200/400/800/1024/1600 으로 스냅해 webp 로 준다.
// 미리보기·썸네일·확대 보기 첫 화면은 이것을 쓰고, 원본은 «원본 보기»·내려받기 때만(Irene 2026-10-23:
// "원본용량이 적용되는 건 그냥 다운로드할 때나 원본보기 확대할 때"). blob:·data: 주소는 이미 받은 바이트라 그대로 둔다.
export const withW = (u: string | undefined | null, w: number): string | undefined => {
  if (!u || u === '#') return undefined;
  if (/^(blob|data):/i.test(u)) return u;
  return `${u}${u.includes('?') ? '&' : '?'}w=${w}`;
};
