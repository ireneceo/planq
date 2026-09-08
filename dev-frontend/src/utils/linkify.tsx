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

/**
 * **이미 HTML escape 된** 평문 안의 URL 을 `<a>` 로 감싼다 — HTML 문자열을 조립하는 곳
 * (새 창으로 여는 메일 본문 등)이 쓴다. 정규식은 위 `LINK_RE` 하나를 공유한다.
 *
 * ★ 반드시 **escape 뒤에** 부른다. escape 전에 부르면 우리가 넣은 태그까지 escape 되거나,
 *   본문에 있던 `<script>` 가 살아남는다. 인자 이름을 `escaped` 로 둔 이유다.
 *   (`&` 는 `&amp;` 로 바뀌어 있는데 href 안의 `&amp;` 는 브라우저가 `&` 로 해석하므로 안전하다.)
 */
export function linkifyEscapedHtml(escaped: string): string {
  if (!escaped) return escaped;
  LINK_RE.lastIndex = 0;
  return escaped.replace(LINK_RE, (url) =>
    `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
}
