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
  file_id: number;
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
) {
  const [cidData, setCidData] = useState<Record<number, Record<string, string>>>({});

  useEffect(() => {
    if (!messages || !businessId) { setCidData({}); return; }
    let alive = true;
    (async () => {
      for (const m of messages) {
        if (visibleIds && !visibleIds.has(m.id)) continue;   // 접힌 메시지는 받지 않는다
        const inl = (m.inline_images || []).filter(x => (x.size_bytes || 0) <= MAX_PER_FILE);
        if (!inl.length) continue;
        let budget = MAX_PER_MSG;
        const map: Record<string, string> = {};
        for (const im of inl) {
          const size = im.size_bytes || 0;
          if (size > budget) continue;          // 캡 초과분은 skip — 현상 유지(깨진 이미지)
          const cid = normalizeCid(im.content_id);
          if (!cid) continue;
          try {
            const r = await apiFetch(`/api/files/${businessId}/${im.file_id}/download`);
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
            budget -= size;
          } catch { /* 이 이미지만 포기 — 본문은 그대로 렌더된다 */ }
        }
        if (!alive) return;
        if (Object.keys(map).length) setCidData(prev => ({ ...prev, [m.id]: { ...(prev[m.id] || {}), ...map } }));
      }
    })();
    return () => { alive = false; };
  }, [messages, businessId, visibleIds]);

  return cidData;
}
