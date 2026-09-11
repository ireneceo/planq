// 검색어 하이라이트 — 모든 검색 결과가 이 컴포넌트 하나로 칠한다.
//   매칭 규칙은 utils/searchMatch.ts (서버 LIKE 규칙의 거울). 화면에서 따로 split/includes 하지 않는다.
//   ★ dangerouslySetInnerHTML 을 쓰지 않는다 — 조각은 전부 텍스트 노드와 진짜 <mark> 요소다.
//   부모의 말줄임(ellipsis)·줄 제한을 깨지 않도록 **Fragment 로만** 돌려준다(감싸는 박스 없음).
import React, { useMemo } from 'react';
import styled, { css } from 'styled-components';
import { findMatches } from '../../utils/searchMatch';

export type HighlightTone = 'light' | 'dark';

export interface HighlightTextProps {
  text: string | number | null | undefined;
  query: string | null | undefined;
  /** dark = 어두운 바탕(사이드바 등) */
  tone?: HighlightTone;
}

const HighlightText: React.FC<HighlightTextProps> = ({ text, query, tone = 'light' }) => {
  const parts = useMemo(() => {
    if (text == null || text === '') return null;
    const s = String(text).normalize('NFC');
    const ranges = findMatches(s, query);
    if (!ranges.length) return [{ s, hit: false }];
    const out: Array<{ s: string; hit: boolean }> = [];
    let cursor = 0;
    for (const r of ranges) {
      if (r.start > cursor) out.push({ s: s.slice(cursor, r.start), hit: false });
      out.push({ s: s.slice(r.start, r.end), hit: true });
      cursor = r.end;
    }
    if (cursor < s.length) out.push({ s: s.slice(cursor), hit: false });
    return out;
  }, [text, query]);

  if (!parts) return null;
  return (
    <>
      {parts.map((p, i) => (p.hit
        ? <SearchMark key={i} $tone={tone} data-search-hit="1">{p.s}</SearchMark>
        : <React.Fragment key={i}>{p.s}</React.Fragment>))}
    </>
  );
};

export default React.memo(HighlightText);

// 브랜드 틸 — 링크·포커스 링과 같은 계열. 상태색(빨강·노랑)과 겹치지 않게 한다.
export const SearchMark = styled.mark<{ $tone: HighlightTone }>`
  border-radius: 3px;
  padding: 0 1px;
  font-weight: 600;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
  ${(p) => (p.$tone === 'dark'
    ? css`background: rgba(94, 234, 212, 0.22); color: #99F6E4;`
    : css`background: rgba(20, 184, 166, 0.18); color: #0F766E;`)}
`;
