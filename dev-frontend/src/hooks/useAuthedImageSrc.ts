// useAuthedImageSrc — 인증이 필요한 우리 이미지 주소를 `<img>` 가 그릴 수 있는 주소로 바꾼다.
//
// `<img src>` 는 Authorization 헤더를 싣지 못한다. 그래서 `/api/users/:id/avatar` 같은
//   authenticateToken 라우트를 src 에 그대로 넣으면 **언제나 401** 이고 그림은 한 번도 안 나온다
//   (2026-10-04 #455 — 사진은 운영에 저장돼 있었는데 화면엔 깨진 칸이었다).
//   apiFetch 로 받아 blob URL 로 만든다(SignatureProgressSection 과 같은 방식).
//
// ★ 우리 API(`/api/…`) 만 바꾼다. 외부 주소(구글 프로필)·정적 파일(`/static/…`)은 그대로 돌려준다.
// ★ 같은 주소는 한 번만 받는다 — 아바타는 목록에서 같은 사람이 수십 번 나온다.
//   주소에 `?v=` 버전이 붙어 있어 사진을 바꾸면 키가 달라진다. blob URL 은 풀지 않는다
//   (같은 주소를 다른 화면이 아직 쓰고 있을 수 있고, 사람 수만큼만 생긴다).
import { useEffect, useState } from 'react';
import { apiFetch } from '../contexts/AuthContext';

const cache = new Map<string, Promise<string | null>>();

function needsAuth(src: string): boolean {
  return src.startsWith('/api/');
}

function load(src: string): Promise<string | null> {
  let p = cache.get(src);
  if (!p) {
    p = (async () => {
      try {
        const r = await apiFetch(src);
        if (!r.ok) return null;
        return URL.createObjectURL(await r.blob());
      } catch { return null; }
    })();
    // 실패는 캐시에 남기지 않는다 — 토큰 갱신 중의 일시 실패가 그 화면 내내 사진을 지우면 안 된다
    p.then((v) => { if (!v) cache.delete(src); });
    cache.set(src, p);
  }
  return p;
}

/** 그릴 수 있는 주소. 받는 중이거나 실패하면 null — 부르는 쪽은 첫 글자로 떨어진다. */
export function useAuthedImageSrc(src: string | null | undefined): string | null {
  const direct = src && !needsAuth(src) ? src : null;
  const [resolved, setResolved] = useState<{ key: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!src || !needsAuth(src)) return undefined;
    let alive = true;
    void load(src).then((url) => { if (alive) setResolved({ key: src, url }); });
    return () => { alive = false; };
  }, [src]);
  if (!src) return null;
  if (direct) return direct;
  return resolved && resolved.key === src ? resolved.url : null;
}
