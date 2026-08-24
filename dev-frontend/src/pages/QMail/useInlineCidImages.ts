// #215-H — 메일 본문의 `cid:` 이미지 해석.
//
// 본문은 sandbox iframe 의 srcDoc 으로 렌더되므로 `cid:` 스킴을 해석할 방법이 없다 — 여태 깨진 채였다.
// 서버가 내려준 `inline_images`(본문이 실제 참조하는 것만) 를 인증 다운로드해 data: URI 로 바꿔 치환한다.
//
// ★ blob: 은 쓰지 않는다 — sandbox iframe 에 allow-same-origin 이 없어 opaque origin 이라
//   부모가 만든 blob URL 로드가 브라우저별로 보장되지 않는다. data: 는 전 브라우저 보장.
// ★ data:image/ 로 시작하지 않는 응답은 버린다 (img 컨텍스트만 허용 — 스크립트 실행 표면 차단).
import { useState, useEffect } from 'react';
import { apiFetch } from '../../contexts/AuthContext';

export interface InlineImage {
  /** 첨부로 저장된 이미지. 본문에서 떼어낸 base64 이미지는 null 이다. */
  file_id: number | null;
  /** 본문에서 떼어낸 base64 이미지의 순번. 첨부 기반이면 undefined. */
  embedded_index?: number;
  content_id: string | null;
  mime_type: string;
  size_bytes: number | null;
}

interface MessageLike { id: number; inline_images?: InlineImage[] }

const MAX_PER_FILE = 4 * 1024 * 1024;
const MAX_PER_MSG = 10 * 1024 * 1024;

// services/emailAttachments.js 의 normalizeCid 와 같은 규칙 (꺾쇠 제거 + 소문자)
const normalizeCid = (contentId: string | null): string =>
  String(contentId || '').trim().replace(/^</, '').replace(/>$/, '').trim().toLowerCase();

// 반환: { messageId: { 정규화 cid: data URI } }
//
// `visibleIds` — 펼쳐진 메시지만 받는다 (#262 M2). 스레드가 접힌 상태에서 전체 메시지의 인라인
//   이미지를 인증 다운로드하면 긴 스레드에서 보이지도 않는 첨부를 수 MB 씩 받는다.
//   undefined 면 전부 로드 (옛 동작 유지 — 다른 호출처 무영향).
export function useInlineCidImages(
  messages: MessageLike[] | null,
  businessId: number | null,
  visibleIds?: ReadonlySet<number>,
  threadId?: number | null,
) {
  const [cidData, setCidData] = useState<Record<number, Record<string, string>>>({});

  useEffect(() => {
    if (!messages || !businessId) { setCidData({}); return; }
    let alive = true;
    // ★ 2026-08-24 (Irene: "이메일에 이미지가 첨부된게 너무 늦게 떠")
    //   옛 흐름은 두 겹으로 늦었다:
    //   ① 메시지 단위 **순차** — 펼친 메시지가 여럿이면 앞 것이 끝나야 다음이 시작
    //   ② 한 메시지 안에서도 `await Promise.all` 로 **전량 대기** 후에야 setCidData —
    //      이미지 4장이면 4장을 다 받아야 1장도 안 떴다.
    //   → 메시지는 병렬로, 이미지는 **받는 즉시 한 장씩** 반영한다. 첫 장이 곧바로 뜬다.
    (async () => {
      await Promise.all(messages.map(async (m) => {
        if (visibleIds && !visibleIds.has(m.id)) return;   // 접힌 메시지는 받지 않는다
        const inl = (m.inline_images || []).filter(x => (x.size_bytes || 0) <= MAX_PER_FILE);
        if (!inl.length) return;
        const map: Record<string, string> = {};
        // 예산 검사는 **착수 전에** size_bytes 로 끝낸다 — 그래야 병렬로 받아도 결과가 순서에
        //   의존하지 않는다(옛 순차 코드와 같은 집합을 고른다).
        let budget = MAX_PER_MSG;
        const queue: Array<{ cid: string; url: string }> = [];
        for (const im of inl) {
          const size = im.size_bytes || 0;
          if (size > budget) continue;          // 캡 초과분은 skip — 현상 유지(깨진 이미지)
          const cid = normalizeCid(im.content_id);
          if (!cid) continue;
          budget -= size;
          // 첨부 기반이면 파일 다운로드, 본문에서 떼어낸 것이면 스레드 메시지 경로.
          const url = (im.embedded_index != null && threadId)
            ? `/api/businesses/${businessId}/email-threads/${threadId}/messages/${m.id}/embedded/${im.embedded_index}`
            // ?w=1024 — 본문 표시용 리사이즈본(webp). 원본 2.4MB 를 그대로 받던 것이 지연의 큰 몫이었다.
            //   서버가 못 만들면 자동으로 원본을 준다(imageResize 폴백).
            : (im.file_id != null ? `/api/files/${businessId}/${im.file_id}/download?w=1024` : null);
          if (!url) continue;
          queue.push({ cid, url });
        }
        // ★ 2R-1 — 순차 await 는 이미지가 3장만 돼도 왕복이 그대로 쌓여 본문이 늦게 완성됐다.
        //   동시성 4 로 받는다(무제한 병렬은 인증 다운로드 라우트를 때린다).
        const CONCURRENCY = 4;
        let cursor = 0;
        const worker = async () => {
          for (;;) {
            const idx = cursor++;
            if (idx >= queue.length || !alive) return;
            const { cid, url } = queue[idx];
            try {
              const r = await apiFetch(url);
              if (!r.ok) continue;
              const blob = await r.blob();
              const dataUri = await new Promise<string>((resolve, reject) => {
                const fr = new FileReader();
                fr.onload = () => resolve(String(fr.result || ''));
                fr.onerror = () => reject(new Error('read_failed'));
                fr.readAsDataURL(blob);
              });
              if (!dataUri.startsWith('data:image/')) continue;
              map[cid] = dataUri;
              // ★ 받는 즉시 반영 — 나머지를 기다리지 않는다.
              if (alive) setCidData(prev => ({ ...prev, [m.id]: { ...(prev[m.id] || {}), [cid]: dataUri } }));
            } catch { /* 이 이미지만 포기 — 본문은 그대로 렌더된다 */ }
          }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
      }));
    })();
    return () => { alive = false; };
  }, [messages, businessId, visibleIds, threadId]);

  return cidData;
}
