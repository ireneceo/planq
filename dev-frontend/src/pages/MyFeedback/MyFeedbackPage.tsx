// 내 문의·피드백 (운영 #21·#54·#70) — 좌측 리스트 / 우측 스레드 상세 master-detail.
//   #54: 검색 + 카테고리/상태 필터.
//   #70: Q docs·Q note 식 좌/우 레이아웃 + ?item URL 싱크 + 답변 받은 항목에 추가 문의(스레드).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listRowTitleCss } from '../../theme/tokens';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import PageShell from '../../components/Layout/PageShell';
import SearchBox from '../../components/Common/SearchBox';
import HighlightText from '../../components/Common/HighlightText';
import MatchReason from '../../components/Common/MatchReason';
import { pickMatch } from '../../utils/searchMatch';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import ActionButton from '../../components/Common/ActionButton';
import { formatDate } from '../../utils/dateFormat';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { openFeedback } from '../../utils/feedbackOpen';
import { HeaderCta } from '../../components/Common/headerCta';
import EmptyState from '../../components/Common/EmptyState';
import { mapApiError } from '../../utils/apiError';
import { isEnterAction } from '../../utils/imeKey';

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
  // 추가 문의 입력칸은 **원할 때만** 연다(메일 답장처럼) — 늘 펼쳐 두면 대화 영역을 먹어 문의·답변을 못 읽었다
  const [composeOpen, setComposeOpen] = useState(false);
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
  // Q helper 에서 보낸 직후 — 이 화면에서 [+ 작성하기] 로 보냈든 우측 하단에서 보냈든 목록을 다시 읽는다
  useEffect(() => {
    const onSent = () => load(true);
    window.addEventListener('planq:feedback-sent', onSent);
    return () => window.removeEventListener('planq:feedback-sent', onSent);
  }, [load]);

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
  useEffect(() => { setFollowup(''); setResultMsg(null); setComposeOpen(false); }, [selectedId]);

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
      setComposeOpen(false);   // 보냈으면 접는다 — 보낸 글은 위 대화에 붙어 보인다
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
      actions={(
        <Filters>
          {threads.length > 0 && <>
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
          </>}
          {/* ★ 2026-09-21 — 이 화면에서도 쓴다. 양식을 새로 만들지 않고 **단일 진입점**(openFeedback)으로
              Q helper 작성 화면을 연다. 분류(버그·개선·기능 요청·기타)는 그 양식 안에서 고른다.
              자리는 필터 **뒤 맨 오른쪽**, 모양은 머리줄 주 액션 공용 `HeaderCta`(#14B8A6 · 32px) —
              프로젝트 [+ 새 프로젝트] · Q task [+ 업무 추가] 와 같은 버튼이다(Irene: "여기만 진한데?"). */}
          <HeaderCta type="button" data-testid="myfeedback-compose"
            onClick={() => openFeedback({ category: 'improve' })}>
            {t('myFeedback.compose') as string}
          </HeaderCta>
        </Filters>
      )}
    >
      {/* ★ 2026-09-21 — 아직 하나도 없으면 문서·노트와 같은 **가운데 빈 화면**(공용 EmptyState)을 띄운다.
          여태 왼쪽 목록 칸에 회색 한 줄만 있어 무엇을 해야 하는지가 안 보였다. */}
      {!loading && threads.length === 0 ? (
        <EmptyWrap>
          <EmptyState
            icon={(
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            )}
            title={t('myFeedback.emptyTitle') as string}
            description={t('myFeedback.scopeNote') as string}
            ctaLabel={t('myFeedback.compose') as string}
            onCta={() => openFeedback({ category: 'improve' })}
            ctaTestId="myfeedback-empty-compose"
          />
        </EmptyWrap>
      ) : (
      <Split $detailOpen={!!selected}>
        {/* 좌측 리스트 */}
        <ListPane $detailOpen={!!selected}>
          {/* #423 — 워크스페이스 안에 있지만 **솔루션(PlanQ) 문의**라는 것과 누가 보는지를 먼저 말한다 */}
          <ScopeNote>{t('myFeedback.scopeNote') as string}</ScopeNote>
          {loading ? (
            <Empty>{t('myFeedback.loading') as string}</Empty>
          ) : threads.length === 0 ? (
            <Empty>{t('myFeedback.empty') as string}</Empty>
          ) : filtered.length === 0 ? (
            <Empty>{t('myFeedback.noMatch') as string}</Empty>
          ) : (
            filtered.map(th => {
              const tone = STATUS_TONE[th.status] || STATUS_TONE.pending;
              // 목록엔 제목만 보인다 — 본문·답변·후속 글에서 찾았으면 어디서 찾았는지 한 줄로 (threadText 와 같은 필드)
              const hit = search.trim() ? pickMatch([
                { field: 'title', text: th.title, shown: true },
                { field: 'body', text: th.body },
                { field: 'message', text: [th.admin_response, ...th.replies.flatMap(r => [r.body, r.admin_response])] },
              ], search) : null;
              return (
                <ListRow key={th.id} $active={selectedId === th.id} type="button" onClick={() => select(th.id)}>
                  <RowTop>
                    <Cat>{catLabel(th.category)}</Cat>
                    <Status $bg={tone.bg} $fg={tone.fg}>{statusLabel(th.status)}</Status>
                    {th.awaiting_reply && <AwaitDot title={t('myFeedback.awaiting') as string} />}
                  </RowTop>
                  <RowTitle><HighlightText text={th.title} query={search} /></RowTitle>
                  {hit && !hit.shown && <MatchReason field={hit.field} snippet={hit.snippet} query={search} />}
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
              {/* 추가 문의 — 답변 받은 스레드만. 평소엔 한 줄 버튼, 눌러야 입력칸이 열린다(메일 [답장] 과 같은 방식) */}
              <Composer>
                {resultMsg && <ResultMsg>{resultMsg}</ResultMsg>}
                {!threadAnswered(selected) ? (
                  <LockedHint>{t('myFeedback.followup.locked') as string}</LockedHint>
                ) : !composeOpen ? (
                  <ComposerBar>
                    <ActionButton tone="secondary" size="sm" data-testid="myfeedback-followup-open"
                      onClick={() => { setComposeOpen(true); setResultMsg(null); window.setTimeout(() => followupRef.current?.focus(), 0); }}>
                      {t('myFeedback.followup.open') as string}
                    </ActionButton>
                  </ComposerBar>
                ) : (
                  <>
                    <ComposerLabel>{t('myFeedback.followup.title') as string}</ComposerLabel>
                    <FollowTextarea
                      ref={followupRef}
                      data-testid="myfeedback-followup-input"
                      value={followup}
                      onChange={e => setFollowup(e.target.value)}
                      placeholder={t('myFeedback.followup.placeholder') as string}
                      rows={3}
                      onKeyDown={e => {
                        if (e.nativeEvent.isComposing || (e.nativeEvent as KeyboardEvent).keyCode === 229) return;
                        if (isEnterAction(e) && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitFollowup(); }
                        if (e.key === 'Escape' && !followup.trim()) setComposeOpen(false);
                      }}
                    />
                    <ComposerFooter>
                      <Hint>{t('myFeedback.followup.hint') as string}</Hint>
                      <ComposerBtns>
                        <ActionButton tone="secondary" size="sm" onClick={() => setComposeOpen(false)}>
                          {t('myFeedback.followup.cancel') as string}
                        </ActionButton>
                        <ActionButton tone="primary" size="sm" loading={submitting}
                          disabled={!followup.trim()} onClick={submitFollowup}>
                          {t('myFeedback.followup.send') as string}
                        </ActionButton>
                      </ComposerBtns>
                    </ComposerFooter>
                  </>
                )}
              </Composer>
            </>
          )}
        </DetailPane>
      </Split>
      )}
    </PageShell>
  );
};

export default MyFeedbackPage;

// ─── styled ───
const Filters = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`;
const SelWrap = styled.div`min-width: 130px;`;

const EmptyWrap = styled.div`
  height: 100%; display: flex; align-items: center; justify-content: center; padding: 20px;
`;
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
  padding-bottom: var(--pq-fab-clearance, 88px);   /* 마지막 행이 FAB 밑에 깔리지 않게 */
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
  /* ★ 2026-09-21 — 스크롤은 **대화 영역(Thread) 하나**가 한다. 머리줄은 위에, 추가 문의는 아래에 붙는다.
     여태 이 패널이 스크롤하면서 Thread 는 flex:1·min-height:0 으로 **눌려 줄었는데 자기 스크롤이 없어**
     넘친 문의·답변이 잘렸다(Irene: "문의 내용을 볼 수가 없어. 스크롤이 안돼. 답변확인도 안돼").
     FAB 자리(88px)도 뺐다 — 이 상세에서는 FAB 가 숨겨져(RightDock #416) 빈 회색 띠만 남았다. */
  overflow: hidden;
  display: flex; flex-direction: column;
  @media (max-width: 1024px) {
    display: ${p => (p.$detailOpen ? 'flex' : 'none')};
  }
`;
const ScopeNote = styled.div`
  padding: 10px 14px; border-bottom: 1px solid #f1f5f9;
  font-size: 0.75rem; line-height: 1.5; color: #64748b; background: #f8fafc;
`;
const Empty = styled.div`padding: 40px 20px; text-align: center; font-size: 0.8125rem; color: #94a3b8;`;
const DetailEmpty = styled.div`
  flex: 1; display: flex; align-items: center; justify-content: center;
  padding: 40px 24px; text-align: center; font-size: 0.8125rem; color: #94a3b8; line-height: 1.6;
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
  font-size: 0.6875rem; font-weight: 700; color: #0f766e;
  background: #f0fdfa; border-radius: 999px; padding: 2px 8px;
`;
const Status = styled.span<{ $bg: string; $fg: string }>`
  font-size: 0.6875rem; font-weight: 700; border-radius: 999px; padding: 2px 8px;
  background: ${p => p.$bg}; color: ${p => p.$fg};
`;
const AwaitDot = styled.span`
  width: 7px; height: 7px; border-radius: 50%; background: #f59e0b; margin-left: auto;
`;
const RowTitle = styled.div`
  ${listRowTitleCss}
   font-weight: 600; color: #0f172a; line-height: 1.4;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
`;
const RowMeta = styled.div`
  display: flex; align-items: center; gap: 8px;
  font-size: 0.6875rem; color: #94a3b8;
`;
const ReplyCount = styled.span`
  font-size: 0.6875rem; font-weight: 700; color: #0d9488;
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
  font-size: 1rem; font-weight: 700; color: #0f172a; margin: 0;
  line-height: 1.4; word-break: break-word;
`;
const Thread = styled.div`
  flex: 1; min-height: 0;
  overflow-y: auto; overscroll-behavior: contain;
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
  font-size: 0.6875rem; font-weight: 700;
  color: ${p => (p.$reply ? '#0f766e' : '#94a3b8')};
  text-transform: uppercase; letter-spacing: 0.4px;
`;
const FollowTag = styled.span`
  font-size: 0.625rem; font-weight: 700; color: #0d9488;
  background: #ccfbf1; border-radius: 999px; padding: 1px 7px;
  text-transform: none; letter-spacing: 0;
`;
const MsgDate = styled.span`
  margin-left: auto; font-size: 0.6875rem; font-weight: 500; color: #94a3b8;
  text-transform: none; letter-spacing: 0;
`;
const MsgBody = styled.div`
  font-size: 0.8125rem; color: #334155; line-height: 1.6;
  white-space: pre-wrap; word-break: break-word;
`;
const Composer = styled.div`
  flex-shrink: 0;
  padding: 16px 20px;
  border-top: 1px solid #e2e8f0;
  background: #ffffff;
  display: flex; flex-direction: column; gap: 10px;
  @media (max-width: 640px) { padding-bottom: calc(16px + var(--pq-safe-bottom, 0px)); }
`;
const ComposerBar = styled.div`display: flex; justify-content: flex-end;`;
const ComposerBtns = styled.div`display: flex; gap: 8px; flex-shrink: 0;`;
const ComposerLabel = styled.div`font-size: 0.75rem; font-weight: 700; color: #475569;`;
const FollowTextarea = styled.textarea`
  padding: 10px 12px;
  border: 1px solid #e2e8f0; border-radius: 8px;
  font-size: 0.8125rem; color: #0f172a; font-family: inherit; resize: vertical;
  &:focus { outline: none; border-color: #14b8a6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
  @media (max-width: 1024px) { font-size: 1rem; }
`;
const ComposerFooter = styled.div`display: flex; align-items: center; justify-content: space-between; gap: 12px;`;
const Hint = styled.span`font-size: 0.6875rem; color: #94a3b8;`;
const ResultMsg = styled.div`
  padding: 10px 12px;
  background: #f0fdfa; border: 1px solid #5eead4; border-radius: 8px;
  font-size: 0.8125rem; color: #0f766e;
`;
const LockedHint = styled.div`
  font-size: 0.75rem; color: #94a3b8; text-align: center; line-height: 1.5;
`;
