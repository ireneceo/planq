import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { io, type Socket } from 'socket.io-client';
import PageShell from '../../components/Layout/PageShell';
import TodoList from '../../components/Dashboard/TodoList';
import TaskDetailDrawer from '../../components/QTask/TaskDetailDrawer';
import EventDrawer from '../../pages/QCalendar/EventDrawer';
import { fetchTodo } from '../../services/dashboard';
import type { TodoItem, TodoResponse } from '../../services/dashboard';
import type { CalendarEvent } from '../../pages/QCalendar/types';
import { updateEvent, deleteEvent, createMeetingRoom } from '../../services/calendar';
import { useAuth, apiFetch, getAccessToken } from '../../contexts/AuthContext';

interface MemberOpt { user_id: number; name: string; }

const TodoPage: React.FC = () => {
  const { t } = useTranslation('dashboard');
  const { user } = useAuth();
  const bizId = user?.business_id ? Number(user.business_id) : null;
  const myId = user ? Number(user.id) : -1;
  const todayStr = new Date().toISOString().slice(0, 10);

  const [data, setData] = useState<TodoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [members, setMembers] = useState<MemberOpt[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);

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
  const socketRef = useRef<Socket | null>(null);
  useEffect(() => {
    if (!bizId) return;
    const token = getAccessToken();
    if (!token) return;
    const s = io({ auth: { token }, transports: ['websocket'] });
    socketRef.current = s;
    let pending: number | null = null;
    const debouncedReload = () => {
      if (pending) return;
      pending = window.setTimeout(() => { pending = null; silentLoad(); }, 250);
    };
    s.on('connect', () => { s.emit('join:business', bizId); });
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
    return () => {
      if (pending) window.clearTimeout(pending);
      s.emit('leave:business', bizId);
      s.disconnect();
      socketRef.current = null;
    };
  }, [bizId, silentLoad]);

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

  const handleOpenDrawer = async (item: TodoItem) => {
    if (item.drawer?.kind === 'task') {
      setSelectedTaskId(item.drawer.id);
    } else if (item.drawer?.kind === 'event' && bizId) {
      try {
        const r = await apiFetch(`/api/calendar/by-business/${bizId}/${item.drawer.id}`);
        const j = await r.json();
        if (j.success) setSelectedEvent(j.data as CalendarEvent);
      } catch { /* noop */ }
    }
  };

  // 드로어 닫기에서는 refetch 하지 않는다.
  // 실제로 데이터가 바뀐 경우에만 onRefresh 콜백으로 silentLoad 호출 (뒤 리스트 유지).
  const closeTaskDrawer = () => { setSelectedTaskId(null); };
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

  // 업무 인라인 액션: ack(요청확인) / approve(컨펌 승인) / complete(최종 완료)
  // 성공 시 해당 item 은 더 이상 내 할 일이 아니므로 로컬 리스트에서 제거 (targeted update).
  // 전체 refetch 대신 1건만 갱신 → 깜빡임 zero + 네트워크 절약.
  const handleTaskAction = async (item: TodoItem, action: 'ack' | 'approve' | 'complete') => {
    if (item.drawer?.kind !== 'task') return;
    const taskId = item.drawer.id;
    const endpoint =
      action === 'ack'      ? `/api/tasks/${taskId}/ack`
    : action === 'approve'  ? `/api/tasks/${taskId}/reviewers/me/approve`
    :                         `/api/tasks/${taskId}/complete`;
    try {
      const r = await apiFetch(endpoint, { method: 'POST' });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'Failed');
      setData(prev => prev ? {
        ...prev,
        items: prev.items.filter(i => i.id !== item.id),
        total: Math.max(0, prev.total - 1),
        counts: { ...prev.counts, [item.priority]: Math.max(0, (prev.counts[item.priority] || 0) - 1) },
      } : prev);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    }
  };


  // EventDrawer 콜백들
  // Update 는 변경 범위 (제목·시간·참석자 응답 등) 가 넓어 targeted 로 일관 처리 어려움 → silentLoad.
  // Delete 는 해당 event 의 모든 파생 item (respond/attend 복수) 을 로컬에서 제거 (targeted).
  const handleEventUpdate = async (patch: Partial<CalendarEvent>) => {
    if (!bizId || !selectedEvent) return;
    const next = await updateEvent(bizId, selectedEvent.id, patch);
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
    <PageShell title={t('todo.title')} count={data?.total}>
      {err
        ? <div style={{ padding: 20, color: '#B91C1C' }}>{err}</div>
        : <TodoList
            items={data?.items || []}
            loading={loading}
            onOpenDrawer={handleOpenDrawer}
            onInviteAction={handleInviteAction}
            onTaskAction={handleTaskAction}
          />}

      {selectedTaskId !== null && bizId !== null && (
        <TaskDetailDrawer
          taskId={selectedTaskId}
          bizId={bizId}
          myId={myId}
          todayStr={todayStr}
          members={members}
          onClose={closeTaskDrawer}
          onRefresh={silentLoad}
        />
      )}

      {selectedEvent && (
        <EventDrawer
          event={selectedEvent}
          onClose={closeEventDrawer}
          onUpdate={handleEventUpdate}
          onDelete={handleEventDelete}
          onCreateMeetingRoom={handleEventCreateMeetingRoom}
          dailyConfigured={false}
        />
      )}
    </PageShell>
  );
};

export default TodoPage;
