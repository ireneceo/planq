// 사이클 Q-D — Dashboard 진입 페이지 (피드백 반영판)
//   - 이모지 → 라인 SVG 아이콘
//   - 박스 안 박스 제거 (Section 안의 List background 제거)
//   - "빠른 액션" 라벨 제거
//   - 인사말 제거 (PageShell 의 UserChip 우측 상단으로 이동됨)
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import PageShell from '../../components/Layout/PageShell';
import HelpDot from '../../components/Common/HelpDot';
import OrgScopeOverview from '../../components/Dashboard/OrgScopeOverview';
import { fetchOrgOverview } from '../../services/org';
import TrialStatusBanner from '../../components/Common/TrialStatusBanner';
import UsageWarningCard from '../../components/Common/UsageWarningCard';
import { useAuth, apiFetch } from '../../contexts/AuthContext';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { fetchTodo, type TodoResponse, type TodoItem } from '../../services/dashboard';
import { useNotifications } from '../../hooks/useNotifications';
import { useTimeFormat } from '../../hooks/useTimeFormat';

interface CalEventLite {
  id: number;
  title: string;
  start_at: string;
  end_at?: string | null;
  all_day?: boolean;
}

const DashboardPage: React.FC = () => {
  const { t } = useTranslation('dashboard');
  const { t: tOrg } = useTranslation('org');
  const navigate = useNavigate();
  const { user } = useAuth();
  const bizId = user?.business_id ? Number(user.business_id) : null;

  // Q조직 D1 — 대시보드 3단(회사/내 부서/개인)
  const [orgScope, setOrgScope] = useState<'personal' | 'department' | 'company'>('personal');
  const [myDeptId, setMyDeptId] = useState<number | null>(null);
  const canCompany = user?.business_role === 'owner' || user?.business_role === 'admin';
  useEffect(() => {
    if (!bizId) return;
    let cancelled = false;
    fetchOrgOverview(bizId, 'personal')
      .then((ov) => { if (!cancelled) setMyDeptId(ov.byMember?.[0]?.department_id ?? null); })
      .catch(() => { /* 조직 미설정 — 개인만 */ });
    return () => { cancelled = true; };
  }, [bizId]);

  const [todo, setTodo] = useState<TodoResponse | null>(null);
  const [todoLoading, setTodoLoading] = useState(true);
  const [events, setEvents] = useState<CalEventLite[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);

  const reloadTodo = useCallback(() => {
    setTodoLoading(true);
    fetchTodo()
      .then(setTodo)
      .catch(() => setTodo(null))
      .finally(() => setTodoLoading(false));
  }, []);
  useEffect(() => { reloadTodo(); }, [reloadTodo]);

  // N+39-2 — 실시간 동기화 + PWA visibility 안전망
  useVisibilityRefresh(reloadTodo);
  useEffect(() => {
    if (!bizId) return;
    let pending: number | null = null;
    const debouncedReload = () => {
      if (pending) return;
      pending = window.setTimeout(() => { pending = null; reloadTodo(); }, 250);
    };
    let socket: { disconnect: () => void } | null = null;
    import('socket.io-client').then(({ io }) => {
      import('../../contexts/AuthContext').then(({ getAccessToken }) => {
        if (!getAccessToken()) return;
        const s = io({
          auth: (cb) => cb({ token: getAccessToken() }),
          transports: ['websocket', 'polling'],
          reconnection: true,
        });
        socket = s;
        s.on('connect', () => { s.emit('join:business', Number(bizId)); });
        s.on('task:new', debouncedReload); s.on('task:updated', debouncedReload); s.on('task:deleted', debouncedReload);
        s.on('event:created', debouncedReload); s.on('event:updated', debouncedReload); s.on('event:deleted', debouncedReload);
        s.on('inbox:refresh', debouncedReload);
      });
    });
    return () => { if (pending) window.clearTimeout(pending); if (socket) socket.disconnect(); };
  }, [bizId, reloadTodo]);

  useEffect(() => {
    if (!bizId) return;
    setEventsLoading(true);
    const today = new Date();
    const weekEnd = new Date(today);
    weekEnd.setDate(today.getDate() + 7);
    const range = `start=${today.toISOString()}&end=${weekEnd.toISOString()}`;
    apiFetch(`/api/calendar/by-business/${bizId}?${range}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.success && Array.isArray(j.data)) {
          const sorted = [...j.data].sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
          setEvents(sorted.slice(0, 3));
        }
      })
      .catch(() => setEvents([]))
      .finally(() => setEventsLoading(false));
  }, [bizId]);

  const totalInbox = todo?.total || 0;
  const urgentCount = todo?.counts?.urgent || 0;
  const todayCount = todo?.counts?.today || 0;
  const top5 = (todo?.items || []).slice(0, 5);

  const fmtTime = (iso: string) => iso?.slice(11, 16) || '';
  const fmtDate = (iso: string) => iso?.slice(5, 10).replace('-', '/') || '';
  const isToday = (iso: string) => iso?.slice(0, 10) === new Date().toISOString().slice(0, 10);

  const navTo = useCallback((path: string) => () => navigate(path), [navigate]);

  return (
    <PageShell
      title={t('title')}
      helpDot={
        <HelpDot askCue={t('help.cuePrefill', '대시보드의 인박스, 오늘 일정, 확인 필요 카드가 어떻게 구성되는지 알려줘') as string} topic="dashboard">
          {t('help.body', '대시보드는 인박스(확인 필요)·오늘 일정·진행 중 업무를 한눈에 모아 보여줍니다. 카드를 누르면 해당 메뉴로 이동해요.')}
        </HelpDot>
      }
    >
      <TrialStatusBanner businessId={bizId} />
      <UsageWarningCard businessId={bizId} />
      {/* Q조직 D1 — 3단 스코프 토글 (회사/내 부서/개인) */}
      {bizId && (canCompany || myDeptId) && (
        <ScopeSwitch role="tablist">
          {canCompany && (
            <ScopeBtn type="button" role="tab" aria-selected={orgScope === 'company'} $active={orgScope === 'company'} onClick={() => setOrgScope('company')}>
              {tOrg('dashboard.scopeCompany') as string}
            </ScopeBtn>
          )}
          {myDeptId && (
            <ScopeBtn type="button" role="tab" aria-selected={orgScope === 'department'} $active={orgScope === 'department'} onClick={() => setOrgScope('department')}>
              {tOrg('dashboard.scopeDepartment') as string}
            </ScopeBtn>
          )}
          <ScopeBtn type="button" role="tab" aria-selected={orgScope === 'personal'} $active={orgScope === 'personal'} onClick={() => setOrgScope('personal')}>
            {tOrg('dashboard.scopePersonal') as string}
          </ScopeBtn>
        </ScopeSwitch>
      )}
      {bizId && orgScope !== 'personal' && (
        <OrgScopeOverview bizId={bizId} scope={orgScope} departmentId={myDeptId} />
      )}
      {orgScope === 'personal' && (<>
      {/* 1. 인박스 카드 + 4 액션 (한 행) */}
      <TopRow>
        <InboxCard onClick={navTo('/inbox')} role="button" tabIndex={0}>
          <InboxLabel>{t('inboxCard.label', '확인 필요')}</InboxLabel>
          <InboxCount $highlight={totalInbox > 0}>{totalInbox}</InboxCount>
          <InboxBreakdown>
            {urgentCount > 0 && <Pill $kind="urgent">{t('todo.priority.urgent', '긴급')} {urgentCount}</Pill>}
            {todayCount > 0 && <Pill $kind="today">{t('todo.priority.today', '오늘')} {todayCount}</Pill>}
            {totalInbox === 0 && !todoLoading && <Muted>{t('inboxCard.allDone', '모두 확인됨')}</Muted>}
          </InboxBreakdown>
        </InboxCard>

        <ActionTile type="button" onClick={navTo('/talk')}>
          <TileIcon><IconChat /></TileIcon>
          <TileLabel>{t('quickActions.newChat', '채팅')}</TileLabel>
        </ActionTile>
        <ActionTile type="button" onClick={navTo('/tasks')}>
          <TileIcon><IconTask /></TileIcon>
          <TileLabel>{t('quickActions.newTask', '업무')}</TileLabel>
        </ActionTile>
        <ActionTile type="button" onClick={navTo('/docs')}>
          <TileIcon><IconDoc /></TileIcon>
          <TileLabel>{t('quickActions.newDoc', '문서')}</TileLabel>
        </ActionTile>
        <ActionTile type="button" onClick={navTo('/qbill')}>
          <TileIcon><IconBill /></TileIcon>
          <TileLabel>{t('quickActions.newInvoice', '청구서')}</TileLabel>
        </ActionTile>
      </TopRow>

      {/* 2. 확인 필요 미리보기 */}
      <SectionRow>
        <SectionTitle>{t('preview.todo.title', '확인 필요 미리보기')}</SectionTitle>
        <SectionLink onClick={navTo('/inbox')}>{t('preview.viewAll', '전체 보기')}</SectionLink>
      </SectionRow>
      {todoLoading ? (
        <Skeleton>{[0, 1, 2].map((i) => <SkeletonRow key={i} />)}</Skeleton>
      ) : top5.length === 0 ? (
        <FlatEmpty>{t('preview.todo.empty', '확인할 항목이 없습니다')}</FlatEmpty>
      ) : (
        <FlatList>
          {top5.map((item: TodoItem) => (
            <FlatRow key={item.id} onClick={() => item.link && navigate(item.link)} $clickable={!!item.link}>
              <PriorityDot $priority={item.priority} />
              <RowMain>
                <RowSubject>{item.subject}</RowSubject>
                <RowMeta>
                  {t(`todo.verb.${item.verb}`, item.verb)}
                  {item.context && <Dim>· {item.context}</Dim>}
                </RowMeta>
              </RowMain>
              {item.dueAt && (
                <RowDue>{isToday(item.dueAt) ? t('preview.todo.today', '오늘') : fmtDate(item.dueAt)}</RowDue>
              )}
            </FlatRow>
          ))}
        </FlatList>
      )}

      {/* N+63 — 최근 알림 (Activity Feed, 확인 필요와 분리) */}
      <NotificationsPreview navTo={navTo} />

      {/* 3. 이번 주 일정 */}
      <SectionRow style={{ marginTop: 24 }}>
        <SectionTitle>{t('preview.events.title', '이번 주 일정')}</SectionTitle>
        <SectionLink onClick={navTo('/calendar')}>{t('preview.viewAll', '전체 보기')}</SectionLink>
      </SectionRow>
      {eventsLoading ? (
        <Skeleton>{[0, 1].map((i) => <SkeletonRow key={i} />)}</Skeleton>
      ) : events.length === 0 ? (
        <FlatEmpty>{t('preview.events.empty', '예정된 일정이 없습니다')}</FlatEmpty>
      ) : (
        <FlatList>
          {events.map((ev) => (
            <FlatRow key={ev.id} $clickable onClick={() => navigate(`/calendar?event=${ev.id}`)}>
              <EventDate>
                <EventDay>{fmtDate(ev.start_at)}</EventDay>
                {!ev.all_day && <EventTime>{fmtTime(ev.start_at)}</EventTime>}
              </EventDate>
              <RowMain>
                <RowSubject>{ev.title}</RowSubject>
              </RowMain>
            </FlatRow>
          ))}
        </FlatList>
      )}
      </>)}
    </PageShell>
  );
};

// N+63 — 최근 알림 5건 미리보기 (Activity Feed). 클릭 시 link 이동, 자동 읽음.
const NotificationsPreview: React.FC<{ navTo: (p: string) => () => void }> = ({ navTo }) => {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const { items, markRead } = useNotifications({ limit: 5, autoRefresh: true });
  const { formatTimeAgo } = useTimeFormat();
  if (items.length === 0) return null;  // 알림 없으면 섹션 자체 숨김 (대시보드 노이즈 회피)
  return (
    <>
      <SectionRow style={{ marginTop: 24 }}>
        <SectionTitle>{t('preview.notifications.title', '최근 알림') as string}</SectionTitle>
        <SectionLink onClick={navTo('/notifications')}>{t('preview.viewAll', '전체 보기') as string}</SectionLink>
      </SectionRow>
      <FlatList>
        {items.map((n) => (
          <FlatRow key={n.id} $clickable onClick={() => {
            if (!n.read_at) markRead(n.id);
            if (n.link) navigate(n.link);
          }}>
            <RowMain>
              <RowSubject>{n.title}</RowSubject>
              {n.body && <NotifDesc>{n.body.slice(0, 80)}</NotifDesc>}
              <NotifMeta>{formatTimeAgo(n.created_at)}</NotifMeta>
            </RowMain>
            {!n.read_at && <NotifUnreadDot />}
          </FlatRow>
        ))}
      </FlatList>
    </>
  );
};

const NotifDesc = styled.div`
  font-size: 12px; color: #64748B; line-height: 1.45;
  overflow: hidden; text-overflow: ellipsis; display: -webkit-box;
  -webkit-line-clamp: 1; -webkit-box-orient: vertical;
  margin-top: 2px;
`;
const NotifMeta = styled.div` font-size: 11px; color: #94A3B8; margin-top: 3px; `;
const NotifUnreadDot = styled.span`
  width: 8px; height: 8px; border-radius: 50%; background: #14B8A6; flex-shrink: 0; margin-top: 8px;
`;

export default DashboardPage;

// ─── 라인 SVG 아이콘 (이모지 대체) ───
const IconChat = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);
const IconTask = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 11l3 3L22 4" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
);
const IconDoc = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
  </svg>
);
const IconBill = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <line x1="8" y1="8" x2="16" y2="8" />
    <line x1="8" y1="12" x2="16" y2="12" />
    <line x1="8" y1="16" x2="13" y2="16" />
  </svg>
);

// ─── styled ───
// Q조직 D1 — 3단 스코프 세그먼트
const ScopeSwitch = styled.div`
  display: inline-flex; gap: 2px; padding: 3px; margin-bottom: 16px;
  background: #f1f5f9; border-radius: 10px;
`;
const ScopeBtn = styled.button<{ $active: boolean }>`
  all: unset; cursor: pointer; box-sizing: border-box;
  padding: 6px 14px; border-radius: 8px;
  font-size: 13px; font-weight: 600;
  color: ${(p) => (p.$active ? '#0f172a' : '#64748b')};
  background: ${(p) => (p.$active ? '#ffffff' : 'transparent')};
  box-shadow: ${(p) => (p.$active ? '0 1px 2px rgba(15,23,42,0.08)' : 'none')};
  transition: background 0.15s, color 0.15s;
  &:hover { color: #0f172a; }
`;
const TopRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 28px;
  @media (max-width: 1024px) { grid-template-columns: 1fr 1fr; }
  @media (max-width: 480px) { grid-template-columns: 1fr 1fr; }
`;

const InboxCard = styled.div`
  background: linear-gradient(135deg, #F0FDFA 0%, #FFFFFF 100%);
  border: 1px solid #CCFBF1;
  border-radius: 12px;
  padding: 18px 20px;
  display: flex; flex-direction: column; gap: 6px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
  &:hover { border-color: #14B8A6; box-shadow: 0 4px 12px rgba(20, 184, 166, 0.08); }
  &:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.3); }
  @media (max-width: 1024px) { grid-column: 1 / -1; }
`;
const InboxLabel = styled.div`
  font-size: 11px; font-weight: 700; color: #0F766E;
  text-transform: uppercase; letter-spacing: 0.4px;
`;
const InboxCount = styled.div<{ $highlight: boolean }>`
  font-size: 32px; font-weight: 700; line-height: 1;
  color: ${(p) => (p.$highlight ? '#0F172A' : '#94A3B8')};
`;
const InboxBreakdown = styled.div`display: flex; gap: 6px; flex-wrap: wrap; min-height: 22px; align-items: center;`;
const Pill = styled.span<{ $kind: 'urgent' | 'today' }>`
  display: inline-flex; align-items: center; padding: 2px 10px;
  font-size: 11px; font-weight: 700; border-radius: 999px;
  ${(p) => (p.$kind === 'urgent' ? 'background:#FEE2E2;color:#B91C1C;' : 'background:#FEF3C7;color:#92400E;')}
`;
const Muted = styled.span`font-size: 12px; color: #94A3B8;`;

const ActionTile = styled.button`
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; min-height: 100px; padding: 16px 8px;
  background: #FFFFFF;
  border: 1px solid #E2E8F0; border-radius: 12px;
  font: inherit; color: #334155; cursor: pointer;
  transition: all 0.15s;
  &:hover { background: #F0FDFA; border-color: #14B8A6; color: #0F766E; }
  &:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.3); }
`;
const TileIcon = styled.span`
  display: inline-flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; border-radius: 50%;
  color: #0F766E; background: #F0FDFA;
  ${ActionTile}:hover & { background: #FFFFFF; }
`;
const TileLabel = styled.span`font-size: 13px; font-weight: 600;`;

// 박스 안 박스 제거 — Section 자체 wrapper 없이 헤더 + flat list
const SectionRow = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  margin: 0 0 8px 0;
`;
const SectionTitle = styled.h2`
  font-size: 13px; font-weight: 700; color: #0F172A;
  text-transform: uppercase; letter-spacing: 0.4px; margin: 0;
`;
const SectionLink = styled.button`
  background: transparent; border: none; cursor: pointer;
  font-size: 12px; font-weight: 600; color: #0F766E;
  padding: 4px 8px; border-radius: 6px;
  &:hover { background: #F0FDFA; }
  &:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(20,184,166,0.3); }
`;

const FlatList = styled.div`
  display: flex; flex-direction: column;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; overflow: hidden;
`;
const FlatRow = styled.div<{ $clickable?: boolean }>`
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px;
  & + & { border-top: 1px solid #F1F5F9; }
  ${(p) => p.$clickable && 'cursor: pointer; &:hover { background: #F8FAFC; }'}
`;
const FlatEmpty = styled.div`
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px;
  padding: 28px 16px; text-align: center; color: #94A3B8; font-size: 13px;
`;
const PriorityDot = styled.span<{ $priority: string }>`
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
  background: ${(p) =>
    p.$priority === 'urgent' ? '#EF4444' :
    p.$priority === 'today' ? '#F59E0B' :
    p.$priority === 'waiting' ? '#94A3B8' : '#14B8A6'};
`;
const RowMain = styled.div`flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px;`;
const RowSubject = styled.div`font-size: 13px; font-weight: 600; color: #0F172A; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
const RowMeta = styled.div`font-size: 11px; color: #64748B; display: flex; gap: 4px; flex-wrap: wrap;`;
const Dim = styled.span`color: #94A3B8;`;
const RowDue = styled.span`font-size: 11px; color: #475569; font-weight: 600; flex-shrink: 0; font-variant-numeric: tabular-nums;`;
const EventDate = styled.div`display: flex; flex-direction: column; align-items: flex-start; min-width: 50px; flex-shrink: 0;`;
const EventDay = styled.span`font-size: 11px; font-weight: 700; color: #0F172A; font-variant-numeric: tabular-nums;`;
const EventTime = styled.span`font-size: 10px; color: #64748B; font-variant-numeric: tabular-nums;`;

const Skeleton = styled.div`
  display: flex; flex-direction: column;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; overflow: hidden;
`;
const SkeletonRow = styled.div`
  height: 52px; background: #F1F5F9;
  & + & { margin-top: 1px; }
  animation: pulse 1.6s ease-in-out infinite;
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
`;
