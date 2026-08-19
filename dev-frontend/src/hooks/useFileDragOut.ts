// #228 — 파일을 OS(바탕화면·탐색기·다른 앱)로 드래그해서 빼내기.
//
// 웹에서 파일을 밖으로 빼내는 유일한 표준 경로는 dragstart 에서 dataTransfer 에
// 'DownloadURL' 을 넣는 것이다(Chromium 계열 한정 — Firefox/Safari 는 무시한다).
// 브라우저가 그 URL 을 **인증 헤더 없이** 별도로 가져가기 때문에, 인증 다운로드 URL 은 쓸 수 없고
// 서버에서 5분짜리 서명 URL 을 받아 넣는다.
//
// dragstart 는 동기 이벤트라 그 안에서 발급을 기다릴 수 없다. 그래서 pointerdown 시점에 미리
// 발급해 캐시한다(마우스를 누른 뒤 드래그 임계 거리를 넘기까지 시간이 있다).
// hover 로 미리 받지 않는 이유: 목록 위를 지나가기만 해도 카드 수십 장이 발급 요청을 쏘게 된다.
// 캐시가 비어 있으면 드래그를 막지 않고 앱 링크만 넣은 채 진행하고, 그 사이 발급해 두어 다음
// 드래그는 성공한다.
import { useCallback, useEffect, useRef } from 'react';
import { issueDragUrl, type ProjectFile } from '../services/files';

type CacheEntry = { url: string; until: number };

// 서버 TTL 300초 — 만료 30초 전에 폐기해 경계에서 죽은 URL 을 넘기지 않는다.
const TTL_MS = 300 * 1000;
const SAFETY_MS = 30 * 1000;

/** 이 파일을 OS 로 끌어낼 수 있는가 — 백엔드 발급 조건과 같은 술어(프론트는 무의미한 요청을 줄인다). */
export function isDraggableOut(f: ProjectFile): boolean {
  if (f.source !== 'direct') return false;                 // 채팅·업무 첨부는 후속(#228-b)
  if (f.storage_provider !== 'planq') return false;         // 외부 스토리지는 바이트를 우리가 안 쥐고 있다
  if (f.security_level && f.security_level !== 'general') return false;  // 외부 노출 게이트
  return true;
}

export function useFileDragOut(businessId: number | null | undefined) {
  const cache = useRef<Map<string, CacheEntry>>(new Map());
  const inflight = useRef<Set<string>>(new Set());

  useEffect(() => { cache.current.clear(); inflight.current.clear(); }, [businessId]);

  const prefetch = useCallback((f: ProjectFile) => {
    if (!businessId || !isDraggableOut(f)) return;
    const hit = cache.current.get(f.id);
    if (hit && hit.until > Date.now()) return;
    if (inflight.current.has(f.id)) return;
    inflight.current.add(f.id);
    issueDragUrl(businessId, f.id)
      .then(url => { if (url) cache.current.set(f.id, { url, until: Date.now() + TTL_MS - SAFETY_MS }); })
      .finally(() => { inflight.current.delete(f.id); });
  }, [businessId]);

  const onDragStart = useCallback((f: ProjectFile, e: React.DragEvent) => {
    if (!businessId || !isDraggableOut(f)) return;
    // 앱 안에서 쓰는 링크 — 채팅·메모에 떨어뜨렸을 때 남는 값이다.
    // 여기에 서명 URL 을 넣으면 5분 뒤 죽는 URL 과 사용자 ID 가 대화에 박제된다.
    const appLink = `${window.location.origin}/files?file=${f.id}`;
    try {
      e.dataTransfer.setData('text/uri-list', appLink);
      e.dataTransfer.setData('text/plain', appLink);
    } catch { /* 일부 브라우저가 특정 타입을 거부해도 드래그 자체는 계속된다 */ }

    const hit = cache.current.get(f.id);
    if (hit && hit.until > Date.now()) {
      // DownloadURL 트리플릿은 ':' 로 나뉜다 — 파일명에 ':' 이 있으면 포맷이 깨진다(macOS 업로드).
      const safeName = f.file_name.replace(/:/g, '_');
      const mime = f.mime_type || 'application/octet-stream';
      const abs = hit.url.startsWith('http') ? hit.url : `${window.location.origin}${hit.url}`;
      try {
        e.dataTransfer.setData('DownloadURL', `${mime}:${safeName}:${abs}`);
        e.dataTransfer.effectAllowed = 'copy';
      } catch { /* 미지원 브라우저 — 위의 링크 드롭으로 하향 */ }
    } else {
      prefetch(f);   // 이번엔 링크만 나가고, 다음 드래그부터 파일이 나간다
    }
  }, [businessId, prefetch]);

  /** 카드/행에 그대로 스프레드한다. */
  const getDragProps = useCallback((f: ProjectFile) => {
    if (!isDraggableOut(f)) return {};
    return {
      draggable: true,
      onPointerDown: () => prefetch(f),
      onDragStart: (e: React.DragEvent) => onDragStart(f, e),
    };
  }, [prefetch, onDragStart]);

  return { getDragProps };
}
