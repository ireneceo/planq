// 웹·노션·워드에서 «글+그림+영상» 을 한꺼번에 복사해 붙일 때 — 두 편집기(PostEditor·RichEditor)가 같이 쓴다.
//
// ★ 2026-11-04 Irene: *"웹에서 복사하면 영상 이미지 모두 다같이 복사한 거 붙이기도 되게 못해?"*
//   그때까지 일어나던 일(계획 .claude/plans/qmw1w6j26.md):
//   1. 클립보드에 그림 파일(image/*)이 하나라도 있으면 **글을 통째로 버리고** 그림 1장만 넣었다
//      (사파리·워드·일부 웹은 text/html 과 image/png 를 같이 싣는다). → `htmlCarriesContent` 로 html 우선.
//   2. 블로그·뉴스의 지연 로딩 그림은 src 가 1×1 자리표시자고 진짜 주소는 data-src·srcset 에 있다 →
//      점 하나가 붙었다. → `prepPastedHtml` 이 진짜 주소로 끌어올린다.
//   3. <iframe>·<video> 는 편집기 스키마에 없어 **조용히 사라졌다.** → 원래 주소의 링크 문단으로 남긴다
//      (문서 안 플레이어로 넣는 것은 CSP·정화 허용목록을 넓히는 일이라 따로 설계한다).
//   두 편집기가 따로 복붙하던 data: 그림 업로드 치환도 여기 한 벌(`uploadDataImages`)로 모았다.

const LAZY_ATTRS = ['data-src', 'data-lazy-src', 'data-original', 'data-lazy', 'data-url', 'data-actualsrc'];
// 1×1 자리표시자 data: 그림 — 디코드해도 이 크기보다 작다(투명 gif 는 43B). 진짜 붙여넣은 그림은 이보다 훨씬 크다.
const PLACEHOLDER_DATA_MAX = 200;

function tinyData(src: string): boolean {
  if (!/^data:/i.test(src)) return false;
  const comma = src.indexOf(',');
  const payload = comma >= 0 ? src.slice(comma + 1) : '';
  // base64 디코드 길이 ≈ 3/4. svg 자리표시자(평문)도 짧다.
  const approxBytes = /;base64,/i.test(src) ? Math.floor(payload.length * 0.75) : payload.length;
  return approxBytes < PLACEHOLDER_DATA_MAX;
}
/** 진짜 주소가 따로 있으면 갈아 끼울 자리 — 비었거나 작은 data: */
function swappable(src: string): boolean { return !src || tinyData(src); }
/** 그 자체로 버릴 자리표시자 — 작은 gif·svg(투명 간격 그림). 작은 png 아이콘은 진짜 그림일 수 있어 남긴다 */
function isPlaceholderSrc(src: string): boolean {
  return !src || (tinyData(src) && /^data:image\/(gif|svg)/i.test(src));
}

function firstSrcsetUrl(srcset: string | null): string {
  if (!srcset) return '';
  // 가장 큰 후보(마지막)가 원본에 가깝다. "url 640w, url 1280w"
  const parts = srcset.split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean);
  return parts[parts.length - 1] || '';
}

function absolutize(url: string, base: string): string {
  try { return base ? new URL(url, base).href : url; } catch { return url; }
}

/** 붙여넣은 영상 주소 → 사람이 눌러 볼 주소(유튜브 embed 는 watch 로). http(s) 가 아니면 '' */
export function videoLinkFromSrc(src: string): string {
  let u: URL;
  try { u = new URL(src); } catch { return ''; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
  const host = u.hostname.replace(/^www\./, '');
  const yt = u.pathname.match(/^\/embed\/([A-Za-z0-9_-]{6,})/);
  if (yt && /(^|\.)youtube(-nocookie)?\.com$/.test(host)) return `https://www.youtube.com/watch?v=${yt[1]}`;
  const vimeo = u.pathname.match(/^\/video\/(\d+)/);
  if (vimeo && host === 'player.vimeo.com') return `https://vimeo.com/${vimeo[1]}`;
  return u.href;
}

/**
 * 붙여넣은 html 을 편집기가 받을 수 있게 다듬는다 — transformPastedHTML 과 data: 업로드 경로가 같이 부른다.
 *  - 지연 로딩 그림: src 가 비었거나 자리표시자면 data-src·srcset 의 진짜 주소로
 *  - 못 여는 그림(file:·남의 blob:·자리표시자만 남은 것)은 뺀다 — 깨진 그림 칸만 남기 때문
 *  - iframe·video·embed → 원래 주소 링크 문단(사라지지 않게)
 */
export function prepPastedHtml(html: string): string {
  if (!html || !/<(img|iframe|video|embed|object)\b/i.test(html)) return html;
  let doc: Document;
  try { doc = new DOMParser().parseFromString(html, 'text/html'); } catch { return html; }
  // 복사한 페이지 주소(크롬은 <base> 를 싣지 않지만 일부 앱은 싣는다) — 상대 주소를 풀 때만 쓴다
  const base = doc.querySelector('base[href]')?.getAttribute('href') || '';

  doc.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') || '';
    if (swappable(src)) {
      const lazy = LAZY_ATTRS.map((a) => img.getAttribute(a) || '').find((v) => v && !swappable(v))
        || firstSrcsetUrl(img.getAttribute('data-srcset') || img.getAttribute('srcset'));
      if (lazy) img.setAttribute('src', absolutize(lazy, base));
    }
    const finalSrc = img.getAttribute('src') || '';
    if (isPlaceholderSrc(finalSrc) || /^(file|blob|about|chrome|ms-appx|x-apple)/i.test(finalSrc)) img.remove();
  });

  doc.querySelectorAll('iframe, video, embed, object').forEach((el) => {
    const raw = el.getAttribute('src') || el.getAttribute('data-src') || el.getAttribute('data')
      || el.querySelector('source[src]')?.getAttribute('src') || '';
    const href = raw ? videoLinkFromSrc(absolutize(raw, base)) : '';
    if (!href) { el.remove(); return; }
    const p = doc.createElement('p');
    const a = doc.createElement('a');
    a.setAttribute('href', href);
    a.textContent = href;
    p.appendChild(a);
    el.replaceWith(p);
  });
  return doc.body.innerHTML;
}

/**
 * html 에 «그림 한 장» 보다 많은 것이 있나 — 있으면 클립보드의 그림 파일보다 html 을 따른다.
 * 그림 하나만 복사(우클릭 › 이미지 복사)하면 html 은 <img> 하나뿐이라 파일 경로가 그대로 탄다.
 */
export function htmlCarriesContent(html: string): boolean {
  if (!html) return false;
  let doc: Document;
  try { doc = new DOMParser().parseFromString(html, 'text/html'); } catch { return false; }
  const text = (doc.body.textContent || '').replace(/\s+/g, '');
  if (text.length > 0) return true;
  if (doc.body.querySelectorAll('img').length >= 2) return true;
  return !!doc.body.querySelector('iframe, video, table, ul, ol, hr');
}

/**
 * data: 주소 → Blob. ★ fetch(dataUrl) 를 쓰지 않는다 — CSP connect-src 에 data: 가 없어 **조용히 막힌다**
 * (2026-11-04 실측 «Failed to fetch»). 그래서 운영 #342 의 «붙여넣은 그림 올리기» 가 늘 0장이었고
 * 글만 남았다. 연결 정책을 넓히지 않고 여기서 직접 푼다.
 */
function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const mime = (dataUrl.slice(5, comma).split(';')[0] || 'image/png').toLowerCase();
  const bin = atob(dataUrl.slice(comma + 1).replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** html 안 data: 그림을 올려 주소로 바꾼다. 올린 것이 0장이면 replaced=0 (부르는 쪽이 종전 동작으로) */
export async function uploadDataImages(
  html: string,
  upload: (file: File) => Promise<string | null>,
): Promise<{ html: string; replaced: number; found: number }> {
  let doc: Document;
  try { doc = new DOMParser().parseFromString(html, 'text/html'); } catch { return { html, replaced: 0, found: 0 }; }
  const imgs = Array.from(doc.querySelectorAll('img')).filter((img) => /^data:image\/[a-z0-9.+-]+;base64,/i.test(img.getAttribute('src') || ''));
  const done = new Map<string, string>();   // 같은 data URL 이 여러 번 나오면 한 번만 올린다
  let replaced = 0;
  for (const [i, img] of imgs.entries()) {
    const dataUrl = img.getAttribute('src') || '';
    try {
      let url = done.get(dataUrl);
      if (!url) {
        const blob = dataUrlToBlob(dataUrl);
        const ext = (blob.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '');
        url = (await upload(new File([blob], `pasted-${i + 1}.${ext}`, { type: blob.type }))) || undefined;
        if (!url) continue;
        done.set(dataUrl, url);
      }
      img.setAttribute('src', url);
      replaced += 1;
    } catch { /* 이 한 장만 건너뛴다 — 나머지는 살린다 */ }
  }
  return { html: doc.body.innerHTML, replaced, found: imgs.length };
}

export function hasDataImage(html: string): boolean {
  return /<img\b[^>]*?\bsrc\s*=\s*["']data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(html);
}
