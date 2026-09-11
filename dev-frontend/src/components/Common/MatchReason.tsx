// "왜 이 결과가 여기 있는가" — 한 줄: [본문에서 찾음] …매칭 주변 문장…
//   매칭된 필드가 행에 **이미 보이면** 쓰지 않는다(하이라이트로 충분). 안 보이는 필드에서 맞았을 때만 붙인다.
//   필드 이름은 common:search.matchedIn.<field> — 새 필드는 ko/en 을 같이 추가한다.
//   스니펫 원천: 서버가 준 match.snippet(메일·통합검색·문서) 또는 utils/searchMatch.pickMatch(클라이언트 필터).
import React, { useMemo } from 'react';
import styled, { css } from 'styled-components';
import { useTranslation } from 'react-i18next';
import HighlightText, { type HighlightTone } from './HighlightText';
import { makeSnippet } from '../../utils/searchMatch';

export interface MatchReasonProps {
  field: string | null | undefined;
  snippet?: string | null;
  query: string | null | undefined;
  tone?: HighlightTone;
  /** 스니펫 줄 수 (기본 1 — 행 높이를 지킨다) */
  lines?: 1 | 2;
  className?: string;
}

const ELLIPSIS = '…';

const MatchReason: React.FC<MatchReasonProps> = ({ field, snippet, query, tone = 'light', lines = 1, className }) => {
  const { t } = useTranslation('common');

  // 좁은 행에서도 매칭어가 잘리지 않게 앞 문맥을 짧게 다시 자른다.
  const display = useMemo(() => {
    if (!snippet) return null;
    const lead = snippet.startsWith(ELLIPSIS);
    const trail = snippet.endsWith(ELLIPSIS);
    const core = snippet.replace(/^…/, '').replace(/…$/, '');
    const sn = makeSnippet(core, query, { before: lines === 1 ? 16 : 40, max: lines === 1 ? 110 : 160, plain: true });
    if (!sn) return snippet;
    return `${lead || sn.truncatedStart ? ELLIPSIS : ''}${sn.text}${trail || sn.truncatedEnd ? ELLIPSIS : ''}`;
  }, [snippet, query, lines]);

  if (!field || !String(query ?? '').trim()) return null;
  const fieldLabel = t(`search.matchedIn.${field}`, { defaultValue: field }) as string;

  return (
    <Wrap className={className} data-testid="search-match-reason" data-field={field}>
      <FieldTag $tone={tone}>{t('search.matchedInLabel', { field: fieldLabel }) as string}</FieldTag>
      {display && (
        <Snip $tone={tone} $lines={lines}>
          <HighlightText text={display} query={query} tone={tone} />
        </Snip>
      )}
    </Wrap>
  );
};

export default React.memo(MatchReason);

const Wrap = styled.span`
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
  margin-top: 2px;
  line-height: 1.45;
`;
const FieldTag = styled.span<{ $tone: HighlightTone }>`
  flex-shrink: 0;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 0.625rem;
  font-weight: 600;
  white-space: nowrap;
  ${(p) => (p.$tone === 'dark'
    ? css`background: rgba(148, 163, 184, 0.18); color: #CBD5E1;`
    : css`background: #F1F5F9; color: #475569;`)}
`;
const Snip = styled.span<{ $tone: HighlightTone; $lines: 1 | 2 }>`
  flex: 1;
  min-width: 0;
  font-size: 0.6875rem;
  font-weight: 400;
  color: ${(p) => (p.$tone === 'dark' ? '#94A3B8' : '#64748B')};
  overflow: hidden;
  word-break: break-word;
  ${(p) => (p.$lines === 1
    ? css`white-space: nowrap; text-overflow: ellipsis;`
    : css`display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; white-space: normal;`)}
`;
