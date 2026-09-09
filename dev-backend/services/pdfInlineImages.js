// services/pdfInlineImages.js — PDF 렌더 직전, **우리 이미지만** data: URI 로 바꿔 넣는다.
//
// 왜 필요한가 (운영 신고 2026-09-09, Irene: "문서에서 다운로드 했는데 문서 안에 들어간
//   이미지는 하나도 안나와"):
//   두 수정이 서로를 무력화하고 있었다.
//     · `pdfTemplates.absolutizeSrc` — 상대경로를 loopback 절대주소로 바꾼다
//       ("에디터 이미지는 무인증 공개 라우트라 백엔드 자기 자신으로 부르면 된다")
//     · `pdfService.renderPdfFromHtml` — SSRF 차단으로 **data: 외 모든 요청을 abort** 한다
//       ("문서에 필요한 것은 data: URI 뿐이라 잃는 것이 없다" ← 이 전제가 틀렸다)
//   그래서 2026-09-02 이후 **모든 PDF 에서 에디터 이미지가 전부 사라졌다.**
//   운영 실측: 이미지 src 43개 중 38개가 `/api/posts/editor-image/…` (= 전부 누락),
//   나머지 5개는 외부 URL(images.openai.com)로 이것은 차단이 맞다.
//
// 설계
//   · 브라우저가 가져오게 하지 않는다 — **서버가 디스크에서 읽어** data: 로 심는다.
//     SSRF 차단은 그대로 둔다(요청이 아예 안 나가므로 차단과 충돌하지 않는다).
//   · 우리 것만 바꾼다. 외부 URL 은 손대지 않는다 → 종전대로 차단된다.
//   · 판정은 `services/editorImage.resolveEditorImage` **한 함수**를 쓴다 —
//     삭제된 이미지·대외비 이미지·이미지 아닌 MIME 은 여기서 걸러진다.
//     (이미 무인증으로 같은 바이트를 주는 라우트와 **완전히 같은 술어**다. 표면이 넓어지지 않는다.)
//   · 상한을 둔다 — data: 는 PDF HTML 안에 통째로 들어가므로 큰 이미지가 렌더를 죽인다.
const fs = require('fs').promises;
const { resolveEditorImage } = require('./editorImage');

const MAX_ONE = 6 * 1024 * 1024;    // 한 장 6MB
const MAX_TOTAL = 24 * 1024 * 1024; // 문서 전체 24MB

// src="…/api/posts/editor-image/<uuid>.<ext>" — 상대경로도, loopback 절대주소도 잡는다.
const SRC_RE = /(src\s*=\s*["'])([^"']*\/api\/posts\/editor-image\/([0-9a-fA-F-]+\.(?:png|jpe?g|gif|webp|svg)))(["'])/g;

/**
 * @returns {{ html: string, inlined: number, skipped: number, bytes: number }}
 *   숫자를 같이 돌려준다 — "0장 인라인" 과 "이미지가 원래 없다" 를 로그에서 구별하기 위해서다.
 */
async function inlineEditorImages(html) {
  const src = String(html || '');
  const matches = [...src.matchAll(SRC_RE)];
  if (!matches.length) return { html: src, inlined: 0, skipped: 0, bytes: 0 };

  const cache = new Map();   // filename → data URI | null (같은 이미지 반복 시 한 번만 읽는다)
  let bytes = 0;
  let inlined = 0;
  let skipped = 0;

  for (const m of matches) {
    const name = m[3];
    if (cache.has(name)) continue;
    try {
      const r = await resolveEditorImage(name);
      if (!r) { cache.set(name, null); skipped += 1; continue; }
      const buf = await fs.readFile(r.absPath);
      if (buf.length > MAX_ONE || bytes + buf.length > MAX_TOTAL) {
        cache.set(name, null); skipped += 1; continue;
      }
      bytes += buf.length;
      cache.set(name, `data:${r.mime};base64,${buf.toString('base64')}`);
      inlined += 1;
    } catch (e) {
      cache.set(name, null);
      skipped += 1;
    }
  }

  const out = src.replace(SRC_RE, (whole, pre, _url, name, post) => {
    const uri = cache.get(name);
    return uri ? `${pre}${uri}${post}` : whole;   // 못 넣은 것은 원본 그대로(그리고 종전대로 차단된다)
  });
  return { html: out, inlined, skipped, bytes };
}

module.exports = { inlineEditorImages };
