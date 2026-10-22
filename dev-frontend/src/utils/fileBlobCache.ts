// fileBlobCache — 미리보기(PDF·문서·zip)로 한 번 받은 파일을 화면 안에 기억한다.
//
// ★ 2026-10-22 (Irene: "미리보기가 … 다시 열어도 다시 늦게 뜨네? 한번 뜬 건 빨리뜨게라도 되지 않아?")
//   PreviewArea 는 열 때마다 download_url 을 통째로 받고, 닫으면 blob URL 을 바로 회수했다.
//   같은 PDF 를 닫았다 다시 열거나 돋보기·빠른 보기로 옮기면 처음부터 다시 받았다.
//   → 최근 것 몇 개를 메모리에 둔다. 새로고침 뒤에는 브라우저 캐시가 받는다(서버가 304 로 답한다 —
//     routes/files.js download 의 `private, no-cache`).
//
// 계약
//   - 키 = 주소 + 크기. 파일이 바뀌면(크기 다름) 다시 받는다.
//   - 메모리 전용 · 상한(개수·합계 바이트) · 로그아웃·워크스페이스 전환 때 통째로 비운다(lib/pageCache.clearPageCache).
//   - 같은 주소를 두 곳이 동시에 열면 한 번만 받는다(받는 중 진행률도 같이 본다).
//   - blob URL 은 캐시가 주인이다 — 부르는 쪽은 revoke 하지 않는다(밀려날 때·비울 때 캐시가 회수한다).
// apiFetch 는 부를 때 불러온다 — AuthContext → pageCache → 여기 → AuthContext 순환을 만들지 않게(utils/download 와 같은 방식).

const MAX_ENTRIES = 8;
const MAX_BYTES = 80 * 1024 * 1024;   // 이보다 큰 파일 하나는 기억하지 않는다(받아서 보여 주기만)

export interface BlobProgress { received: number; total: number | null }

interface Entry {
  promise: Promise<Blob>;
  blob: Blob | null;
  objectUrl: string | null;
  listeners: Set<(p: BlobProgress) => void>;
  last: BlobProgress;
}

const store = new Map<string, Entry>();

const keyOf = (url: string, size?: number | null) => `${url}#${Number(size) || 0}`;

function totalBytes(): number {
  let n = 0;
  for (const e of store.values()) n += e.blob?.size || 0;
  return n;
}

function drop(key: string): void {
  const e = store.get(key);
  if (!e) return;
  store.delete(key);
  if (e.objectUrl) URL.revokeObjectURL(e.objectUrl);
}

function trim(): void {
  // 오래된 것부터(Map 은 넣은 순서) — 받는 중인 것(blob 없음)은 건드리지 않는다
  for (const k of Array.from(store.keys())) {
    if (store.size <= MAX_ENTRIES && totalBytes() <= MAX_BYTES) break;
    if (store.get(k)?.blob) drop(k);
  }
}

async function readWithProgress(url: string, onProgress: (p: BlobProgress) => void, sizeHint?: number | null): Promise<Blob> {
  const { apiFetch } = await import('../contexts/AuthContext');
  const res = await apiFetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const lenHeader = Number(res.headers.get('Content-Length'));
  const total = Number.isFinite(lenHeader) && lenHeader > 0 ? lenHeader : (sizeHint && sizeHint > 0 ? sizeHint : null);
  if (!res.body || typeof res.body.getReader !== 'function') {
    const b = await res.blob();
    onProgress({ received: b.size, total: b.size });
    return b;
  }
  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) { chunks.push(value); received += value.length; onProgress({ received, total }); }
  }
  return new Blob(chunks, { type: res.headers.get('Content-Type') || '' });
}

/** 받은 파일(Blob). 이미 받았으면 바로 준다. onProgress 는 받는 동안 불린다(받은 뒤면 한 번 100%). */
export function loadFileBlob(url: string, opts?: { size?: number | null; onProgress?: (p: BlobProgress) => void }): Promise<Blob> {
  const key = keyOf(url, opts?.size);
  let e = store.get(key);
  if (e) {
    // 최근 사용으로 올린다
    store.delete(key); store.set(key, e);
    if (opts?.onProgress) {
      if (e.blob) opts.onProgress({ received: e.blob.size, total: e.blob.size });
      else { e.listeners.add(opts.onProgress); opts.onProgress(e.last); }
    }
    return e.promise;
  }
  const entry: Entry = { promise: Promise.resolve(new Blob()), blob: null, objectUrl: null, listeners: new Set(), last: { received: 0, total: opts?.size || null } };
  if (opts?.onProgress) entry.listeners.add(opts.onProgress);
  entry.promise = readWithProgress(url, (p) => {
    entry.last = p;
    entry.listeners.forEach((fn) => { try { fn(p); } catch { /* noop */ } });
  }, opts?.size).then((b) => {
    entry.blob = b;
    entry.listeners.clear();
    if (b.size > MAX_BYTES) { if (store.get(key) === entry) store.delete(key); }
    else trim();
    return b;
  }, (err) => {
    // 실패는 남기지 않는다 — 토큰 갱신 중 일시 실패가 그 파일을 계속 막으면 안 된다
    if (store.get(key) === entry) store.delete(key);
    throw err;
  });
  store.set(key, entry);
  return entry.promise;
}

/** 화면(iframe·a)에 쓸 blob URL. 캐시가 주인이라 부르는 쪽은 revoke 하지 않는다. */
export async function loadFileObjectUrl(url: string, opts?: { size?: number | null; onProgress?: (p: BlobProgress) => void }): Promise<string> {
  const b = await loadFileBlob(url, opts);
  const e = store.get(keyOf(url, opts?.size));
  if (e && e.blob === b) {
    if (!e.objectUrl) e.objectUrl = URL.createObjectURL(b);
    return e.objectUrl;
  }
  // 너무 커서 기억하지 않은 파일 — 이 URL 의 주인은 부르는 쪽이다(아래 isCachedObjectUrl 로 가른다)
  return URL.createObjectURL(b);
}

/** 이 blob URL 을 캐시가 쥐고 있는가 — 아니면 부르는 쪽이 다 쓴 뒤 revoke 한다. */
export function isCachedObjectUrl(u: string): boolean {
  for (const e of store.values()) if (e.objectUrl === u) return true;
  return false;
}

/** 방금 올린 파일 — 손에 쥔 바이트를 넣어 둔다(올리자마자 미리보기를 열 때 서버에서 다시 받지 않게). */
export function seedFileBlob(url: string, blob: Blob, size?: number | null): void {
  if (!url || blob.size > MAX_BYTES) return;
  const key = keyOf(url, size ?? blob.size);
  if (store.has(key)) return;
  store.set(key, { promise: Promise.resolve(blob), blob, objectUrl: null, listeners: new Set(), last: { received: blob.size, total: blob.size } });
  trim();
}

/** 로그아웃·워크스페이스 전환 — 남의 파일이 메모리에 남지 않게. */
export function clearFileBlobCache(): void {
  for (const k of Array.from(store.keys())) drop(k);
}
