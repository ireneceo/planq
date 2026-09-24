// utils/redactUrl.js — 로그에 남기는 요청 주소에서 **열쇠**를 가린다.
//
// 공개 링크는 주소 자체가 열쇠다(공유 토큰·게스트 토큰·서명 토큰·저장 파일명·image_ctx).
// 2026-09-24 실측 — 운영 오류 로그(pino)에 `/api/posts/public/<공유 토큰>/pdf` 가 통째로 남았고,
// 로그를 읽는 사람(운영자·로그 수집기·도구)이 그 문서를 열 수 있었다. 경로만 남겨도 원인 추적에는 충분하다.
//   · 경로 조각: 16자 이상이고 영숫자·`-_.` 로만 된 것(토큰·UUID 파일명·해시) → `:redacted`
//   · 쿼리: 값을 전부 가리고 **키 이름만** 남긴다(`?ctx=…&w=…` → `?ctx=*&w=*`)
// 짧은 숫자 id(`/posts/76/pdf`)는 남긴다 — 그것은 열쇠가 아니고, 없으면 무엇이 깨졌는지 모른다.
function redactUrl(url) {
  try {
    const s = String(url || '');
    const q = s.indexOf('?');
    const pathPart = q >= 0 ? s.slice(0, q) : s;
    const query = q >= 0 ? s.slice(q + 1) : '';
    const p = pathPart.split('/').map((seg) => (seg.length >= 16 && /^[A-Za-z0-9._~-]+$/.test(seg) ? ':redacted' : seg)).join('/');
    if (!query) return p;
    const keys = query.split('&').filter(Boolean).map((kv) => `${kv.split('=')[0].slice(0, 32)}=*`);
    return `${p}?${keys.join('&')}`;
  } catch {
    return '?';
  }
}

module.exports = { redactUrl };
