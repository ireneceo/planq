// 사이클 P6 — platform_admin 의 사용자 피드백 관리 페이지
// 라우트: /admin/feedback
// 기능: 상태별 탭 (pending/reviewing/done/wontfix), 카테고리 필터, 답변 작성 + 상태 변경
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { listRowTitleCss } from '../../theme/tokens';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import { Tabs, Tab, Badge } from '../../components/Common/TabComponents';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import DetailDrawer from '../../components/Common/DetailDrawer';
import EmptyState from '../../components/Common/EmptyState';
import HighlightText from '../../components/Common/HighlightText';
import MatchReason from '../../components/Common/MatchReason';
import { pickMatch } from '../../utils/searchMatch';
import { useSearchParams } from 'react-router-dom';
import { refreshAdminTodo } from '../../hooks/useAdminInboxCounts';
import { apiFetch } from '../../contexts/AuthContext';
import { onSocket } from '../../services/socket';
import { useImageLightbox } from '../../components/Common/ImageLightbox';
import { formatDay, formatDayTime } from '../../utils/dateFormat';
import { TriageBox, TriageChip, type TriageVerdict, type TriageBody } from './AdminFeedbackTriage';

// 접수 → 검토중 → 진행대기(플랫폼관리자 승인) → 반영중 → 완료/보류 — 전이 판정은 서버 services/feedbackStatus 한 곳(2026-10-22).
type Status = 'pending' | 'reviewing' | 'queued' | 'in_progress' | 'done' | 'wontfix';
type Category = 'bug' | 'improve' | 'feature' | 'other';

interface FeedbackItem {
  id: number;
  user_id: number;
  business_id: number | null;
  category: Category;
  /** 문의 / 피드백 (2026-09-21) — 옛 행은 없을 수 있어 피드백으로 본다 */
  kind?: 'feedback' | 'inquiry';
  priority: 'normal' | 'high';
  title: string;
  body: string;
  page_url: string | null;
  /** 화면이 실어 보낸 사건 맥락 — 사용자가 다시 설명하지 않아도 되게. routes/feedback.js CTX_KEYS. */
  error_context: Record<string, string | number> | null;
  user_agent: string | null;
  status: Status;
  admin_response: string | null;
  responded_by: number | null;
  responded_at: string | null;
  approved_at?: string | null;
  /** 지금 상태에서 갈 수 있는 상태 — 서버가 정한다(전이 표를 화면에 베끼지 않는다) */
  next_statuses?: Status[];
  parent_id?: number | null;
  created_at: string;
  // N+63 — 사용자 호소 #3c 피드백 이미지 첨부 (base64 dataUrl 배열)
  attachments?: Array<{ name: string; type: string; dataUrl: string }> | null;
  /** 목록 응답은 첨부 원본 대신 개수만 싣는다 — 원본은 한 건을 열 때(?id=) 읽는다 (routes/feedback.js LIST_ATTRS) */
  attachment_count?: number;
  /** AI 원인 조사(읽기 전용 정찰) — 플랫폼관리자 전용. 목록은 판단·시각만, 본문은 한 건(?id=)에서 (docs/FEEDBACK_AI_TRIAGE_DESIGN.md) */
  ai_triage_verdict?: TriageVerdict | null;
  ai_triage_at?: string | null;
  ai_triage?: TriageBody | null;
  user?: { id: number; name: string; email: string };
  responder?: { id: number; name: string };
}

const STATUSES: Status[] = ['pending', 'reviewing', 'queued', 'in_progress', 'done', 'wontfix'];
const CATEGORIES: Category[] = ['bug', 'improve', 'feature', 'other'];

const AdminFeedbackPage = () => {
  const { t } = useTranslation('common');
  const triageLabel = (v: TriageVerdict) => t(`adminFeedback.triage.verdict.${v}`);
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  // 목록을 못 읽었을 때 — «피드백이 없습니다» 로 보이면 안 된다(2026-10-21: 서버 500 을 그렇게 숨겼다)
  const [loadError, setLoadError] = useState(false);
  const [activeStatus, setActiveStatus] = useState<Status>('pending');
  const [activeCategory, setActiveCategory] = useState<Category | 'all'>('all');
  // 문의/피드백 — 사용자 화면(개인 > 문의·피드백)과 같은 축으로 가른다
  const [activeKind, setActiveKind] = useState<'all' | 'inquiry' | 'feedback'>('all');
  const [search, setSearch] = useState('');
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<FeedbackItem | null>(null);
  const [response, setResponse] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // 서버가 전이를 거절한 이유(접수 → 진행대기 바로 등) — 저장이 안 됐는데 창이 닫히면 «아무 일도 없음» 으로 보인다
  const [submitError, setSubmitError] = useState<string | null>(null);
  // 방금 다른 단계로 옮긴 건 — 지금 탭에서 사라지므로 어디로 갔는지 한 줄로 남긴다(2026-10-29 Irene «보류로 바꿨더니 리스트에서 없어졌는데 보류에도 안나와»)
  const [moved, setMoved] = useState<{ id: number; status: Status } | null>(null);
  // 첨부 이미지 — data: 주소는 새 탭(최상위)으로 열리지 않는다(크롬·사파리가 막는다). 확대 보기로 연다.
  const { open: openLightbox, lightbox } = useImageLightbox();

  // 늦게 온 옛 조건의 응답은 버린다 — 알림 링크(?id=)로 열면 «접수» 탭 요청이 먼저 나가고 그 건의 탭 요청이 뒤따르는데,
  //   접수 목록이 크면 나중에 도착해 목록을 덮어써 상세가 안 열렸다(2026-10-22 카나리 실측).
  const loadSeq = useRef(0);
  const load = useCallback(async (silent = false) => {
    const seq = ++loadSeq.current;
    if (!silent) setLoading(true);
    try {
      const sp = new URLSearchParams();
      sp.set('status', activeStatus);
      if (activeCategory !== 'all') sp.set('category', activeCategory);
      if (activeKind !== 'all') sp.set('kind', activeKind);
      if (search.trim()) sp.set('q', search.trim());
      const r = await apiFetch(`/api/feedback/admin?${sp.toString()}`);
      const j = await r.json().catch(() => null);
      if (seq !== loadSeq.current) return;
      if (j?.success) { setItems(j.data || []); setLoadError(false); }
      else if (!silent) setLoadError(true);
    } catch { if (seq === loadSeq.current && !silent) setLoadError(true); /* silent 재조회 실패는 보던 목록을 그대로 둔다 */ }
    finally { if (seq === loadSeq.current && !silent) setLoading(false); }
  }, [activeStatus, activeCategory, activeKind, search]);

  const loadCounts = useCallback(async () => {
    try {
      const r = await apiFetch('/api/feedback/admin/counts');
      const j = await r.json();
      if (j.success) setCounts(j.data || {});
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadCounts(); }, [loadCounts]);

  // 실시간 — 처음 한 번만 읽으면 화면을 열어 둔 채(폰 앱·탭 유지) 들어온 피드백이 영영 안 보인다
  //   (2026-10-19 Irene: "지금 피드백 들어왔는데 모바일리스트에 안나와").
  //   관리자 알림 도착(business_id null) · 같은 탭에서 처리 · 탭/앱 복귀에 다시 읽는다 — AdminInboxPage 와 같은 신호.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const soon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void load(true); void loadCounts(); }, 250);
    };
    const onVisible = () => { if (document.visibilityState === 'visible') soon(); };
    window.addEventListener('admin-todo:refresh', soon);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', soon);
    const off = onSocket<{ business_id?: number | null }>('notification:new', (p) => { if (p?.business_id == null) soon(); });
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('admin-todo:refresh', soon);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', soon);
      off();
    };
  }, [load, loadCounts]);

  // 확인 필요에서 넘어온 주소 — ?status=pending|reviewing&id=:id (그 탭을 열고 그 건을 연다)
  const [params] = useSearchParams();
  useEffect(() => {
    const st = params.get('status') as Status | null;
    if (st && STATUSES.includes(st)) setActiveStatus(st);
    const id = params.get('id');
    if (!id || !/^\d+$/.test(id)) return;
    setDetailId(Number(id));
    // 알림 링크(?id= 만)는 그 건의 상태를 모른다 — 다른 탭을 보고 있으면 상세가 안 열렸다.
    //   그 건을 직접 읽어 그 상태의 탭으로 옮긴다(분류·종류·검색 필터도 풀어 목록에 반드시 보이게).
    if (!st) {
      void (async () => {
        try {
          const r = await apiFetch(`/api/feedback/admin?id=${id}`);
          const j = await r.json();
          const one: FeedbackItem | undefined = j?.success ? j.data?.[0] : undefined;
          if (!one) return;
          setActiveCategory('all'); setActiveKind('all'); setSearch('');
          setActiveStatus(one.status);
        } catch { /* 열지 못하면 목록만 보인다 */ }
      })();
    }
  }, [params]);

  // detail 선택 시 폼 prefill — 목록 행으로 먼저 열고, 첨부 원본은 그 한 건을 따로 읽어 채운다
  useEffect(() => {
    const it = items.find(x => x.id === detailId);
    setDetail(it || null);
    setResponse(it?.admin_response || '');
    setSubmitError(null);
  }, [detailId, items]);
  // 목록 행에 없는 것(첨부 원본·AI 조사 본문)은 그 한 건을 따로 읽어 채운다
  const needFull = !!detail && (((detail.attachment_count || 0) > 0 && !detail.attachments) || (!!detail.ai_triage_at && detail.ai_triage === undefined));
  useEffect(() => {
    if (!needFull || detailId == null) return;
    let alive = true;
    void (async () => {
      try {
        const r = await apiFetch(`/api/feedback/admin?id=${detailId}`);
        const j = await r.json();
        const one: FeedbackItem | undefined = j?.success ? j.data?.[0] : undefined;
        if (alive && one) setDetail(prev => (prev && prev.id === one.id ? { ...prev, attachments: one.attachments, ai_triage: one.ai_triage ?? null } : prev));
      } catch { /* 첨부를 못 읽으면 첨부 칸만 비어 있다 */ }
    })();
    return () => { alive = false; };
  }, [needFull, detailId]);

  // 단계 버튼 하나 = 그 단계 + 지금 적은 답글로 바로 저장. 인자 없음 = 답글만(상태 그대로).
  //   ★ 옛 화면은 «상태» 셀렉트 + [승인 — 진행대기로] 였는데 승인 버튼이 셀렉트 값을 덮어써서
  //     «보류» 를 고르고 초록 버튼을 누르면 진행대기로 갔다(= 승인 안 한 것이 개발 대기열에). 고른 것과 누른 것이 같은 버튼이게 했다.
  const submit = async (nextStatus?: Status) => {
    if (!detail || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const r = await apiFetch(`/api/feedback/${detail.id}/respond`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: nextStatus || detail.status,
          admin_response: response.trim(),
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) {
        const code = j?.code || j?.message || 'unknown';
        setSubmitError(t(`adminFeedback.transitionError.${code}`, { defaultValue: t('adminFeedback.transitionError.unknown') as string }) as string);
        return;
      }
      setDetailId(null);
      setMoved(nextStatus && nextStatus !== detail.status ? { id: detail.id, status: nextStatus } : null);
      await Promise.all([load(), loadCounts()]);
      refreshAdminTodo();
    } finally { setSubmitting(false); }
  };
  // 갈 수 있는 단계는 서버가 준다(next_statuses — 전이 표를 화면에 베끼지 않는다). 첫 값이 앞으로 가는 단계라 주 버튼.
  const nextChoices: Status[] = detail?.next_statuses || [];
  const moveLabel = (from: Status, to: Status) => {
    // 거꾸로 가는 전이(승인 취소·다시 열기)는 이름이 다르다
    const back = (to === 'reviewing' && from !== 'pending') || (to === 'queued' && from === 'in_progress');
    return t(back ? `adminFeedback.moveAction_back.${to}` : `adminFeedback.moveAction.${to}`) as string;
  };

  const filtered = useMemo(() => items, [items]);

  return (
    <PageShell
      title={t('adminFeedback.title', '사용자 피드백') as string}
      count={counts.total || 0}
      actions={
        <>
          <SearchInput
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('adminFeedback.searchPh', '제목·내용 검색') as string}
          />
          <PlanQSelect
            size="sm" isSearchable={false}
            value={{ value: activeKind, label: t(`adminFeedback.kind.${activeKind}`) as string }}
            onChange={(opt) => setActiveKind(((opt as PlanQSelectOption | null)?.value as 'all' | 'inquiry' | 'feedback') || 'all')}
            options={(['all', 'inquiry', 'feedback'] as const).map(k => ({ value: k, label: t(`adminFeedback.kind.${k}`) as string }))}
          />
          <PlanQSelect
            size="sm" isSearchable={false}
            value={{ value: activeCategory, label: activeCategory === 'all' ? (t('adminFeedback.allCategories', '전체 분류') as string) : (t(`qhelper.fbCat.${activeCategory}`) as string) }}
            onChange={(opt) => {
              const v = (opt as PlanQSelectOption | null)?.value as Category | 'all' | undefined;
              setActiveCategory(v || 'all');
            }}
            options={[
              { value: 'all', label: t('adminFeedback.allCategories', '전체 분류') as string },
              ...CATEGORIES.map(c => ({ value: c, label: t(`qhelper.fbCat.${c}`) as string })),
            ]}
          />
        </>
      }
    >
      <Tabs>
        {STATUSES.map(s => (
          <Tab key={s} active={activeStatus === s} onClick={() => { setActiveStatus(s); setMoved(null); }}>
            {t(`adminFeedback.status.${s}`)} <Badge count={counts[s] || 0} showZero />
          </Tab>
        ))}
      </Tabs>

      {moved && moved.status !== activeStatus && (
        <MovedBar role="status" data-testid="admin-feedback-moved">
          <span>{t('adminFeedback.movedNotice', { id: moved.id, status: t(`adminFeedback.status.${moved.status}`) })}</span>
          <MovedLink type="button" onClick={() => {
            setActiveCategory('all'); setActiveKind('all'); setSearch('');
            setActiveStatus(moved.status); setDetailId(moved.id); setMoved(null);
          }}>{t('adminFeedback.movedView')}</MovedLink>
        </MovedBar>
      )}

      {loading ? <Loading>{t('loading', '로딩 중…')}</Loading> :
       loadError ? (
        <div data-testid="admin-feedback-load-error">
        <EmptyState
          title={t('adminFeedback.loadError', '목록을 불러오지 못했습니다') as string}
          ctaLabel={t('adminFeedback.retry', '다시 불러오기') as string}
          onCta={() => { void load(); void loadCounts(); }}
        />
        </div>
       ) :
       filtered.length === 0 ? (
        <EmptyState
          icon={<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>}
          title={t('adminFeedback.empty', '해당 상태의 피드백이 없습니다') as string}
        />
       ) : (
        <List>
          {filtered.map(it => {
            const shownBody = (it.body || '').replace(/\s+/g, ' ').trim().slice(0, 80);
            // 서버 검색은 title·body — 행에는 본문 앞 80자만 보인다. 제목이나 뒷부분에서 맞았으면 이유를 붙인다.
            const hit = pickMatch([
              { field: 'content', text: shownBody, shown: true },
              { field: 'title', text: it.title },
              { field: 'content', text: it.body },
            ], search);
            return (
            <Row key={it.id} data-testid="admin-feedback-row" $active={detailId === it.id} onClick={() => setDetailId(prev => prev === it.id ? null : it.id)}>
              <KindChip $inq={it.kind === 'inquiry'}>{t(`adminFeedback.kind.${it.kind === 'inquiry' ? 'inquiry' : 'feedback'}`)}</KindChip>
              {it.kind !== 'inquiry' && <CatChip $cat={it.category}>{t(`qhelper.fbCat.${it.category}`)}</CatChip>}
              {it.priority === 'high' && <UrgentChip>{t('adminFeedback.urgent', '긴급')}</UrgentChip>}
              {it.ai_triage_verdict && <TriageChip $v={it.ai_triage_verdict} data-testid="admin-feedback-triage-chip">{triageLabel(it.ai_triage_verdict)}</TriageChip>}
              <RowTitle>
                {shownBody ? <HighlightText text={shownBody} query={search} /> : `#${it.id}`}
                {hit && !hit.shown && <MatchReason field={hit.field} snippet={hit.snippet} query={search} />}
              </RowTitle>
              <RowMeta>
                {it.user?.name || `#${it.user_id}`} · {formatDay(it.created_at, { year: 'always' })}
              </RowMeta>
            </Row>
            );
          })}
        </List>
       )}

      <DetailDrawer
        open={!!detail}
        onClose={() => setDetailId(null)}
        ariaLabel={t('adminFeedback.detailTitle', '피드백 상세') as string}
      >
        <DetailDrawer.Header onClose={() => setDetailId(null)}>
          <DrawerTitle>#{detail?.id}</DrawerTitle>
        </DetailDrawer.Header>
        <DetailDrawer.Body>
          {detail && (
            <DrawerSections>
              <Section>
                <ChipRow>
                  <KindChip $inq={detail.kind === 'inquiry'}>{t(`adminFeedback.kind.${detail.kind === 'inquiry' ? 'inquiry' : 'feedback'}`)}</KindChip>
                  {detail.kind !== 'inquiry' && <CatChip $cat={detail.category}>{t(`qhelper.fbCat.${detail.category}`)}</CatChip>}
                  {detail.priority === 'high' && <UrgentChip>{t('adminFeedback.urgent', '긴급')}</UrgentChip>}
                  <StatusChip $s={detail.status}>{t(`adminFeedback.status.${detail.status}`)}</StatusChip>
                </ChipRow>
                <Meta>
                  <MetaRow><MetaLabel>{t('adminFeedback.user', '사용자')}</MetaLabel><MetaValue>{detail.user?.name} ({detail.user?.email})</MetaValue></MetaRow>
                  <MetaRow><MetaLabel>{t('adminFeedback.workspace', '워크스페이스')}</MetaLabel><MetaValue>#{detail.business_id ?? '—'}</MetaValue></MetaRow>
                  <MetaRow><MetaLabel>{t('adminFeedback.page', '발생 페이지')}</MetaLabel><MetaValue>{detail.page_url || '—'}</MetaValue></MetaRow>
                  {detail.error_context && Object.keys(detail.error_context).length > 0 && (
                    <MetaRow>
                      <MetaLabel>{t('adminFeedback.errorContext', '사건 맥락')}</MetaLabel>
                      <MetaValue>
                        {/* 값을 텍스트로만 그린다 — 사용자가 보낸 문자열이다 */}
                        {Object.entries(detail.error_context).map(([k, v]) => (
                          <div key={k}><b>{k}</b>: {String(v)}</div>
                        ))}
                      </MetaValue>
                    </MetaRow>
                  )}
                  <MetaRow><MetaLabel>{t('adminFeedback.ua', '브라우저')}</MetaLabel><MetaValue>{(detail.user_agent || '—').slice(0, 80)}</MetaValue></MetaRow>
                  <MetaRow><MetaLabel>{t('adminFeedback.createdAt', '제출')}</MetaLabel><MetaValue>{formatDayTime(detail.created_at, { year: 'always' })}</MetaValue></MetaRow>
                  {detail.approved_at && (
                    <MetaRow><MetaLabel>{t('adminFeedback.approvedAt', '승인')}</MetaLabel><MetaValue>{formatDayTime(detail.approved_at, { year: 'always' })}</MetaValue></MetaRow>
                  )}
                </Meta>
              </Section>
              <Section>
                <SectionLabel>{t('adminFeedback.body', '내용')}</SectionLabel>
                <BodyBox>{detail.body}</BodyBox>
              </Section>
              {detail.kind !== 'inquiry' && !detail.parent_id && (
                <Section data-testid="admin-feedback-triage">
                  <SectionLabel>{t('adminFeedback.triage.title', 'AI 원인 조사')}</SectionLabel>
                  <TriageBox detail={detail} label={triageLabel} />
                </Section>
              )}
              {/* N+63 — 사용자 호소 #3c 피드백 이미지 첨부 표시. base64 dataUrl 직접 src. */}
              {Array.isArray(detail.attachments) && detail.attachments.length > 0 && (
                <Section>
                  <SectionLabel>{t('adminFeedback.attachments', '첨부 이미지')} ({detail.attachments.length})</SectionLabel>
                  <AttachGrid>
                    {detail.attachments.map((a, i, all) => (
                      <AttachItem key={i} type="button" data-testid="admin-feedback-attach" title={a.name}
                        aria-label={t('adminFeedback.attachOpen', { name: a.name }) as string}
                        onClick={() => openLightbox(all.map(x => ({ src: x.dataUrl, alt: x.name })), i)}>
                        <AttachThumb src={a.dataUrl} alt={a.name} />
                        <AttachLabel>{a.name}</AttachLabel>
                      </AttachItem>
                    ))}
                  </AttachGrid>
                </Section>
              )}
              <Section>
                <SectionLabel>{t('adminFeedback.response', '운영팀 답변')}</SectionLabel>
                <FlowHint>{t(detail.parent_id ? 'adminFeedback.flowHintFollowup' : 'adminFeedback.flowHint')}</FlowHint>
                <ResponseArea
                  value={response}
                  onChange={e => setResponse(e.target.value)}
                  placeholder={t('adminFeedback.responsePh', '사용자에게 보낼 답변을 작성하세요') as string}
                  rows={6}
                />
              </Section>
            </DrawerSections>
          )}
        </DetailDrawer.Body>
        <DetailDrawer.Footer>
          {submitError && <SubmitError role="alert" data-testid="admin-feedback-submit-error">{submitError}</SubmitError>}
          {detail && (
            <FooterActions>
              <SecondaryBtn type="button" data-testid="admin-feedback-save" onClick={() => { void submit(); }} disabled={submitting}>
                {t('adminFeedback.saveReply')}
              </SecondaryBtn>
              {nextChoices.slice().reverse().map((s) => {
                const primary = s === nextChoices[0];
                const Btn = primary ? PrimaryBtn : SecondaryBtn;
                return (
                  <Btn key={s} type="button" data-testid={s === 'queued' ? 'admin-feedback-approve' : `admin-feedback-move-${s}`}
                    onClick={() => { void submit(s); }} disabled={submitting}>
                    {submitting && primary ? t('saving') : moveLabel(detail.status, s)}
                  </Btn>
                );
              })}
            </FooterActions>
          )}
        </DetailDrawer.Footer>
      </DetailDrawer>
      {lightbox}
    </PageShell>
  );
};

export default AdminFeedbackPage;

// ─── styled ───
const SearchInput = styled.input`
  width: 200px; height: 32px; padding: 0 10px;
  /* 폰 — 액션 줄(PageShell PhoneActionRow)에 셀렉트 둘과 같이 들어가게 남는 폭만 쓴다. 고정 200 이면 «분류» 셀렉트가 화면 밖으로 밀렸다. */
  @media (max-width: 640px) { width: auto; flex: 1 1 0; min-width: 80px; }
  border: 1px solid #E2E8F0; border-radius: 6px;
  font-size: 0.8125rem; color: #0F172A;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
`;
const Loading = styled.div`padding: 40px; text-align: center; color: #94A3B8;`;
const List = styled.div`display: flex; flex-direction: column; gap: 0;`;
const Row = styled.div<{ $active: boolean }>`
  cursor: pointer;
  display: grid;
  grid-template-columns: auto auto minmax(200px, 1fr) auto;
  gap: 12px; align-items: center;
  padding: 12px 16px;
  background: ${p => p.$active ? '#F0FDFA' : '#FFFFFF'};
  border-bottom: 1px solid #E2E8F0;
  transition: background 0.12s;
  &:first-child { border-top: 1px solid #E2E8F0; }
  &:hover { background: ${p => p.$active ? '#F0FDFA' : '#F8FAFC'}; }
  /* 폰 — 칩·제목 한 줄, 작성자·날짜는 아래 줄. 4칸 한 줄이면 제목 최소 200px 때문에 작성자가 잘리고 칩 글자가 세로로 섰다. */
  @media (max-width: 640px) {
    display: flex; flex-wrap: wrap;
    gap: 4px 8px; padding: 10px 12px;
    & > :nth-last-child(2) { flex: 1 1 0; min-width: 0; }
    & > :last-child { flex-basis: 100%; }
  }
`;
const RowTitle = styled.div`
  ${listRowTitleCss}
   font-weight: 600; color: #0F172A;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const RowMeta = styled.div`
  font-size: 0.75rem; color: #64748B;
  white-space: nowrap; flex-shrink: 0;
`;
// 종류 배지 — 사용자 화면(MyFeedbackPage KindTag)과 같은 색: 문의 파랑 · 피드백 회색 테두리
const KindChip = styled.span<{ $inq: boolean }>`
  flex-shrink: 0; white-space: nowrap; font-size: 0.6875rem; font-weight: 700; border-radius: 6px; padding: 2px 7px;
  color: ${p => (p.$inq ? '#1D4ED8' : '#475569')};
  background: ${p => (p.$inq ? '#EFF6FF' : '#FFFFFF')};
  border: 1px solid ${p => (p.$inq ? '#BFDBFE' : '#E2E8F0')};
`;
const CatChip = styled.span<{ $cat: Category }>`
  flex-shrink: 0; white-space: nowrap;
  padding: 3px 10px; border-radius: 999px;
  font-size: 0.6875rem; font-weight: 700;
  ${p => p.$cat === 'bug' ? 'background:#FEE2E2;color:#B91C1C;' :
        p.$cat === 'improve' ? 'background:#DCFCE7;color:#166534;' :
        p.$cat === 'feature' ? 'background:#DBEAFE;color:#1E40AF;' :
        'background:#F1F5F9;color:#475569;'}
`;
const UrgentChip = styled.span`
  flex-shrink: 0; white-space: nowrap;
  padding: 3px 10px; border-radius: 999px;
  background: #F43F5E; color: #FFFFFF;
  font-size: 0.6875rem; font-weight: 700;
`;
const StatusChip = styled.span<{ $s: Status }>`
  padding: 3px 10px; border-radius: 999px;
  font-size: 0.6875rem; font-weight: 700;
  ${p => p.$s === 'pending' ? 'background:#FEF3C7;color:#92400E;' :
        p.$s === 'reviewing' ? 'background:#DBEAFE;color:#1E40AF;' :
        p.$s === 'queued' ? 'background:#CCFBF1;color:#0F766E;' :
        p.$s === 'in_progress' ? 'background:#EDE9FE;color:#5B21B6;' :
        p.$s === 'done' ? 'background:#DCFCE7;color:#166534;' :
        'background:#F1F5F9;color:#64748B;'}
`;
const ChipRow = styled.div`display: flex; align-items: center; gap: 6px; flex-wrap: wrap;`;
// Drawer
const DrawerTitle = styled.div`font-size: 0.9375rem; font-weight: 700; color: #0F172A; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const DrawerSections = styled.div`display: flex; flex-direction: column; gap: 20px; padding: 20px;`;
const Section = styled.div`display: flex; flex-direction: column; gap: 10px;`;
const SectionLabel = styled.div`
  font-size: 0.6875rem; font-weight: 700; color: #64748B;
  text-transform: uppercase; letter-spacing: 0.5px;
`;
const Meta = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const MetaRow = styled.div`display: grid; grid-template-columns: 100px 1fr; gap: 12px; font-size: 0.78125rem;`;
const MetaLabel = styled.div`color: #64748B;`;
const MetaValue = styled.div`color: #0F172A; word-break: break-all;`;
const BodyBox = styled.pre`
  margin: 0; padding: 12px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 0.8125rem; color: #0F172A; font-family: inherit;
  white-space: pre-wrap; word-break: break-word;
  max-height: 240px; overflow-y: auto;
`;
// N+63 — 피드백 첨부 이미지 grid
const AttachGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
`;
const AttachItem = styled.button`
  display: flex; flex-direction: column; gap: 4px; min-width: 0;
  text-align: left; font: inherit; cursor: zoom-in;
  text-decoration: none; color: inherit;
  padding: 6px; border: 1px solid #E2E8F0; border-radius: 8px;
  background: #FFFFFF;
  transition: border-color 0.15s, box-shadow 0.15s;
  &:hover { border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.1); }
`;
const AttachThumb = styled.img`
  /* contain — 스크린샷 글씨가 잘리지 않게(cover 였을 때 가운데만 보였다) */
  width: 100%; aspect-ratio: 1; object-fit: contain;
  border-radius: 6px; background: #F1F5F9;
`;
const AttachLabel = styled.div`
  font-size: 0.6875rem; color: #64748B;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const MovedBar = styled.div`
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin: 12px 0 0; padding: 8px 12px;
  background: #F0FDFA; border: 1px solid #99F6E4; border-radius: 8px;
  font-size: 0.8125rem; color: #0F766E;
`;
const MovedLink = styled.button`
  background: none; border: none; padding: 0; cursor: pointer;
  font: inherit; font-weight: 700; color: #0D9488; text-decoration: underline;
`;
const FooterActions = styled.div`
  margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end;
`;
const ResponseArea = styled.textarea`
  width: 100%; padding: 10px 12px;
  border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 0.8125rem; color: #0F172A; font-family: inherit; resize: vertical;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
`;
const FlowHint = styled.div`font-size: 0.75rem; color: #64748B; line-height: 1.5;`;
const SubmitError = styled.div`font-size: 0.75rem; font-weight: 600; color: #B91C1C; min-width: 0;`;
const SecondaryBtn = styled.button`
  height: 36px; padding: 0 16px;
  background: #FFFFFF; color: #334155;
  border: 1px solid #CBD5E1; border-radius: 8px;
  font-size: 0.8125rem; font-weight: 600; cursor: pointer;
  &:disabled { color: #94A3B8; cursor: not-allowed; }
  &:hover:not(:disabled) { background: #F8FAFC; }
`;
const PrimaryBtn = styled.button`
  height: 36px; padding: 0 18px;
  background: #14B8A6; color: #FFFFFF;
  border: none; border-radius: 8px;
  font-size: 0.8125rem; font-weight: 600; cursor: pointer;
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
  &:hover:not(:disabled) { background: #0D9488; }
`;
