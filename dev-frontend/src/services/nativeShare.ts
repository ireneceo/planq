// 네이티브 앱(안드로이드)의 «공유 받기» — #434 ②. 설계 docs/NATIVE_SHARE_RECEIVE.md
//
// 입구는 하나다: 앱 플러그인(ShareReceivePlugin.java)이 받은 파일을 **웹 공유(public/sw.js)와 같은 캐시 형식**
// (`planq-share-v1` 의 /_share_payload + /_share_file_{i}, X-Filename 헤더)으로 옮기고 /share-receive?shared=1 로 보낸다.
// 그러면 공유 받은 뒤 화면(대화방·업무·메모·문서·파일 폴더 고르기)과 그 검사(--suite sharereceive)를 그대로 쓴다.
// ★ 형식을 바꾸면 sw.js 와 ShareReceivePage.loadSharePayload 를 같이 바꾼다 — 셋이 한 계약이다.
import { registerPlugin } from '@capacitor/core';
import { nativePlatform } from './native';

const SHARE_CACHE = 'planq-share-v1';

interface NativeSharedFile { path: string; name: string; mime: string; size: number }
interface NativeSharePayload { title?: string; text?: string; files?: NativeSharedFile[]; skipped?: number; ts?: number }
interface ShareReceivePlugin {
  takePending(): Promise<NativeSharePayload>;
  addListener(event: 'shareReceived', cb: () => void): Promise<{ remove: () => Promise<void> }>;
}

const ShareReceive = registerPlugin<ShareReceivePlugin>('ShareReceive');

const b64ToBlob = (b64: string, type: string): Blob => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
};

/** 받은 공유가 있으면 캐시에 옮기고 이동할 경로를 돌려준다. 없으면 null. */
export async function consumeNativeShare(): Promise<string | null> {
  let p: NativeSharePayload;
  try { p = await ShareReceive.takePending(); } catch { return null; }   // 플러그인이 없는 옛 앱 빌드
  const list = Array.isArray(p?.files) ? p.files : [];
  if (!p || (!list.length && !p.text && !p.title)) return null;

  const { Filesystem } = await import('@capacitor/filesystem');
  const cache = await caches.open(SHARE_CACHE);
  await cache.delete('/_share_payload');
  let n = 0;
  for (const f of list) {
    try {
      const r = await Filesystem.readFile({ path: `file://${f.path}` });
      const data = typeof r.data === 'string' ? b64ToBlob(r.data, f.mime) : r.data;
      await cache.put(`/_share_file_${n}`, new Response(data, {
        headers: { 'Content-Type': f.mime || 'application/octet-stream', 'X-Filename': encodeURIComponent(f.name) },
      }));
      n += 1;
    } catch { /* 읽지 못한 파일은 건너뛴다 — 화면이 받은 수를 보여 준다 */ }
    Filesystem.deleteFile({ path: `file://${f.path}` }).catch(() => {});
  }
  // 공유 문구에 링크만 온 경우(브라우저 «공유») — 웹 공유처럼 url 칸으로
  const text = String(p.text || '');
  const onlyUrl = /^https?:\/\/\S+$/.test(text.trim());
  await cache.put('/_share_payload', new Response(JSON.stringify({
    title: String(p.title || ''),
    text: onlyUrl ? '' : text,
    url: onlyUrl ? text.trim() : '',
    fileCount: n,
    ts: Date.now(),
  }), { headers: { 'Content-Type': 'application/json' } }));
  // 같은 화면에 연달아 공유해도 다시 읽게 — ShareReceivePage 는 search 가 바뀌면 캐시를 다시 읽는다
  return `/share-receive?shared=1&n=${Date.now()}`;
}

/** 앱이 켜질 때 + 켜져 있는 동안 공유를 받는다. 안드로이드만(iOS 는 Share Extension 이 생기면 같은 함수로). */
export async function bindNativeShare(go: (path: string) => void): Promise<() => void> {
  if (nativePlatform() !== 'android') return () => {};
  const run = async () => { const path = await consumeNativeShare(); if (path) go(path); };
  let handle: { remove: () => Promise<void> } | null = null;
  try { handle = await ShareReceive.addListener('shareReceived', () => { run(); }); } catch { /* 옛 앱 빌드 */ }
  run();
  return () => { handle?.remove().catch(() => {}); };
}
