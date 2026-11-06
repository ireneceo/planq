// /admin/followup — 신규 고객 팔로업 (2026-11-06, docs/ADMIN_FOLLOWUP_DESIGN.md · Fable 설계 DESIGN-FIX 정본)
//
// Irene: "누가 누가 들어왔고 지금 어떤 상태이고 어떤 도움을 전하면 될지, 메시지도 직접 보내게 해줘서 밀착마크하게."
//
// 가입 N일 이내 ∨ 체험 중 워크스페이스 한 줄씩 → 상태·빠진 설정·막힘 신호·«도울 일» → [메시지] 드로어
//   (위: 도울 일 칩 → 누르면 대표 언어 초안이 입력칸에 · 여정(기존 AdminBusinessJourney) · 아래: 안내방 대화(기존 부품)).
// ★ 자동 발송 없음 — 관리자가 읽고 고쳐 보낸다. 사용 모양만(서버가 제목·본문을 싣지 않는다). URL 싱크 ?business=:id.
// 실시간: 안내방 글 → 'support:updated'(번호만) → 목록·열린 방을 서버 값으로 다시 읽는다 + 탭 복귀 재조회.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import PageShell from '../../components/Layout/PageShell';
import DetailDrawer from '../../components/Common/DetailDrawer';
import EmptyState from '../../components/Common/EmptyState';
import SearchBox from '../../components/Common/SearchBox';
import { FilterBar, FilterSearchSlot, FilterRight } from '../../components/Common/filterBar';
import { SegmentedToggle, SegmentedBtn } from '../../components/Common/segmentedToggle';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { onSocket } from '../../services/socket';
import { scopedStorage } from '../../services/accounts';
import { listRowTitleCss } from '../../theme/tokens';
import { SecondaryBtn } from './adminModalKit';
import AdminBusinessJourney from './AdminBusinessJourney';
import { useSupportRoom, SupportThread, SupportComposer, type ComposerInsert } from './AdminSupportThread';
import {
  fetchFollowup, fetchFollowupDraft,
  type FollowupRow, type FollowupHelp, type FollowupDays, type FollowupSort, type AdminJourneySignal,
} from '../../services/admin';

const PAGE = 50;
const DAY_OPTIONS: FollowupDays[] = [7, 30, 90];
const SORT_KEY = 'planq:admin:followup:sort';
const DAY = 24 * 60 * 60 * 1000;

function readSort(): FollowupSort {
  try { return scopedStorage.get(SORT_KEY) === 'help' ? 'help' : 'recent'; } catch { return 'recent'; }
}

export default function AdminFollowupPage() {
  const { t } = useTranslation('admin');
  const { formatDate, formatDateTime } = useTimeFormat();
  const [params, setParams] = useSearchParams();
  const activeId = params.get('business') ? Number(params.get('business')) : null;

  const [days, setDays] = useState<FollowupDays>(30);
  const [sort, setSort] = useState<FollowupSort>(readSort);
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<FollowupRow[]>([]);
  const [total, setTotal] = useState(0);
  const [shown, setShown] = useState(PAGE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [insert, setInsert] = useState<ComposerInsert | null>(null);
  const [draftError, setDraftError] = useState(false);
  const { room, roomError, reload: loadRoom } = useSupportRoom(activeId);

  // 검색은 300ms 묶어 서버로
  useEffect(() => { const h = window.setTimeout(() => setQ(qInput.trim()), 300); return () => window.clearTimeout(h); }, [qInput]);
  useEffect(() => { try { scopedStorage.set(SORT_KEY, sort); } catch { /* 저장 안 돼도 화면은 그대로 */ } }, [sort]);

  const shownRef = useRef(shown);
  shownRef.current = shown;
  const loadList = useCallback(async () => {
    try {
      const r = await fetchFollowup({ days, sort, q, limit: Math.min(shownRef.current, PAGE), offset: 0 });
      let list = r.rows;
      // «더 보기» 로 늘린 만큼 이어서(한 번에 50까지라 나눠 받는다)
      for (let off = PAGE; off < shownRef.current && off < r.total; off += PAGE) {
        list = list.concat((await fetchFollowup({ days, sort, q, limit: PAGE, offset: off })).rows);
      }
      setRows(list); setTotal(r.total); setError(false);
    } catch { setError(true); }
    finally { setLoading(false); }
  }, [days, sort, q]);
  useEffect(() => { setLoading(true); setShown(PAGE); }, [days, sort, q]);
  useEffect(() => { void loadList(); }, [loadList, shown]);

  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  useEffect(() => {
    let timer: number | null = null;
    const off = onSocket<{ business_id: number }>('support:updated', (p) => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void loadList();
        if (activeRef.current && p && p.business_id === activeRef.current) void loadRoom();
      }, 250);
    });
    return () => { off(); if (timer) window.clearTimeout(timer); };
  }, [loadList, loadRoom]);
  useVisibilityRefresh(useCallback(() => { void loadList(); if (activeRef.current) void loadRoom(); }, [loadList, loadRoom]));

  const select = (id: number) => {
    if (activeId === id) params.delete('business'); else params.set('business', String(id));
    setParams(params, { replace: true });
  };
  const close = () => { params.delete('business'); setParams(params, { replace: true }); };
  useEffect(() => { setInsert(null); setDraftError(false); }, [activeId]);

  const activeRow = useMemo(() => rows.find((r) => r.business.id === activeId) || null, [rows, activeId]);

  const applyDraft = async (h: FollowupHelp) => {
    if (!activeId) return;
    setDraftError(false);
    try {
      const d = await fetchFollowupDraft(activeId, h.key);
      setInsert({ text: d.text, ruleKey: h.key, nonce: Date.now() });
    } catch { setDraftError(true); }
  };

  const signalText = (s: AdminJourneySignal) => t(`journey.signal.${s.key}`, { days: s.days, count: s.count, stage: s.stage, defaultValue: s.key });
  const helpText = (h: FollowupHelp) => t(`followup.help.${h.key}`, { ...h.params, defaultValue: h.key });
  const sentText = (h: FollowupHelp) => {
    if (!h.sent_at) return null;
    const d = Math.max(0, Math.floor((Date.now() - new Date(h.sent_at).getTime()) / DAY));
    return d === 0 ? t('followup.sentToday', '오늘 보냄') : t('followup.sentDaysAgo', { count: d, defaultValue: '{{count}}일 전 보냄' });
  };
  const trialText = (r: FollowupRow) => {
    if (r.subscription_status !== 'trialing' || r.trial_days_left == null) return t(`subs.status.${r.subscription_status || 'no_subscription'}`, r.subscription_status || '');
    if (r.trial_days_left < 0) return t('followup.trialEnded', { count: -r.trial_days_left, defaultValue: '체험 끝남 {{count}}일' });
    return t('followup.trialLeft', { count: r.trial_days_left, defaultValue: '체험 D-{{count}}' });
  };
  const stageText = (r: FollowupRow) => (!r.stage ? t('journey.noOwner', '사람 멤버 없음')
    : r.stage.current == null ? t('journey.stageDone', '모든 단계 완료')
      : t('journey.stageOf', { cur: r.stage.current, count: r.stage.stage_count || 5, defaultValue: '{{cur}} / {{count}} 단계' }));
  // 빠진 설정만 회색 칩으로(켜진 것까지 늘어놓으면 줄이 길어진다 — Fable)
  const missing = (r: FollowupRow) => [
    !r.setup.app && t('followup.missing.app', '앱 없음'),
    !r.setup.notifications && t('followup.missing.notifications', '알림 꺼짐'),
    !r.setup.calendar && t('followup.missing.calendar', '캘린더 없음'),
    !r.setup.ai_app && t('followup.missing.ai_app', 'AI 앱 없음'),
    r.setup.mail_accounts === 0 && t('followup.missing.mail', '메일 없음'),
  ].filter(Boolean) as string[];

  return (
    <PageShell title={t('followup.title', '신규 고객')} count={total}>
      <Desc>{t('followup.desc', '최근 가입했거나 체험 중인 워크스페이스입니다. 상태를 보고 «도울 일» 을 골라 안내방으로 직접 메시지를 보낼 수 있어요. 자동으로 보내지 않습니다.')}</Desc>
      <FilterBar data-testid="admin-followup-filter">
        <FilterSearchSlot>
          <SearchBox value={qInput} onChange={setQInput} width="100%"
            placeholder={t('followup.searchPh', '워크스페이스·이메일 검색') as string}
            ariaLabel={t('followup.searchPh', '워크스페이스·이메일 검색') as string} />
        </FilterSearchSlot>
        <FilterRight>
          <SegmentedToggle role="group" aria-label={t('followup.daysLabel', '가입 기간') as string}>
            {DAY_OPTIONS.map((d) => (
              <SegmentedBtn key={d} type="button" $active={days === d} aria-pressed={days === d} onClick={() => setDays(d)} data-testid={`admin-followup-days-${d}`}>
                {t('followup.days', { count: d, defaultValue: '{{count}}일' })}
              </SegmentedBtn>
            ))}
          </SegmentedToggle>
          <SegmentedToggle role="group" aria-label={t('followup.sortLabel', '정렬') as string}>
            <SegmentedBtn type="button" $active={sort === 'recent'} aria-pressed={sort === 'recent'} onClick={() => setSort('recent')} data-testid="admin-followup-sort-recent">
              {t('followup.sortRecent', '가입 최신순')}
            </SegmentedBtn>
            <SegmentedBtn type="button" $active={sort === 'help'} aria-pressed={sort === 'help'} onClick={() => setSort('help')} data-testid="admin-followup-sort-help">
              {t('followup.sortHelp', '도울 일 먼저')}
            </SegmentedBtn>
          </SegmentedToggle>
        </FilterRight>
      </FilterBar>

      {loading && rows.length === 0 && <Dim>{t('followup.loading', '불러오는 중…')}</Dim>}
      {error && <ErrorText>{t('followup.loadFailed', '목록을 불러오지 못했어요')}</ErrorText>}
      {!loading && !error && rows.length === 0 && (
        <EmptyState title={t('followup.empty', '이 기간에 새로 들어온 곳이 없어요')} description={t('followup.emptyDesc', '기간을 늘리거나 검색어를 바꿔 보세요.')} />
      )}

      <List data-testid="admin-followup-list">
        {rows.map((r) => {
          const miss = missing(r);
          return (
            <Row key={r.business.id} $active={r.business.id === activeId} data-testid={`admin-followup-row-${r.business.id}`}>
              <RowMain type="button" onClick={() => select(r.business.id)} aria-pressed={r.business.id === activeId}>
                <TitleLine>
                  <RowTitle>{r.business.name || `#${r.business.id}`}</RowTitle>
                  {r.exempt_kind && <ExemptChip>{t(`exemptKind.${r.exempt_kind}`, r.exempt_kind)} · {t('subs.exempt', '면제')}</ExemptChip>}
                </TitleLine>
                <Owner>{r.business.owner ? `${r.business.owner.name ? `${r.business.owner.name} · ` : ''}${r.business.owner.email}` : t('subs.noOwner', '주인 정보 없음')}</Owner>
                <Meta>
                  <span>{t('subs.joinedAt', '가입')}: {r.created_at ? formatDate(r.created_at) : '—'}</span>
                  <span>{trialText(r)}</span>
                  <span>{stageText(r)}</span>
                  <span>{t('journey.lastSeen', '마지막 접속')}: {r.last_seen_at ? formatDateTime(r.last_seen_at) : t('journey.never', '없음')}</span>
                  <span>{t('journey.members', { count: r.members, defaultValue: '멤버 {{count}}명' })}</span>
                </Meta>
                {(miss.length > 0 || r.setup.mail_errors > 0) && (
                  <Chips>
                    {miss.map((m) => <GrayChip key={m}>{m}</GrayChip>)}
                  </Chips>
                )}
                {r.signals.length > 0 && (
                  <Chips>{r.signals.map((s) => <SignalBadge key={s.key}>{signalText(s)}</SignalBadge>)}</Chips>
                )}
                {r.help.length > 0 && (
                  <Chips data-testid={`admin-followup-help-${r.business.id}`}>
                    {r.help.slice(0, 2).map((h) => (
                      <HelpChip key={h.key} $sent={!!h.sent_at}>
                        {helpText(h)}{h.sent_at ? ` · ${sentText(h)}` : ''}
                      </HelpChip>
                    ))}
                  </Chips>
                )}
              </RowMain>
              <RowSide>
                {r.room?.human_requested && <HumanBadge>{t('support.humanRequested', 'PlanQ 팀 답 필요')}</HumanBadge>}
                {r.room && r.room.unread > 0 && <Unread aria-label={t('support.unread', { count: r.room.unread, defaultValue: '안 읽음 {{count}}' }) as string}>{r.room.unread > 99 ? '99+' : r.room.unread}</Unread>}
                {r.room?.last_message_at && <Dim>{t('followup.lastTalk', '마지막 대화')} {formatDateTime(r.room.last_message_at)}</Dim>}
                <SecondaryBtn type="button" onClick={() => select(r.business.id)} data-testid={`admin-followup-message-${r.business.id}`}>
                  {t('followup.message', '메시지')}
                </SecondaryBtn>
              </RowSide>
            </Row>
          );
        })}
      </List>
      {rows.length < total && (
        <More>
          <SecondaryBtn type="button" onClick={() => setShown((n) => n + PAGE)} data-testid="admin-followup-more">
            {t('followup.more', { count: total - rows.length, defaultValue: '더 보기 ({{count}})' })}
          </SecondaryBtn>
        </More>
      )}

      <DetailDrawer open={activeId != null} onClose={close} ariaLabel={t('followup.title', '신규 고객') as string}>
        <DetailDrawer.Header onClose={close}>
          <DrawerTitle>{activeRow?.business.name || room?.business_name || (activeId ? `#${activeId}` : '')}</DrawerTitle>
        </DetailDrawer.Header>
        <DetailDrawer.Body>
          {activeRow && activeRow.help.length > 0 && (
            <HelpBlock data-testid="admin-followup-drawer-help">
              <HelpTitle>{t('followup.helpTitle', '도울 일 — 누르면 초안이 입력칸에 들어가요')}</HelpTitle>
              <Chips>
                {activeRow.help.map((h) => (
                  <HelpBtn key={h.key} type="button" $sent={!!h.sent_at} onClick={() => void applyDraft(h)} data-testid={`admin-followup-draft-${h.key}`}>
                    {helpText(h)}{h.sent_at ? ` · ${sentText(h)}` : ''}
                  </HelpBtn>
                ))}
              </Chips>
              {draftError && <ErrorText>{t('followup.draftFailed', '초안을 불러오지 못했어요')}</ErrorText>}
            </HelpBlock>
          )}
          {activeId && <JourneyWrap><AdminBusinessJourney businessId={activeId} /></JourneyWrap>}
          <ThreadTitle>{t('followup.threadTitle', 'PlanQ 안내방 대화')}</ThreadTitle>
          <SupportThread room={room} roomError={roomError} />
        </DetailDrawer.Body>
        <DetailDrawer.Footer>
          <SupportComposer businessId={activeId} room={room} insert={insert} onClose={close}
            onSent={async () => { await Promise.all([loadRoom(), loadList()]); }} />
        </DetailDrawer.Footer>
      </DetailDrawer>
    </PageShell>
  );
}

const Desc = styled.p`margin: 0 0 12px; font-size: 0.8125rem; color: #64748B;`;
const Dim = styled.span`color: #94A3B8; font-size: 0.75rem;`;
const ErrorText = styled.div`font-size: 0.8125rem; color: #DC2626; padding: 8px 0;`;
const List = styled.div`display: flex; flex-direction: column; gap: 8px; margin-top: 12px;`;
const Row = styled.div<{ $active: boolean }>`
  display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; border-radius: 10px; background: #fff;
  border: 1px solid ${(p) => (p.$active ? '#14B8A6' : '#E2E8F0')};
  &:hover { border-color: #94A3B8; }
  @media (max-width: 640px) { flex-direction: column; }
`;
const RowMain = styled.button`
  flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; text-align: left;
  background: none; border: none; padding: 0; cursor: pointer; font: inherit; color: inherit;
`;
const TitleLine = styled.div`display: flex; align-items: center; gap: 6px; min-width: 0;`;
const RowTitle = styled.div`${listRowTitleCss}`;
const Owner = styled.div`font-size: 0.75rem; color: #64748B; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const Meta = styled.div`
  display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 0.75rem; color: #334155;
`;
const Chips = styled.div`display: flex; flex-wrap: wrap; gap: 4px;`;
const GrayChip = styled.span`font-size: 0.6875rem; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: #F1F5F9; color: #64748B;`;
const SignalBadge = styled.span`font-size: 0.6875rem; font-weight: 600; padding: 2px 8px; border-radius: 6px; background: #FEF3C7; color: #92400E;`;
const HelpChip = styled.span<{ $sent: boolean }>`
  font-size: 0.6875rem; font-weight: 700; padding: 2px 8px; border-radius: 6px;
  background: ${(p) => (p.$sent ? '#F1F5F9' : '#F0FDFA')}; color: ${(p) => (p.$sent ? '#94A3B8' : '#0F766E')};
  border: 1px solid ${(p) => (p.$sent ? '#E2E8F0' : '#99F6E4')};
`;
const ExemptChip = styled.span`flex-shrink: 0; font-size: 0.6875rem; font-weight: 600; padding: 2px 8px; border-radius: 6px; background: #EEF2FF; color: #4338CA;`;
const RowSide = styled.div`
  display: flex; flex-direction: column; align-items: flex-end; gap: 6px; flex-shrink: 0;
  @media (max-width: 640px) { flex-direction: row; align-items: center; flex-wrap: wrap; width: 100%; justify-content: flex-end; }
`;
const HumanBadge = styled.span`font-size: 0.6875rem; font-weight: 700; padding: 2px 8px; border-radius: 6px; background: #FEF3C7; color: #92400E;`;
const Unread = styled.span`min-width: 20px; padding: 2px 6px; line-height: 1.45; border-radius: 10px; background: #F43F5E; color: #fff; font-size: 0.6875rem; font-weight: 700; display: inline-flex; align-items: center; justify-content: center;`;
const More = styled.div`display: flex; justify-content: center; padding: 16px 0;`;
const DrawerTitle = styled.div`font-size: 1rem; font-weight: 700; color: #0F172A;`;
const HelpBlock = styled.div`padding: 16px 20px 4px; display: flex; flex-direction: column; gap: 8px;`;
const HelpTitle = styled.div`font-size: 0.75rem; font-weight: 700; color: #334155;`;
const HelpBtn = styled.button<{ $sent: boolean }>`
  min-height: 32px; font-size: 0.75rem; font-weight: 700; padding: 4px 10px; border-radius: 8px; cursor: pointer;
  background: ${(p) => (p.$sent ? '#F8FAFC' : '#F0FDFA')}; color: ${(p) => (p.$sent ? '#64748B' : '#0F766E')};
  border: 1px solid ${(p) => (p.$sent ? '#E2E8F0' : '#99F6E4')};
  &:hover { border-color: #14B8A6; }
`;
const JourneyWrap = styled.div`padding: 0 20px;`;
const ThreadTitle = styled.div`padding: 12px 20px 0; font-size: 0.75rem; font-weight: 700; color: #334155;`;
