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

/** 앱 안에서 폴더로 끌어 옮길 수 있는가 — 서버 `POST /:biz/:id/move` 의 `canMutateFile` 과 **같은 술어**.
 *  ★ 드래그 아웃(OS 로 빼내기)과 **다른 조건**이다. 보안등급이 걸린 파일은 밖으로는 못 나가도
 *    안에서 폴더 정리는 돼야 한다. 하나로 묶으면 "정리가 안 되는 파일" 이 생긴다.
 *
 *  ★ 2026-09-17 (Fable 게이트 #57) — `source === 'direct'` 조건을 **뺐다.**
 *    서버는 `source` 를 보지 않는다(`canMutateFile` + 폴더 소유 검사뿐). 화면만 더 엄격해서
 *    **채팅·업무에서 온 파일은 끌어도 아무 일이 안 나고 이유도 말하지 않았다** —
 *    서버가 이미 허용하는 것을 사용자가 영영 못 하는 상태였다
 *    (memory `feedback_client_stricter_than_server_kills_feature`).
 *    `folder_id` 는 Q file 의 **정리 축**이라 그 파일이 붙어 있는 대화·업무 소속과 충돌하지 않는다.
 *    권한이 없어 못 옮기는 것은 `deletable` 이 이미 말해 준다(서버와 같은 값). */
export function isMovableInApp(f: ProjectFile): boolean {
  // ★ 2026-09-20 — `source === 'direct'` 를 **되살렸다.** 2026-09-17 에 "서버는 source 를 보지
  //   않는다" 는 이유로 뺐는데, 그 판단이 틀렸다: 폴더(`folder_id`)는 **`files` 표에만 있는 축**이다.
  //   채팅·업무 첨부는 다른 표(message_attachments · task_attachments)에 있어 폴더에 넣을 수 없고,
  //   실제로 `services/files.moveFile` 이 `direct` 가 아니면 **조용히 false** 를 돌려준다 —
  //   즉 끌어다 놓아도 **아무 일이 안 일어나고 이유도 안 알려주는** 상태였다.
  //   (합성 id 의 숫자를 그대로 보내면 엉뚱한 File 을 옮기므로 그 차단 자체는 옳다.)
  //   ★ 밖으로 꺼내기(OS)는 별개다 — 그쪽은 출처별로 열려 있다(`isDraggableOut`).
  return !!f.deletable && f.source === 'direct';
}

/** 앱 내부 드래그 페이로드 — 폴더 행이 이 타입으로 드롭을 판정한다.
 *  text/plain 으로 판정하면 브라우저 밖에서 끌어온 아무 텍스트나 파일 이동으로 읽힌다. */
export const PLANQ_FILE_MIME = 'application/x-planq-file';

/** 이 파일을 OS 로 끌어낼 수 있는가 — 백엔드 발급 조건과 같은 술어(프론트는 무의미한 요청을 줄인다). */
export function isDraggableOut(f: ProjectFile): boolean {
  // ★ 2026-09-20 — 채팅·업무 첨부도 열었다(#228-b). 조건만 풀면 안 됐던 이유는 화면이 엄격해서가
  //   아니라 **합성 id 가 표마다 다른 번호**였기 때문이다(`chat-45`=MessageAttachment id).
  //   지금은 서버가 출처별로 받고(`services/dragTarget`) **서명에 출처가 들어간다** —
  //   chat 으로 받은 서명을 direct 로 상환할 수 없다. 권한은 각 출처의 다운로드와 같은 술어다.
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
    if (!businessId) return;
    /* ★ 끌기 시작한 것을 **화면 전체가 안다** — 좌측 폴더 행이 «여기 놓을 수 있다» 를 점선으로
       알려 주고, 끌고 있는 카드는 반투명해진다. 끌어 보기 전에는 폴더에 놓을 수 있다는 사실을
       알 길이 없었다(Irene 2026-09-20: "알기 쉽게 이동할 때나 마우스 오버나 … 디테일 좀 챙겨줘").
       ★ 단, «폴더에 넣을 수 있는 것» 일 때만 점선을 켠다. 밖으로 꺼내기만 되는 파일
         (채팅·업무 첨부 등)은 폴더에 놓아도 아무 일이 없는데 점선이 뜨면 **거짓말**이 되고,
         사용자는 "넣었는데 안 들어간다" 로 읽는다. 끌고 있는 표시(반투명)는 둘 다 켠다. */
    try {
      if (isMovableInApp(f)) document.body.dataset.pqDragfile = '1';
      (e.currentTarget as HTMLElement).dataset.dragging = '1';
    } catch { /* noop */ }

    // 앱 안에서 폴더로 옮기기 — 밖으로 못 빼내는 파일도 여기까지는 온다.
    if (isMovableInApp(f)) {
      try { e.dataTransfer.setData(PLANQ_FILE_MIME, f.id); } catch { /* 미지원 브라우저 */ }
      e.dataTransfer.effectAllowed = isDraggableOut(f) ? 'copyMove' : 'move';
    }

    if (!isDraggableOut(f)) return;
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
    // 밖으로 빼낼 수 있거나(OS) 안에서 옮길 수 있으면(폴더) 끌 수 있다.
    if (!isDraggableOut(f) && !isMovableInApp(f)) return {};
    return {
      draggable: true,
      onPointerDown: () => prefetch(f),   // 드래그 아웃 대상만 실제로 발급한다(prefetch 안에서 판정)
      onDragStart: (e: React.DragEvent) => onDragStart(f, e),
      // ★ dragend 는 **드롭이 실패해도** 온다 — 표시를 여기서 끈다.
      //   드롭 쪽에서만 지우면 밖으로 놓거나 Esc 로 취소했을 때 점선이 남는다.
      onDragEnd: (e: React.DragEvent) => {
        try {
          delete document.body.dataset.pqDragfile;
          delete (e.currentTarget as HTMLElement).dataset.dragging;
        } catch { /* noop */ }
      },
    };
  }, [prefetch, onDragStart]);

  return { getDragProps };
}
