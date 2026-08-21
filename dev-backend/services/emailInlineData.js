// services/emailInlineData.js — 메일 본문에 박힌 base64 이미지를 응답에서 떼어낸다.
//
// 왜 필요한가 (2026-08-19 실측)
//   메일 본문의 97~100% 가 `data:image/...;base64,...` 덩어리다. dev 3,968건 중 2,363건(60%)이
//   그렇고, 한 메시지가 1.8MB, 한 스레드가 2MB, 운영 최대 메시지는 8MB 다.
//   상세 API 는 **스레드의 모든 메시지 본문**을 한 번에 내려주므로, 사용자가 최신 한 통만 읽어도
//   접힌 메시지의 이미지까지 전부 회선을 탄다. 이것이 "리스트 클릭하면 상세가 느려 터진다" 의 실체다.
//   gzip 도 소용없다 — 이미 압축된 JPEG 를 base64 로 부풀린 것이라 27%밖에 안 줄었다(실측).
//
// 어떻게
//   내려보내는 순간에만 `data:` URI 를 `cid:planq-embed-N` 으로 바꾸고, 실제 바이트는 별도
//   엔드포인트로 뺀다. **DB 의 body_html 은 한 글자도 바꾸지 않는다** — 권위 데이터라 변형 저장 금지.
//   프론트는 이미 cid 이미지를 "펼친 메시지만" 받아오는 경로(useInlineCidImages)를 갖고 있어,
//   그 경로에 그대로 얹으면 접힌 메시지의 이미지는 애초에 요청되지 않는다.
'use strict';

// data:{mime};base64,{payload} — 따옴표/괄호 앞까지가 payload.
const DATA_URI_RE = /data:([a-zA-Z0-9/.+-]+);base64,([A-Za-z0-9+/=\s]+)/g;

/** base64 길이 → 실제 바이트 수 (패딩 고려). */
function decodedSize(b64) {
  const clean = b64.replace(/\s+/g, '');
  const pad = (clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0);
  return Math.max(0, Math.floor(clean.length * 3 / 4) - pad);
}

/**
 * 본문에서 base64 **이미지**만 떼어낸다.
 *   - 이미지가 아닌 data URI(폰트·pdf 등)는 건드리지 않는다 — 화면에 필요한 것만 다룬다.
 *   - 너무 작은 것(4KB 미만)은 그대로 둔다: 왕복 비용이 절약분보다 크고, 아이콘·스페이서가 대부분이다.
 * @returns {{ html: string, embedded: Array<{ index:number, content_id:string, mime_type:string, size_bytes:number }> }}
 */
function stripEmbeddedImages(html, { minBytes = 4096 } = {}) {
  const src = String(html || '');
  if (!src.includes('base64,')) return { html: src, embedded: [] };
  const embedded = [];
  let idx = 0;
  const out = src.replace(DATA_URI_RE, (whole, mime, payload) => {
    if (!/^image\//i.test(mime)) return whole;
    const size = decodedSize(payload);
    if (size < minBytes) return whole;
    const i = idx++;
    const cid = `planq-embed-${i}`;
    embedded.push({ index: i, content_id: cid, mime_type: mime, size_bytes: size });
    return `cid:${cid}`;
  });
  return { html: out, embedded };
}

/**
 * N 번째 base64 이미지의 실제 바이트를 꺼낸다.
 * ★ 인덱스는 stripEmbeddedImages 와 **같은 순회 규칙**(같은 정규식·같은 필터)으로 세야 한다.
 *   한쪽만 조건이 달라지면 화면이 엉뚱한 이미지를 받는다 — 두 함수를 같이 고칠 것.
 */
function extractEmbeddedImage(html, wantIndex, { minBytes = 4096 } = {}) {
  const src = String(html || '');
  let idx = 0;
  let m;
  DATA_URI_RE.lastIndex = 0;
  while ((m = DATA_URI_RE.exec(src)) !== null) {
    const [, mime, payload] = m;
    if (!/^image\//i.test(mime)) continue;
    const size = decodedSize(payload);
    if (size < minBytes) continue;
    if (idx === Number(wantIndex)) {
      return { mime, buffer: Buffer.from(payload.replace(/\s+/g, ''), 'base64') };
    }
    idx += 1;
  }
  return null;
}

/**
 * stripEmbeddedImages 로 떼어낸 자리표시자를 **원본 데이터로 되돌린다.**
 *
 * 왜 필요한가: 스레드 상세 응답은 base64 이미지를 `cid:planq-embed-N` 으로 바꿔 내려준다(응답 크기).
 *   화면은 실제 바이트를 따로 받아 보여주므로 사용자는 이미지를 본다.
 *   그런데 **전달·답장은 그 자리표시자가 든 본문을 그대로 되돌려 보낸다.**
 *   받는 쪽에는 존재하지 않는 cid 라 이미지가 통째로 사라진다 —
 *   본문의 대부분이 이미지인 메일(뉴스레터·스크린샷)은 "내용이 없어진" 것으로 보인다.
 *   운영 신고 2026-08-21: "이메일 전달기능이 제대로 작동 안해. 이상하게 내용이 없어져."
 *
 * ★ 인덱스 규칙은 stripEmbeddedImages / extractEmbeddedImage 와 **반드시 같아야** 한다.
 *   (같은 정규식·같은 minBytes·같은 image/ 필터) — 하나만 달라지면 엉뚱한 이미지가 박힌다.
 */
function restoreEmbeddedImages(html, sourceHtml, { minBytes = 4096 } = {}) {
  const src = String(html || '');
  if (!src.includes('cid:planq-embed-')) return src;
  return src.replace(/cid:planq-embed-(\d+)/g, (whole, n) => {
    const got = extractEmbeddedImage(sourceHtml, Number(n), { minBytes });
    if (!got) return whole;      // 원본을 못 찾으면 손대지 않는다 (깨진 문자열을 만들지 않는다)
    return `data:${got.mime};base64,${got.buffer.toString('base64')}`;
  });
}

module.exports = { stripEmbeddedImages, extractEmbeddedImage, restoreEmbeddedImages, decodedSize };
