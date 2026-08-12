// 평문 안의 URL 을 클릭 가능한 링크로 — Q Talk 메시지와 Q Task 댓글이 공유한다.
//
// 여기 있는 것이 정본이다. 화면마다 각자 정규식을 두면 "채팅에서는 링크인데 댓글에서는 글자"
// 같은 불일치가 생긴다 (운영 #270: "업무 상세 댓글에 링크 클릭형태로 적용 안되고").
//
// 보안: React 엘리먼트로 만든다 — dangerouslySetInnerHTML 을 쓰지 않으므로 본문이 HTML 로
//   해석될 여지가 없다. 매칭도 http/https 로 한정해 javascript: 같은 스킴은 애초에 안 걸린다.
import React from 'react';
import styled from 'styled-components';

// http(s):// + 공백 아닌 문자. 문장 끝에 자주 붙는 . , ) ] 등은 링크에서 제외한다.
export const LINK_RE = /(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'"])/g;

export const AutoLink = styled.a`
  color: #0D9488;
  text-decoration: underline;
  text-underline-offset: 2px;
  word-break: break-all;   /* 긴 URL 이 레이아웃을 밀지 않게 */
  &:hover { color: #0F766E; text-decoration-thickness: 2px; }
  &:visited { color: #0F766E; }
`;

interface Options {
  /** 링크가 아닌 구간을 추가 가공한다 (Q Talk 의 @멘션 강조 등). 없으면 평문 그대로. */
  renderSegment?: (seg: string, keyBase: string) => React.ReactNode[];
}

export function renderTextWithLinks(text: string, opts: Options = {}): React.ReactNode[] {
  if (!text) return [text];
  const seg = opts.renderSegment || ((s: string) => [s]);
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  LINK_RE.lastIndex = 0;   // g 플래그 상태는 호출 간 남는다 — 매번 초기화
  while ((m = LINK_RE.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push(...seg(text.slice(lastIdx, m.index), `s-${lastIdx}`));
    parts.push(
      // 댓글/메시지 행 자체가 클릭 대상인 화면이 있어 전파를 끊는다 (링크 클릭이 행 선택으로 새지 않게)
      <AutoLink key={`l-${m.index}`} href={m[0]} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
        {m[0]}
      </AutoLink>,
    );
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) parts.push(...seg(text.slice(lastIdx), `s-${lastIdx}`));
  return parts.length > 0 ? parts : [text];
}
