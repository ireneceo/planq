// 내 문의·피드백 (운영 #21·#54·#70) — 좌측 리스트 / 우측 스레드 상세 master-detail.
//   #54: 검색 + 카테고리/상태 필터.
//   #70: Q docs·Q note 식 좌/우 레이아웃 + ?item URL 싱크 + 답변 받은 항목에 추가 문의(스레드).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import PageShell from '../../components/Layout/PageShell';
import SearchBox from '../../components/Common/SearchBox';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import ActionButton from '../../components/Common/ActionButton';
import { formatDate } from '../../utils/dateFormat';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { mapApiError } from '../../utils/apiError';

interface FeedbackItem {
  id: number;
  parent_id: number | null;
  category: string;
  priority: string;
  title: string;
  body: string;
  status: string;
  admin_response: string | null;
  responded_at: string | null;
  created_at: string;
}
interface FeedbackThread extends FeedbackItem {
  replies: FeedbackItem[];
  last_activity_at: string;
  awaiting_reply: boolean;
}

const CAT_FALLBACK: Record<string, string> = { bug: '버그', improve: '개선', feature: '기능 요청', other: '기타' };
const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  pending: { bg: '#FEF3C7', fg: '#92400E' },
  reviewing: { bg: '#DBEAFE', fg: '#1E40AF' },
  done: { bg: '#DCFCE7', fg: '#166534' },
  wontfix: { bg: '#F1F5F9', fg: '#64748B' },
};

const MyFeedbackPage = () => {
  const { t } = useTranslation('common');
  const { t: tErr } = useTranslation('errors');
  const { user } = useAuth();
  const tz = (user as { workspace_timezone?: string } | null)?.workspace_timezone || 'Asia/Seoul';
  const [threads, setThreads] = useState<FeedbackThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('item') ? Number(params.get('item')) : null;

  // 추가 문의 입력
  const [followup, setFollowup] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const followupRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    apiFetch('/api/feedback/mine')
      .then(r => r.json())
      .then(j => { if (j?.success) setThreads(Array.isArray(j.data) ? j.data : []); })
      .catch(() => { /* keep prev on silent fail */ })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  // PWA background→foreground / 탭 복귀 시 server fresh 재조회 (운영팀 답변 즉시 반영)
  useVisibilityRefresh(() => load(true));

  const catLabel = (c: string) => t(`myFeedback.cat.${c}`, { defaultValue: CAT_FALLBACK[c] || c }) as string;
  const statusLabel = (s: string) => t(`myFeedback.status.${s}`, { defaultValue: s }) as string;

  const catOptions: PlanQSelectOption[] = [
    { value: 'all', label: t('myFeedback.filter.allCat') as string },
    ...['bug', 'improve', 'feature', 'other'].map(c => ({ value: c, label: catLabel(c) })),
  ];
  const statusOptions: PlanQSelectOption[] = [
    { value: 'all', label: t('myFeedback.filter.allStatus') as string },
    ...['pending', 'reviewing', 'done', 'wontfix'].map(s => ({ value: s, label: statusLabel(s) })),
  ];

  // 스레드 텍스트(부모+자식 본문/답변) 통합 검색
  const threadText = (th: FeedbackThread) => {
    const parts = [th.title, th.body, th.admin_response || ''];
    th.replies.forEach(r => { parts.push(r.body, r.admin_response || ''); });
    return parts.join(' ').toLowerCase();
  };
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return threads.filter(th => {
      if (catFilter !== 'all' && th.category !== catFilter) return false;
      if (statusFilter !== 'all' && th.status !== statusFilter) return false;
      if (q && !threadText(th).includes(q)) return false;
      return true;
    });
  }, [threads, search, catFilter, statusFilter]);

  const selected = useMemo(
    () => threads.find(th => th.id === selectedId) || null,
    [threads, selectedId],
  );

  // 재클릭 토글 (CLAUDE.md 공통 UX) + URL 싱크
  const select = useCallback((id: number) => {
    setParams(prev => {
      const n = new URLSearchParams(prev);
      if (Number(n.get('item')) === id) n.delete('item');
      else n.set('item', String(id));
      return n;
    }, { replace: false });
  }, [setParams]);
  const closeDetail = useCallback(() => {
    setParams(prev => { const n = new URLSearchParams(prev); n.delete('item'); return n; }, { replace: false });
  }, [setParams]);

  // 선택 바뀌면 추가 문의 입력 초기화
  useEffect(() => { setFollowup(''); setResultMsg(null); }, [selectedId]);

  // 스레드가 운영팀 답변을 받았는지 (추가 문의 허용 조건)
  const threadAnswered = (th: FeedbackThread | null) => {
    if (!th) return false;
    if (th.admin_response) return true;
    return th.replies.some(r => r.admin_response);
  };

  const submitFollowup = useCallback(async () => {
    if (!selected || submitting) return;
    const text = followup.trim();
    if (!text) return;
    setSubmitting(true);
    setResultMsg(null);
    try {
      const res = await apiFetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text, parent_id: selected.id }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.message || 'feedback error');
      setFollowup('');
      setResultMsg(t('myFeedback.followup.success') as string);
      load(true);
      window.setTimeout(() => setResultMsg(null), 6000);
    } catch (e) {
      setResultMsg(mapApiError(e, tErr));
    } finally {
      setSubmitting(false);
    }
  }, [selected, followup, submitting, t, tErr, load]);

  // 스레드를 시간순 대화 항목으로 평탄화 (원 문의 + 추가 문의들)
  const conversation = useMemo(() => {
    if (!selected) return [];
    return [selected, ...selected.replies];
  }, [selected]);

  return (
    <PageShell
      title={t('myFeedback.title') as string}
      count={filtered.length}
      bodyPadding="0"
      actions={threads.length > 0 ? (
        <Filters>
          <SearchBox
            placeholder={t('myFeedback.filter.search') as string}
            value={search} onChange={setSearch} width={200} size="sm"
          />
          <SelWrap>
            <PlanQSelect size="sm" isClearable={false} isSearchable={false}
              value={catOptions.find(o => o.value === catFilter)} options={catOptions}
              onChange={(o) => setCatFilter(String((o as PlanQSelectOption)?.value ?? 'all'))} />
          </SelWrap>
          <SelWrap>
            <PlanQSelect size="sm" isClearable={false} isSearchable={false}
              value={statusOptions.find(o => o.value === statusFilter)} options={statusOptions}
              onChange={(o) => setStatusFilter(String((o as PlanQSelectOption)?.value ?? 'all'))} />
          </SelWrap>
        </Filters>
      ) : undefined}
    >
      <Split $detailOpen={!!selected}>
        {/* 좌측 리스트 */}
        <ListPane $detailOpen={!!selected}>
          {loading ? (
            <Empty>{t('myFeedback.loading') as string}</Empty>
          ) : threads.length === 0 ? (
            <Empty>{t('myFeedback.empty') as string}</Empty>
          ) : filtered.length === 0 ? (
            <Empty>{t('myFeedback.noMatch') as string}</Empty>
          ) : (
            filtered.map(th => {
              const tone = STATUS_TONE[th.status] || STATUS_TONE.pending;
              return (
                <ListRow key={th.id} $active={selectedId === th.id} type="button" onClick={() => select(th.id)}>
                  <RowTop>
                    <Cat>{catLabel(th.category)}</Cat>
                    <Status $bg={tone.bg} $fg={tone.fg}>{statusLabel(th.status)}</Status>
                    {th.awaiting_reply && <AwaitDot title={t('myFeedback.awaiting') as string} />}
                  </RowTop>
                  <RowTitle>{th.title}</RowTitle>
                  <RowMeta>
                    <span>{formatDate(th.last_activity_at || th.created_at, tz)}</span>
                    {th.replies.length > 0 && <ReplyCount>+{th.replies.length}</ReplyCount>}
                  </RowMeta>
                </ListRow>
              );
            })
          )}
        </ListPane>

        {/* 우측 상세 스레드 */}
        <DetailPane $detailOpen={!!selected}>
          {!selected ? (
            <DetailEmpty>{t('myFeedback.selectPrompt') as string}</DetailEmpty>
          ) : (
            <>
              <DetailHeader>
                <BackBtn type="button" onClick={closeDetail} aria-label={t('myFeedback.back') as string}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                </BackBtn>
                <DetailTitle>{selected.title}</DetailTitle>
                <Status $bg={(STATUS_TONE[selected.status] || STATUS_TONE.pending).bg} $fg={(STATUS_TONE[selected.status] || STATUS_TONE.pending).fg}>
                  {statusLabel(selected.status)}
                </Status>
              </DetailHeader>
              <Thread>
                {conversation.map((it, i) => (
                  <div key={it.id}>
                    <MsgBlock>
                      <MsgWho>
                        {t('myFeedback.you') as string}
                        {i > 0 && <FollowTag>{t('myFeedback.followup.title') as string}</FollowTag>}
                        <MsgDate>{formatDate(it.created_at, tz)}</MsgDate>
                      </MsgWho>
                      <MsgBody>{it.body}</MsgBody>
                    </MsgBlock>
                    {it.admin_response && (
                      <ReplyBlock>
                        <MsgWho $reply>
                          {t('myFeedback.reply') as string}
                          {it.responded_at && <MsgDate>{formatDate(it.responded_at, tz)}</MsgDate>}
                        </MsgWho>
                        <MsgBody>{it.admin_response}</MsgBody>
                      </ReplyBlock>
                    )}
                  </div>
                ))}
              </Thread>
              {/* 추가 문의 — 답변 받은 스레드만 */}
              <Composer>
                {threadAnswered(selected) ? (
                  <>
                    <ComposerLabel>{t('myFeedback.followup.title') as string}</ComposerLabel>
                    <FollowTextarea
                      ref={followupRef}
                      value={followup}
                      onChange={e => setFollowup(e.target.value)}
                      placeholder={t('myFeedback.followup.placeholder') as string}
                      rows={3}
                      onKeyDown={e => {
                        if (e.nativeEvent.isComposing || (e.nativeEvent as KeyboardEvent).keyCode === 229) return;
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitFollowup(); }
                      }}
                    />
                    <ComposerFooter>
                      <Hint>{t('myFeedback.followup.hint') as string}</Hint>
                      <ActionButton tone="primary" size="sm" loading={submitting}
                        disabled={!followup.trim()} onClick={submitFollowup}>
                        {t('myFeedback.followup.send') as string}
                      </ActionButton>
                    </ComposerFooter>
                    {resultMsg && <ResultMsg>{resultMsg}</ResultMsg>}
                  </>
                ) : (
                  <LockedHint>{t('myFeedback.followup.locked') as string}</LockedHint>
                )}
              </Composer>
            </>
          )}
        </DetailPane>
      </Split>
    </PageShell>
  );
};

export default MyFeedbackPage;

// ─── styled ───
const Filters = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`;
const SelWrap = styled.div`min-width: 130px;`;

const Split = styled.div<{ $detailOpen: boolean }>`
  display: flex;
  height: 100%;
  min-height: 0;
`;
const ListPane = styled.div<{ $detailOpen: boolean }>`
  width: 340px;
  flex-shrink: 0;
  border-right: 1px solid #e2e8f0;
  background: #ffffff;
  overflow-y: auto;
  display: flex; flex-direction: column;
  @media (max-width: 1024px) {
    width: 100%;
    border-right: none;
    display: ${p => (p.$detailOpen ? 'none' : 'flex')};
  }
`;
const DetailPane = styled.div<{ $detailOpen: boolean }>`
  flex: 1; min-width: 0;
  background: #f8fafc;
  overflow-y: auto;
  display: flex; flex-direction: column;
  @media (max-width: 1024px) {
    display: ${p => (p.$detailOpen ? 'flex' : 'none')};
  }
`;
const Empty = styled.div`padding: 40px 20px; text-align: center; font-size: 13px; color: #94a3b8;`;
const DetailEmpty = styled.div`
  flex: 1; display: flex; align-items: center; justify-content: center;
  padding: 40px 24px; text-align: center; font-size: 13px; color: #94a3b8; line-height: 1.6;
`;

const ListRow = styled.button<{ $active: boolean }>`
  all: unset; cursor: pointer; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 6px;
  padding: 14px 16px;
  border-bottom: 1px solid #f1f5f9;
  background: ${p => (p.$active ? '#f0fdfa' : 'transparent')};
  border-left: 3px solid ${p => (p.$active ? '#14b8a6' : 'transparent')};
  transition: background 0.15s;
  &:hover { background: ${p => (p.$active ? '#f0fdfa' : '#f8fafc')}; }
`;
const RowTop = styled.div`display: flex; align-items: center; gap: 6px;`;
const Cat = styled.span`
  font-size: 11px; font-weight: 700; color: #0f766e;
  background: #f0fdfa; border-radius: 999px; padding: 2px 8px;
`;
const Status = styled.span<{ $bg: string; $fg: string }>`
  font-size: 11px; font-weight: 700; border-radius: 999px; padding: 2px 8px;
  background: ${p => p.$bg}; color: ${p => p.$fg};
`;
const AwaitDot = styled.span`
  width: 7px; height: 7px; border-radius: 50%; background: #f59e0b; margin-left: auto;
`;
const RowTitle = styled.div`
  font-size: 13px; font-weight: 600; color: #0f172a; line-height: 1.4;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
`;
const RowMeta = styled.div`
  display: flex; align-items: center; gap: 8px;
  font-size: 11px; color: #94a3b8;
`;
const ReplyCount = styled.span`
  font-size: 11px; font-weight: 700; color: #0d9488;
  background: #ccfbf1; border-radius: 999px; padding: 1px 7px;
`;

const DetailHeader = styled.div`
  flex-shrink: 0;
  display: flex; align-items: center; gap: 10px;
  padding: 16px 20px;
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
`;
const BackBtn = styled.button`
  display: none;
  width: 32px; height: 32px; flex-shrink: 0;
  align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 8px;
  color: #64748b; cursor: pointer;
  &:hover { background: #f1f5f9; color: #0f172a; }
  @media (max-width: 1024px) { display: inline-flex; }
`;
const DetailTitle = styled.h2`
  flex: 1; min-width: 0;
  font-size: 16px; font-weight: 700; color: #0f172a; margin: 0;
  line-height: 1.4; word-break: break-word;
`;
const Thread = styled.div`
  flex: 1; min-height: 0;
  padding: 20px;
  display: flex; flex-direction: column; gap: 16px;
`;
const MsgBlock = styled.div`
  display: flex; flex-direction: column; gap: 6px;
  padding: 12px 14px;
  background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px;
`;
const ReplyBlock = styled.div`
  display: flex; flex-direction: column; gap: 6px;
  margin-top: 8px; margin-left: 16px;
  padding: 12px 14px;
  background: #f0fdfa; border-radius: 12px;
  border-left: 3px solid #14b8a6;
`;
const MsgWho = styled.div<{ $reply?: boolean }>`
  display: flex; align-items: center; gap: 8px;
  font-size: 11px; font-weight: 700;
  color: ${p => (p.$reply ? '#0f766e' : '#94a3b8')};
  text-transform: uppercase; letter-spacing: 0.4px;
`;
const FollowTag = styled.span`
  font-size: 10px; font-weight: 700; color: #0d9488;
  background: #ccfbf1; border-radius: 999px; padding: 1px 7px;
  text-transform: none; letter-spacing: 0;
`;
const MsgDate = styled.span`
  margin-left: auto; font-size: 11px; font-weight: 500; color: #94a3b8;
  text-transform: none; letter-spacing: 0;
`;
const MsgBody = styled.div`
  font-size: 13px; color: #334155; line-height: 1.6;
  white-space: pre-wrap; word-break: break-word;
`;
const Composer = styled.div`
  flex-shrink: 0;
  padding: 16px 20px;
  border-top: 1px solid #e2e8f0;
  background: #ffffff;
  display: flex; flex-direction: column; gap: 10px;
`;
const ComposerLabel = styled.div`font-size: 12px; font-weight: 700; color: #475569;`;
const FollowTextarea = styled.textarea`
  padding: 10px 12px;
  border: 1px solid #e2e8f0; border-radius: 8px;
  font-size: 13px; color: #0f172a; font-family: inherit; resize: vertical;
  &:focus { outline: none; border-color: #14b8a6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
  @media (max-width: 1024px) { font-size: 16px; }
`;
const ComposerFooter = styled.div`display: flex; align-items: center; justify-content: space-between; gap: 12px;`;
const Hint = styled.span`font-size: 11px; color: #94a3b8;`;
const ResultMsg = styled.div`
  padding: 10px 12px;
  background: #f0fdfa; border: 1px solid #5eead4; border-radius: 8px;
  font-size: 13px; color: #0f766e;
`;
const LockedHint = styled.div`
  font-size: 12px; color: #94a3b8; text-align: center; line-height: 1.5;
`;
