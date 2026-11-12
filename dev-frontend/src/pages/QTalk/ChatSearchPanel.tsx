// 대화 안 메시지 검색 — 머리줄 돋보기로 여는 칸 (2026-11-12, 채널톡 쓰는 고객사 점검 A)
//   결과를 누르면 그 메시지로 간다(아직 안 불러온 옛 메시지면 부모가 거기까지 불러온다).
//   서버는 스니펫(≤160자 평문)만 준다 — 본문 전체를 받지 않는다. 강조는 공용 HighlightText(서버와 같은 규칙).
import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import SearchBox from '../../components/Common/SearchBox';
import HighlightText from '../../components/Common/HighlightText';
import * as qtalkApi from '../../services/qtalk';
import { formatDayTime } from '../../utils/dateFormat';

interface Props {
  conversationId: number;
  onJump: (messageId: number) => void | Promise<void>;
  onClose: () => void;
}

const ChatSearchPanel: React.FC<Props> = ({ conversationId, onJump, onClose }) => {
  const { t } = useTranslation('qtalk');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<qtalkApi.ConvSearchHit[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [jumpingId, setJumpingId] = useState<number | null>(null);
  const seqRef = useRef(0);

  // 입력이 멈추고 300ms 뒤 — 늦게 온 옛 응답은 버린다(seq)
  useEffect(() => {
    const term = q.trim();
    const seq = ++seqRef.current;
    if (!term) { setHits(null); setHasMore(false); setLoading(false); setError(false); return undefined; }
    setLoading(true);
    const timer = window.setTimeout(() => {
      qtalkApi.searchConversationMessages(conversationId, term)
        .then((r) => { if (seq !== seqRef.current) return; setHits(r.hits); setHasMore(r.hasMore); setError(false); })
        .catch(() => { if (seq !== seqRef.current) return; setHits(null); setError(true); })
        .finally(() => { if (seq === seqRef.current) setLoading(false); });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [q, conversationId]);

  const jump = async (id: number) => {
    setJumpingId(id);
    try { await onJump(id); } finally { setJumpingId(null); }
  };

  return (
    <Wrap data-testid="chat-search-panel" role="search">
      <Row>
        <SearchBox
          value={q}
          onChange={setQ}
          autoFocus
          width="100%"
          placeholder={t('search.placeholder', '이 대화에서 찾기') as string}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }}
        />
        <CloseBtn type="button" data-testid="chat-search-close" onClick={onClose}
          aria-label={t('search.close', '찾기 닫기') as string} title={t('search.close', '찾기 닫기') as string}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </CloseBtn>
      </Row>
      {q.trim() && (
        <Results data-testid="chat-search-results" aria-busy={loading}>
          {loading && !hits && <Status>{t('search.loading', '찾는 중…')}</Status>}
          {error && <Status role="alert">{t('search.error', '찾지 못했어요. 잠시 뒤 다시 해 보세요')}</Status>}
          {hits && hits.length === 0 && !loading && <Status>{t('search.none', '맞는 메시지가 없어요')}</Status>}
          {hits && hits.length > 0 && (
            <>
              <Status>
                {hasMore
                  ? t('search.countMore', { count: hits.length, defaultValue: '최근 {{count}}개만 보여요 — 더 좁혀 찾아 보세요' })
                  : t('search.count', { count: hits.length, defaultValue: '{{count}}개' })}
              </Status>
              {hits.map((h) => (
                <Hit key={h.id} type="button" data-testid={`chat-search-hit-${h.id}`} disabled={jumpingId !== null} onClick={() => void jump(h.id)}>
                  <HitHead>
                    <HitName>{h.sender_name}</HitName>
                    <HitTime>{jumpingId === h.id ? t('search.jumping', '이동 중…') : formatDayTime(h.created_at)}</HitTime>
                  </HitHead>
                  <HitText><HighlightText text={h.snippet} query={q} /></HitText>
                </Hit>
              ))}
            </>
          )}
        </Results>
      )}
    </Wrap>
  );
};

export default ChatSearchPanel;

const Wrap = styled.div`
  flex-shrink: 0;
  padding: 8px 16px;
  border-bottom: 1px solid #E2E8F0;
  background: #FFFFFF;
`;
const Row = styled.div`
  display: flex; align-items: center; gap: 6px; min-width: 0;
`;
const CloseBtn = styled.button`
  flex-shrink: 0; width: 36px; height: 36px;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; background: transparent; color: #64748B; border-radius: 6px; cursor: pointer;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const Results = styled.div`
  margin-top: 6px;
  max-height: min(320px, 40vh);
  overflow-y: auto;
  display: flex; flex-direction: column; gap: 2px;
`;
const Status = styled.div`
  padding: 4px 4px 6px;
  font-size: 0.75rem; color: #64748B;
`;
const Hit = styled.button`
  display: flex; flex-direction: column; gap: 2px; align-items: stretch;
  width: 100%; min-width: 0; padding: 8px 10px;
  border: none; border-radius: 6px; background: transparent;
  text-align: left; font: inherit; cursor: pointer;
  &:hover:not(:disabled) { background: #F1F5F9; }
  &:disabled { cursor: progress; }
`;
const HitHead = styled.span`
  display: flex; align-items: baseline; gap: 8px; min-width: 0;
`;
const HitName = styled.span`
  font-size: 0.75rem; font-weight: 600; color: #334155;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const HitTime = styled.span`
  margin-left: auto; flex-shrink: 0;
  font-size: 0.6875rem; color: #94A3B8;
`;
const HitText = styled.span`
  font-size: 0.8125rem; color: #0F172A; line-height: 1.45;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  word-break: break-word;
`;
