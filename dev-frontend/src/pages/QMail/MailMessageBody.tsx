// 메일 본문 iframe — ThreadMessages 에서 절출한 memo 컴포넌트 (2R-1).
//
// ★ 존재 이유: srcDoc 을 JSX 안에서 인라인 호출하면 **렌더마다 DOMPurify 정화가 다시 돈다**.
//   높이 postMessage → setState(frameH) → 재렌더 → 재정화 의 자기유발 루프가 되고, 본문은
//   평균 49KB · 최대 1.8MB(운영 실측)라 메인스레드가 그대로 멈춘다.
//   여기서 useMemo + React.memo 로 묶어 "본문/이미지/문구가 실제로 바뀔 때만" 정화한다.
//   (Irene: "리스트 클릭해도 상세내용이 너무 늦게 나와")
import React, { useMemo } from 'react';
import { MessageBodyFrame } from './MailPage.styles';
import { buildMailSrcDoc, type QuoteFoldLabels } from './mailSrcDoc';

interface Props {
  id: number;
  bodyHtml: string;
  /** 높이 추정용 — 본문 글자 수로 첫 프레임 높이를 잡는다 */
  bodyText?: string | null;
  cidMap?: Record<string, string>;
  /** 실측 높이(iframe 이 postMessage 로 알려준 값). 없으면 추정치를 쓴다. */
  measuredH?: number;
  foldLabels: QuoteFoldLabels;
}

// 첫 프레임 높이 추정 — 고정 120px 은 "작은 박스가 떴다가 튀어오르는" 원인이었다.
//   한 줄 ≈ 90자 · 줄높이 22px + 여백. 상한은 화면을 삼키지 않도록 2000px.
export function estimateHeight(bodyText?: string | null): number {
  const len = String(bodyText || '').length;
  if (!len) return 200;
  return Math.min(2000, Math.max(200, Math.ceil(len / 90) * 22 + 120));
}

function MailMessageBody({ id, bodyHtml, bodyText, cidMap, measuredH, foldLabels }: Props) {
  const srcDoc = useMemo(
    () => buildMailSrcDoc(id, bodyHtml, cidMap, foldLabels),
    [id, bodyHtml, cidMap, foldLabels],
  );
  const h = measuredH || estimateHeight(bodyText);
  return (
    <MessageBodyFrame
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
      style={{ height: `${h}px`, transition: 'height 120ms ease-out' }}
      srcDoc={srcDoc}
      title={`message-${id}`}
    />
  );
}

export default React.memo(MailMessageBody);
