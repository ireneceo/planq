import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { io, type Socket } from 'socket.io-client';
import styled from 'styled-components';
import PageShell from '../../components/Layout/PageShell';
import HelpDot from '../../components/Common/HelpDot';
import FirstVisitTour from '../../components/Common/FirstVisitTour';
import InsightCards from '../../components/Common/InsightCards';
import PushPromptBanner from '../../components/Common/PushPromptBanner';
import TodoList from '../../components/Dashboard/TodoList';
import TaskDetailDrawer from '../../components/QTask/TaskDetailDrawer';
import DailyStartModal from '../../components/Focus/DailyStartModal';
import CandidateActionModal from '../../components/Focus/CandidateActionModal';
import EventDrawer from '../../pages/QCalendar/EventDrawer';
import { fetchTodo } from '../../services/dashboard';
import type { TodoItem, TodoResponse } from '../../services/dashboard';
import type { CalendarEvent } from '../../pages/QCalendar/types';
import { updateEvent, deleteEvent, createMeetingRoom } from '../../services/calendar';
import { useAuth, apiFetch, getAccessToken } from '../../contexts/AuthContext';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';

interface MemberOpt { user_id: number; name: string; }

// 인박스 탭 분류 — Q knowledge 패턴 (전체 / 업무 / 서명 / 청구).
// "전체" 가 default 로 priority 그룹 통합 뷰 유지. 카테고리 탭은 좁히기 용도.
type InboxTab = 'all' | 'work' | 'signature' | 'billing';
const TYPE_TO_TAB: Record<string, Exclude<InboxTab, 'all'>> = {
  task: 'work', event: 'work', invite: 'work', mention: 'work', email: 'work', task_candidate: 'work',
  signature: 'signature',
  invoice: 'billing', payment_notify: 'billing', tax_invoice: 'billing',
  planq_subscription: 'billing',  // PlanQ 구독 청구 (owner 가 받는 플랫폼 청구)
};
const TAB_LIST: InboxTab[] = ['all', 'work', 'signature', 'billing'];

const TodoPage: React.FC = () => {
  const { t } = useTranslation('dashboard');
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const bizId = user?.business_id ? Number(user.business_id) : null;
  const myId = user ? Number(user.id) : -1;
  const todayStr = new Date().toISOString().slice(0, 10);

  // URL 싱크 — ?tab=work|signature|billing (없으면 'all')
  const activeTab: InboxTab = useMemo(() => {
    const q = new URLSearchParams(location.search).get('tab') as InboxTab | null;
    return q && TAB_LIST.includes(q) ? q : 'all';
  }, [location.search]);
  const setActiveTab = (tab: InboxTab) => {
    const sp = new URLSearchParams(location.search);
    if (tab === 'all') sp.delete('tab'); else sp.set('tab', tab);
    navigate(`${location.pathname}${sp.toString() ? `?${sp.toString()}` : ''}`, { replace: true });
  };

  const [data, setData] = useState<TodoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [members, setMembers] = useState<MemberOpt[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  // cross-workspace inbox: task 의 정확한 워크스페이스 bizId 추적 (default bizId 와 다를 수 있음)
  const [selectedTaskBizId, setSelectedTaskBizId] = useState<number | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  // 인박스 task_candidate 카드 클릭 시 inline 모달 (사이클 N+26)
  const [candidateInfo, setCandidateInfo] = useState<{
    candidate_id: number;
    title: string;
    conversation_id: number | null;
    conversation_name: string | null;
    guessed_assignee: { id: number; name: string } | null;
    workspace_name: string | null;
    workspace_business_id: number | null;
  } | null>(null);

  // silent=true 이면 skeleton 으로 되돌리지 않고 백그라운드 교체만. 드로어 내부 수정 후
  // 리스트를 업데이트할 때 뒤 리스트가 "깜빡"이지 않도록.
  // **cross-workspace** — 사용자가 속한 모든 워크스페이스의 알림 통합. 항목별 workspace 라벨 부착됨.
  const load = useCallback((opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    fetchTodo()
      .then(res => { setData(res); setErr(null); })
      .catch(e => { setErr(e.message || 'Failed'); })
      .finally(() => { if (!opts?.silent) setLoading(false); });
  }, []);

  const silentLoad = useCallback(() => load({ silent: true }), [load]);

  useEffect(() => { load(); }, [load]);

  // 실시간 sync — 워크스페이스 socket room 의 task/candidate/invoice 변경 받으면 silentLoad.
  // 사용자: "확인필요도 반영되는 족족 실시간으로 변경되어야 해"
  // **cross-workspace** — 인박스는 사용자가 속한 모든 워크스페이스의 알림을 통합. 따라서
  // socket join 도 default bizId 한 곳이 아니라 data.workspaces 의 모든 business room 에 join.
  const socketRef = useRef<Socket | null>(null);
  const joinedRoomsRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (!user) return;
    if (!getAccessToken()) return;
    const s = io({
      auth: (cb) => cb({ token: getAccessToken() }),
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1500,
      reconnectionDelayMax: 8000,
      reconnectionAttempts: Infinity,
    });
    s.on('connect_error', async (err) => {
      const msg = String((err as Error)?.message || '');
      if (/auth|token|jwt|unauthorized/i.test(msg)) {
        const { apiFetch } = await import('../../contexts/AuthContext');
        await apiFetch('/api/auth/me').catch(() => null);
      }
    });
    socketRef.current = s;
    let pending: number | null = null;
    const debouncedReload = () => {
      if (pending) return;
      pending = window.setTimeout(() => { pending = null; silentLoad(); }, 250);
    };
    // 재연결 시 그동안 joinedRoomsRef 에 쌓인 모든 room 재조인
    s.on('connect', () => {
      for (const id of joinedRoomsRef.current) s.emit('join:business', id);
    });
    s.on('task:new', debouncedReload);
    s.on('task:updated', debouncedReload);
    s.on('task:deleted', debouncedReload);
    s.on('candidate:new', debouncedReload);
    s.on('candidate:updated', debouncedReload);
    s.on('invoice:new', debouncedReload);
    s.on('invoice:updated', debouncedReload);
    s.on('event:created', debouncedReload);
    s.on('event:updated', debouncedReload);
    s.on('event:deleted', debouncedReload);
    // Phase D — 서명/결제알림/세금계산서/PATCH 통합 신호
    s.on('inbox:refresh', debouncedReload);
    // N+35 — 같은 탭 안 안전망 (socket 지연/끊김 시 즉시 sync).
    // TaskDetailDrawer 의 workflow 액션 성공 시 즉시 dispatch.
    const onLocalRefresh = () => debouncedReload();
    window.addEventListener('inbox:refresh', onLocalRefresh);
    return () => {
      if (pending) window.clearTimeout(pending);
      window.removeEventListener('inbox:refresh', onLocalRefresh);
      // 모든 joined room leave
      for (const id of joinedRoomsRef.current) s.emit('leave:business', id);
      joinedRoomsRef.current.clear();
      s.disconnect();
      socketRef.current = null;
    };
  }, [silentLoad, user?.id]);

  // 모바일 PWA background 복귀 시 missed events 회복
  useVisibilityRefresh(useCallback(() => {
    silentLoad();
    const s = socketRef.current;
    if (s && !s.connected) s.connect();
  }, [silentLoad]));

  // workspaces 변경 시 join/leave 동기화 — diff 만 emit.
  useEffect(() => {
    const s = socketRef.current;
    if (!s) return;
    const wanted = new Set<number>((data?.workspaces || []).map(w => w.business_id));
    // default bizId 도 항상 포함 (workspaces 가 비어 있어도)
    if (bizId) wanted.add(bizId);
    const joined = joinedRoomsRef.current;
    // 새로 join 할 room
    for (const id of wanted) if (!joined.has(id)) { s.emit('join:business', id); joined.add(id); }
    // 더 이상 없는 room 은 leave
    for (const id of Array.from(joined)) if (!wanted.has(id)) { s.emit('leave:business', id); joined.delete(id); }
  }, [data?.workspaces, bizId]);

  // 드로어에 필요한 멤버 목록 로드
  useEffect(() => {
    if (!bizId) return;
    apiFetch(`/api/businesses/${bizId}/members`)
      .then(r => r.json())
      .then(j => {
        if (j.success) {
          setMembers(j.data.map((m: { user_id: number; name: string }) => ({ user_id: m.user_id, name: m.name })));
        }
      })
      .catch(() => { /* noop */ });
  }, [bizId]);

  // task_candidate 인박스 카드 클릭 핸들러
  const handleOpenCandidate = (item: TodoItem) => {
    if (!item.candidate_id) return;
    setCandidateInfo({
      candidate_id: item.candidate_id,
      title: item.subject,
      conversation_id: item.conversation_id ?? null,
      conversation_name: item.context || null,
      guessed_assignee: item.guessed_assignee || null,
      workspace_name: item.workspace?.brand_name || null,
      workspace_business_id: item.workspace?.business_id ?? bizId ?? null,
    });
  };

  const handleOpenDrawer = async (item: TodoItem) => {
    if (item.drawer?.kind === 'task') {
      setSelectedTaskId(item.drawer.id);
      // cross-workspace: item.workspace.business_id 우선, 없으면 default bizId
      setSelectedTaskBizId(item.workspace?.business_id ?? bizId);
    } else if (item.drawer?.kind === 'event' && bizId) {
      const eventBizId = item.workspace?.business_id ?? bizId;
      try {
        const r = await apiFetch(`/api/calendar/by-business/${eventBizId}/${item.drawer.id}`);
        const j = await r.json();
        if (j.success) setSelectedEvent(j.data as CalendarEvent);
      } catch { /* noop */ }
    }
  };

  // 드로어 닫기에서는 refetch 하지 않는다.
  // 실제로 데이터가 바뀐 경우에만 onRefresh 콜백으로 silentLoad 호출 (뒤 리스트 유지).
  const closeTaskDrawer = () => { setSelectedTaskId(null); setSelectedTaskBizId(null); };
  const closeEventDrawer = () => { setSelectedEvent(null); };

  const handleInviteAction = (item: TodoItem, action: 'accept' | 'decline') => {
    // Phase 9: 실 초대 수락 API 연결. 지금은 UI 제거만.
    console.log('[todo] invite', item.id, action);
    if (data) {
      setData({
        ...data,
        items: data.items.filter(i => i.id !== item.id),
        total: data.total - 1,
      });
    }
  };

  // ack/approve/complete 는 TaskDetailDrawer 가 단일 진입점으로 처리.
  // (인박스 행 액션 버튼 제거 후 drawer 만 사용 — UX 단순화)

  // EventDrawer 콜백들
  // Update 는 변경 범위 (제목·시간·참석자 응답 등) 가 넓어 targeted 로 일관 처리 어려움 → silentLoad.
  // Delete 는 해당 event 의 모든 파생 item (respond/attend 복수) 을 로컬에서 제거 (targeted).
  const handleEventUpdate = async (
    patch: Partial<CalendarEvent>,
    options?: { scope?: 'single' | 'future' | 'all'; recurrence_id?: string },
  ) => {
    if (!bizId || !selectedEvent) return;
    const scope = options?.scope || 'all';
    const fullPatch = options?.recurrence_id
      ? { ...patch, recurrence_id: options.recurrence_id, from_date: options.recurrence_id }
      : patch;
    const next = await updateEvent(bizId, selectedEvent.id, fullPatch, scope);
    setSelectedEvent(next);
    silentLoad();
  };
  const handleEventDelete = async () => {
    if (!bizId || !selectedEvent) return;
    const eventId = selectedEvent.id;
    await deleteEvent(bizId, eventId);
    setSelectedEvent(null);
    setData(prev => {
      if (!prev) return prev;
      const keep = prev.items.filter(i => i.drawer?.kind !== 'event' || i.drawer.id !== eventId);
      const removed = prev.items.length - keep.length;
      const nextCounts = { ...prev.counts };
      prev.items
        .filter(i => i.drawer?.kind === 'event' && i.drawer.id === eventId)
        .forEach(i => { nextCounts[i.priority] = Math.max(0, (nextCounts[i.priority] || 0) - 1); });
      return { ...prev, items: keep, total: Math.max(0, prev.total - removed), counts: nextCounts };
    });
  };
  const handleEventCreateMeetingRoom = async () => {
    if (!bizId || !selectedEvent) return;
    const next = await createMeetingRoom(bizId, selectedEvent.id);
    setSelectedEvent(next);
  };

  return (
    <PageShell
      title={t('todo.title')}
      count={data?.total}
      helpDot={
        <HelpDot askCue={t('todo.help.cuePrefill') as string} topic="todo" tourPageKey="inbox">
          {t('todo.help.body')}
        </HelpDot>
      }
    >
      {/* 카테고리 탭 — 전체 default + 업무·서명·청구 카운트 분리 */}
      {(() => {
        const items = data?.items || [];
        const counts: Record<InboxTab, number> = { all: items.length, work: 0, signature: 0, billing: 0 };
        items.forEach((it) => {
          const grp = TYPE_TO_TAB[it.type];
          if (grp) counts[grp] += 1;
        });
        const filtered = activeTab === 'all'
          ? items
          : items.filter((it) => TYPE_TO_TAB[it.type] === activeTab);
        return (
          <>
            <PushPromptBanner />
            <TabBar role="tablist">
              {TAB_LIST.map((tab) => (
                <TabBtn key={tab} role="tab" type="button" aria-selected={activeTab === tab}
                  $active={activeTab === tab} onClick={() => setActiveTab(tab)}>
                  <span>{t(`todo.tab.${tab}`, {
                    all: '전체', work: '업무', signature: '서명', billing: '청구',
                  }[tab])}</span>
                  {counts[tab] > 0 && <Count $active={activeTab === tab}>{counts[tab]}</Count>}
                </TabBtn>
              ))}
            </TabBar>
            {/* "전체"·"업무" 탭 — 지연 업무 / 다가오는 일정 인사이트. signature/billing 탭은 무관해서 가림 */}
            {(activeTab === 'all' || activeTab === 'work') && <InsightCards />}
            {/* "서명" 탭 활성 시 — pending 만 보이는 인박스라 전체 history archive 진입점 노출 */}
            {activeTab === 'signature' && (
              <ArchiveHint>
                <ArchiveHintText>{t('todo.signaturesHint', '여기에는 액션 필요한 서명만 보여요. 전체 history 는')}</ArchiveHintText>
                <ArchiveLink to="/signatures/received">
                  {t('todo.signaturesArchive', '받은 서명 archive')} →
                </ArchiveLink>
              </ArchiveHint>
            )}
            {err
              ? <div style={{ padding: 20, color: '#B91C1C' }}>{err}</div>
              : <TodoList
                  items={filtered}
                  loading={loading}
                  onOpenDrawer={handleOpenDrawer}
                  onInviteAction={handleInviteAction}
                  onOpenCandidate={handleOpenCandidate}
                />}
          </>
        );
      })()}

      {selectedTaskId !== null && (selectedTaskBizId ?? bizId) !== null && (
        <TaskDetailDrawer
          taskId={selectedTaskId}
          bizId={(selectedTaskBizId ?? bizId) as number}
          myId={myId}
          todayStr={todayStr}
          members={members}
          onClose={closeTaskDrawer}
          onRefresh={silentLoad}
          onDuplicated={(newId)=>{ setSelectedTaskId(newId); silentLoad(); }}
        />
      )}

      {selectedEvent && (
        <EventDrawer
          event={selectedEvent}
          myUserId={myId}
          myBusinessRole={user?.business_role || null}
          onClose={closeEventDrawer}
          onUpdate={handleEventUpdate}
          onDelete={handleEventDelete}
          onCreateMeetingRoom={handleEventCreateMeetingRoom}
          gcalConnected={false}
        />
      )}
      <FirstVisitTour
        pageKey="inbox"
        steps={[
          { targetSelector: 'header', title: t('todo.tour.step1.title','확인 필요 (인박스)') as string, body: t('todo.tour.step1.body','내가 직접 행동해야 할 일이 모입니다 — 받은 업무·컨펌 대기·결제·서명·후보(본인 담당). 다른 사람 담당 항목은 그 사람 인박스에 가요.') as string, placement: 'bottom' },
        ]}
      />
      {/* 업무 흐름 — 오늘 시작 안내 모달 (focus_enabled + daily_prompt true 일 때만) */}
      <DailyStartModal />

      {/* 인박스 task_candidate 카드 클릭 = inline 등록/반려 모달 (사이클 N+26) */}
      <CandidateActionModal
        open={!!candidateInfo}
        info={candidateInfo}
        onClose={() => setCandidateInfo(null)}
        onRegistered={(taskId, businessBizId) => {
          silentLoad();
          // 등록된 task drawer 자동 오픈
          setSelectedTaskId(taskId);
          setSelectedTaskBizId(businessBizId);
        }}
        onRejected={() => { silentLoad(); }}
      />
    </PageShell>
  );
};

export default TodoPage;

const TabBar = styled.div`
  display: flex; gap: 4px;
  padding: 0 4px;
  border-bottom: 1px solid #E2E8F0;
  margin-bottom: 16px;
  overflow-x: auto;
  &::-webkit-scrollbar { display: none; }
`;
const TabBtn = styled.button<{ $active: boolean }>`
  display: inline-flex; align-items: center; gap: 6px;
  padding: 10px 14px;
  background: transparent; border: none;
  border-bottom: 2px solid ${p => p.$active ? '#14B8A6' : 'transparent'};
  color: ${p => p.$active ? '#0F172A' : '#64748B'};
  font-size: 13px; font-weight: ${p => p.$active ? 700 : 500};
  cursor: pointer; white-space: nowrap;
  transition: color 0.15s;
  &:hover { color: #0F172A; }
  &:focus-visible { outline: 2px solid rgba(20,184,166,0.3); outline-offset: -2px; }
`;
const Count = styled.span<{ $active: boolean }>`
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; padding: 1px 7px;
  font-size: 11px; font-weight: 700;
  background: ${p => p.$active ? '#14B8A6' : '#E2E8F0'};
  color: ${p => p.$active ? '#FFFFFF' : '#64748B'};
  border-radius: 999px;
`;
const ArchiveHint = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: #F0FDFA;
  border: 1px solid #CCFBF1;
  border-radius: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
`;
const ArchiveHintText = styled.span`
  font-size: 12px;
  color: #334155;
`;
const ArchiveLink = styled(Link)`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 700;
  color: #0F766E;
  text-decoration: none;
  &:hover { text-decoration: underline; }
`;
