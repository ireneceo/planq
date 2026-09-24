// 공개 문맥 이미지 토큰(`image_ctx`)을 본문 이미지 주소에 붙인다 — 이미지 보안 Stage 2b 1단계.
//   공유 링크·게스트 문서·서명 화면은 익명이 연다. 서버가 L2/L3 이미지를 막게 되면 이 화면들의 본문 이미지는
//   «이 문서 안에서» 라는 증명(`?ctx=`)이 있어야 열린다(서버 판정: dev-backend/services/imageCtx.js).
//   ★ 붙이는 곳은 이 파일 하나다 — 세 화면이 각자 정규식을 쓰면 한 곳만 빠진다.
//   ★ 우리 이미지 두 경로만 건드린다. 외부 이미지·다른 API 주소에는 토큰을 싣지 않는다(토큰이 밖으로 새지 않게).
// ★ 앞을 고정한다(`^/api/…`) — 고정하지 않으면 `https://남의호스트/api/posts/editor-image/x.png` 에도 붙어
//   보는 사람의 ctx 가 그 호스트로 간다(Fable 2026-09-24 실측). 우리 이미지는 늘 상대 경로다.
const IMG_RE = /^\/api\/(?:posts\/editor-image|files\/public-image)\/[^"'?#\s<>&]+/;

/** 주소 하나에 ctx 를 붙인다. 이미 ctx 가 있으면 그대로 둔다. */
export function withCtxUrl(src: string, ctx: string | null | undefined): string {
  if (!ctx || typeof src !== 'string' || !IMG_RE.test(src) || /[?&]ctx=/.test(src)) return src;
  return `${src}${src.includes('?') ? '&' : '?'}ctx=${encodeURIComponent(ctx)}`;
}

/** TipTap JSON — 모든 노드의 `attrs.src` 를 훑는다(이미지 노드 이름이 확장마다 다르다). 원본은 바꾸지 않는다. */
export function withImageCtxJson<T>(doc: T, ctx: string | null | undefined): T {
  if (!ctx || !doc || typeof doc !== 'object') return doc;
  const walk = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(walk);
    if (!n || typeof n !== 'object') return n;
    const o = n as Record<string, unknown>;
    const out: Record<string, unknown> = { ...o };
    if (o.attrs && typeof o.attrs === 'object') {
      const a = o.attrs as Record<string, unknown>;
      if (typeof a.src === 'string') out.attrs = { ...a, src: withCtxUrl(a.src, ctx) };
    }
    if (Array.isArray(o.content)) out.content = o.content.map(walk);
    return out;
  };
  return walk(doc) as T;
}

/** HTML 문자열 — `src="…"` 안의 우리 이미지 주소에만 붙인다. */
export function withImageCtxHtml(html: string | null | undefined, ctx: string | null | undefined): string {
  if (!html || !ctx) return html || '';
  return html.replace(/(\ssrc\s*=\s*)(["'])([^"']*)\2/gi, (m, pre: string, q: string, url: string) => {
    if (!IMG_RE.test(url) || /[?&](?:amp;)?ctx=/.test(url)) return m;
    const sep = url.includes('?') ? '&amp;' : '?';
    return `${pre}${q}${url}${sep}ctx=${encodeURIComponent(ctx)}${q}`;
  });
}
