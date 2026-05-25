import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import styled from 'styled-components';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import MonthView from './MonthView';
import TimeGridView from './TimeGridView';
import EventDrawer from './EventDrawer';
import { responsiveDrawerWidth } from '../../utils/responsiveDrawer';
import NewEventModal from './NewEventModal';
import type { CalendarEvent, CalendarViewMode, CalendarScope, CalendarItem } from './types';
import {
  addDays, addMonths, getWeekDays, startOfDay, startOfMonth, startOfWeek, toDateKey,
} from './dateUtils';
import { useAuth } from '../../contexts/AuthContext';
import {
  listEvents, createEvent, updateEvent, deleteEvent,
  getVideoStatus, createMeetingRoom, listTasksForCalendar,
} from '../../services/calendar';
import { listProjects } from '../../services/qtalk';
import { taskToEvent, isTaskEvent } from './taskToEvent';
import TaskDetailDrawer from '../../components/QTask/TaskDetailDrawer';
import { apiFetch } from '../../contexts/AuthContext';
import { todayInTz, detectBrowserTz } from '../../utils/timezones';
import PlanQSelect from '../../components/Common/PlanQSelect';
import { mapApiError } from '../../utils/apiError';

// ─── URL 싱크 ───
const readUrl = (search: string) => {
  const p = new URLSearchParams(search);
  const view = (p.get('view') || 'month') as CalendarViewMode;
  const dateStr = p.get('date');
  const eventId = p.get('event') ? Number(p.get('event')) : null;
  const scope = (p.get('scope') || 'all') as CalendarScope;
  const date = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();
  return { view, date, eventId, scope };
};

interface ProjectOption { id: number; name: string; color?: string | null }

const QCalendarPage: React.FC = () => {
  const { t, i18n } = useTranslation('qcalendar');
  const { t: tErr } = useTranslation('errors');
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const bizId = user?.business_id || null;
  const myUserId = user?.id ? Number(user.id) : null;

  const initial = useMemo(() => readUrl(location.search), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [anchor, setAnchor] = useState<Date>(initial.date);
  const [view, setView] = useState<CalendarViewMode>(initial.view);
  const [scope, setScope] = useState<CalendarScope>(initial.scope);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(initial.eventId);
  const [showNewModal, setShowNewModal] = useState(false);
  const [newModalInitial, setNewModalInitial] = useState<Date>(new Date());

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [taskEvents, setTaskEvents] = useState<CalendarItem[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // 사이클 N+13: Daily.co → Google Meet 교체. 워크스페이스가 Google Calendar 연동되어 있어야 자동 생성 가능.
  const [gcalConnected, setGcalConnected] = useState(false);
  const today = useMemo(() => new Date(), []);

  // 업무 상세 드로어 (Q Task 페이지로 이동하지 않고 캘린더 위에 오버레이)
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(() => {
    const q = new URLSearchParams(location.search).get('task');
    return q ? Number(q) : null;
  });
  const [members, setMembers] = useState<Array<{ user_id: number; name: string }>>([]);
  useEffect(() => {
    if (!bizId) return;
    apiFetch(`/api/businesses/${bizId}/members`).then((r) => r.json()).then((j) => {
      if (j.success) {
        setMembers((j.data || []).map((m: { user_id: number; name?: string | null; User?: { name: string } }) => ({
          user_id: m.user_id, name: m.name || m.User?.name || `#${m.user_id}`,
        })));
      }
    }).catch(() => {});
  }, [bizId]);
  const wsTz = user?.workspace_timezone || detectBrowserTz();
  const todayStr = todayInTz(wsTz);

  useEffect(() => {
    if (!bizId) return;
    getVideoStatus(bizId)
      .then((s) => setGcalConnected(!!s.gcal_connected))
      .catch(() => setGcalConnected(false));
  }, [bizId]);

  // ─── 범위 조회: view + anchor 기반 ───
  const fetchRange = useCallback(async () => {
    if (!bizId) return;
    setLoading(true); setErrorMsg(null);
    try {
      let rangeStart: Date; let rangeEnd: Date;
      if (view === 'month') {
        // 월 뷰: 앞뒤 여유 포함 (6주 그리드)
        const firstOfMonth = startOfMonth(anchor);
        rangeStart = startOfWeek(firstOfMonth, 0);
        rangeEnd = addDays(rangeStart, 42);
      } else if (view === 'week') {
        rangeStart = startOfWeek(anchor, 0);
        rangeEnd = addDays(rangeStart, 7);
      } else {
        rangeStart = startOfDay(anchor);
        rangeEnd = addDays(rangeStart, 1);
      }
      // 서버 scope 는 all/mine 만 의미있음 — tasks/events 필터는 클라 전용
      const serverScope: 'all' | 'mine' = scope === 'mine' ? 'mine' : 'all';
      const list = await listEvents(bizId, {
        start: rangeStart.toISOString(),
        end: rangeEnd.toISOString(),
        scope: serverScope,
      });
      setEvents(list);
    } catch (e) {
      setErrorMsg(mapApiError(e, tErr));
    } finally {
      setLoading(false);
    }
  }, [bizId, view, anchor, scope]);

  useEffect(() => { fetchRange(); }, [fetchRange]);

  // N+39 — PWA visibility 안전망
  useVisibilityRefresh(useCallback(() => { void fetchRange(); }, [fetchRange]));

  // N+38 — 실시간 동기화 (CLAUDE.md 운영 안정성 16번 박제).
  // 다른 사용자가 일정 추가/수정/삭제 시 본인이 캘린더 열고 있으면 즉시 보임.
  useEffect(() => {
    if (!bizId) return;
    let pending: number | null = null;
    const debouncedReload = () => {
      if (pending) return;
      pending = window.setTimeout(() => { pending = null; void fetchRange(); }, 250);
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
        s.on('connect', () => { s.emit('join:business', bizId); });
        s.on('event:created', debouncedReload);
        s.on('event:updated', debouncedReload);
        s.on('event:deleted', debouncedReload);
      });
    });
    return () => {
      if (pending) window.clearTimeout(pending);
      if (socket) socket.disconnect();
    };
  }, [bizId, fetchRange]);

  // 프로젝트 목록 (모달 드롭다운 + 색 상속용)
  useEffect(() => {
    if (!bizId) return;
    listProjects(bizId).then((rows) => {
      setProjects(rows.map((p) => ({ id: Number(p.id), name: p.name, color: p.color })));
    }).catch(() => { /* silent — 프로젝트 연결은 선택 */ });
  }, [bizId]);

  // Q Task 업무 가져와 이벤트로 변환
  useEffect(() => {
    if (!bizId) return;
    listTasksForCalendar(bizId).then((rows) => {
      const mapped = rows.map(taskToEvent).filter((x): x is NonNullable<typeof x> => x !== null);
      setTaskEvents(mapped);
    }).catch(() => setTaskEvents([]));
  }, [bizId]);

  // URL 싱크 반영
  useEffect(() => {
    const p = new URLSearchParams();
    if (view !== 'month') p.set('view', view);
    p.set('date', toDateKey(anchor));
    if (scope !== 'all') p.set('scope', scope);
    if (selectedEventId != null) p.set('event', String(selectedEventId));
    if (selectedTaskId != null) p.set('task', String(selectedTaskId));
    const qs = p.toString();
    navigate({ pathname: '/calendar', search: qs ? `?${qs}` : '' }, { replace: true });
  }, [view, anchor, scope, selectedEventId, selectedTaskId, navigate]);

  // 4필터 적용 — events + task-as-events 통합
  const filteredEvents = useMemo<CalendarItem[]>(() => {
    const merged: CalendarItem[] = [...events, ...taskEvents];
    if (scope === 'events') return merged.filter((e) => !isTaskEvent(e));
    if (scope === 'tasks') return merged.filter(isTaskEvent);
    if (scope === 'mine' && myUserId) {
      return merged.filter((e) => {
        if (isTaskEvent(e)) {
          // 업무: 담당자 OR 생성자 (= 본인이 직접 관련된 업무)
          const t = e as { assignee_id?: number | null; created_by?: number | null };
          return t.assignee_id === myUserId || t.created_by === myUserId;
        }
        return e.created_by === myUserId || (e.attendees || []).some((a) => a.user_id === myUserId);
      });
    }
    return merged;
  }, [events, taskEvents, scope, myUserId]);

  const selectedEvent = useMemo(
    () => (selectedEventId != null ? events.find((e) => e.id === selectedEventId) || null : null),
    [events, selectedEventId]
  );

  // 헤더 타이틀
  const headerTitle = useMemo(() => {
    const locale = i18n.language === 'en' ? 'en-US' : 'ko-KR';
    if (view === 'month') {
      return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(anchor);
    }
    if (view === 'week') {
      const ws = startOfWeek(anchor, 0);
      const we = addDays(ws, 6);
      const sameMonth = ws.getMonth() === we.getMonth();
      const startFmt = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(ws);
      const endFmt = sameMonth
        ? new Intl.DateTimeFormat(locale, { day: 'numeric' }).format(we)
        : new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(we);
      const year = ws.getFullYear();
      return `${year} · ${startFmt} – ${endFmt}`;
    }
    // day
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
    }).format(anchor);
  }, [anchor, view, i18n.language]);

  const goPrev = useCallback(() => {
    if (view === 'month') setAnchor((d) => startOfMonth(addMonths(d, -1)));
    else if (view === 'week') setAnchor((d) => addDays(d, -7));
    else setAnchor((d) => addDays(d, -1));
  }, [view]);

  const goNext = useCallback(() => {
    if (view === 'month') setAnchor((d) => startOfMonth(addMonths(d, 1)));
    else if (view === 'week') setAnchor((d) => addDays(d, 7));
    else setAnchor((d) => addDays(d, 1));
  }, [view]);

  const goToday = useCallback(() => setAnchor(new Date()), []);

  const handleSelectEvent = useCallback((id: number) => {
    // Task 이벤트는 같은 페이지에 TaskDetailDrawer 오버레이로 오픈 (재클릭 토글)
    const asTask = taskEvents.find((e) => isTaskEvent(e) && e.id === id);
    if (asTask && isTaskEvent(asTask)) {
      setSelectedTaskId((cur) => (cur === asTask._task_id ? null : asTask._task_id));
      return;
    }
    setSelectedEventId((cur) => (cur === id ? null : id));
  }, [taskEvents]);

  const refreshTasks = useCallback(async () => {
    if (!bizId) return;
    try {
      const { listTasksForCalendar } = await import('../../services/calendar');
      const rows = await listTasksForCalendar(bizId);
      const mapped = rows.map(taskToEvent).filter((x): x is NonNullable<typeof x> => x !== null);
      setTaskEvents(mapped);
    } catch { /* noop */ }
  }, [bizId]);

  const handleSelectDate = useCallback((d: Date) => {
    if (view === 'month') {
      setAnchor(startOfDay(d));
      setView('day');
    } else {
      setAnchor(startOfDay(d));
    }
  }, [view]);

  const handleOpenNew = useCallback(() => {
    const base = view === 'day' ? anchor : new Date();
    const d = new Date(base);
    const now = new Date();
    // 기본 시작: 지금(시간 부분) 또는 09:00
    if (view === 'day') d.setHours(9, 0, 0, 0);
    else d.setHours(now.getHours() + 1, 0, 0, 0);
    setNewModalInitial(d);
    setShowNewModal(true);
  }, [view, anchor]);

  const handleCreate = useCallback(async (payload: Partial<CalendarEvent>) => {
    if (!bizId) return;
    try {
      const created = await createEvent(bizId, payload as Parameters<typeof createEvent>[1]);
      setEvents((prev) => [...prev, created]);
      setShowNewModal(false);
      setSelectedEventId(created.id);
    } catch (e) {
      setErrorMsg(mapApiError(e, tErr));
    }
  }, [bizId]);

  const handleUpdate = useCallback(async (patch: Partial<CalendarEvent>) => {
    if (selectedEventId == null || !bizId) return;
    // 낙관적 업데이트 — 즉시 반영 후 서버 응답으로 덮어씀
    setEvents((prev) => prev.map((e) => (e.id === selectedEventId ? { ...e, ...patch } as CalendarEvent : e)));
    try {
      const updated = await updateEvent(bizId, selectedEventId, patch);
      setEvents((prev) => prev.map((e) => (e.id === selectedEventId ? updated : e)));
    } catch (e) {
      setErrorMsg(mapApiError(e, tErr));
      // 실패 시 재조회로 복구
      fetchRange();
    }
  }, [selectedEventId, bizId, fetchRange]);

  const handleCreateMeetingRoom = useCallback(async () => {
    if (selectedEventId == null || !bizId) return;
    try {
      const updated = await createMeetingRoom(bizId, selectedEventId);
      setEvents((prev) => prev.map((e) => (e.id === selectedEventId ? updated : e)));
    } catch (e) {
      setErrorMsg(mapApiError(e, tErr));
    }
  }, [selectedEventId, bizId]);

  const handleDelete = useCallback(async () => {
    if (selectedEventId == null || !bizId) return;
    try {
      await deleteEvent(bizId, selectedEventId);
      setEvents((prev) => prev.filter((e) => e.id !== selectedEventId));
      setSelectedEventId(null);
    } catch (e) {
      setErrorMsg(mapApiError(e, tErr));
    }
  }, [selectedEventId, bizId]);

  const days = view === 'week' ? getWeekDays(anchor, 0) : view === 'day' ? [anchor] : [];

  const viewOptions = useMemo(() => [
    { value: 'month', label: t('view.month') },
    { value: 'week', label: t('view.week') },
    { value: 'day', label: t('view.day') },
  ], [t]);

  const scopeOptions = useMemo(() => [
    { value: 'all', label: t('filter.all') },
    { value: 'mine', label: t('filter.mine') },
    { value: 'tasks', label: t('filter.tasks') },
    { value: 'events', label: t('filter.events') },
  ], [t]);

  const headerActions = (
    <ActionsRow>
      <PlanQSelect size="sm"
        value={scopeOptions.find(o => o.value === scope)}
        onChange={(opt: unknown) => {
          const v = (opt as { value?: CalendarScope } | null)?.value;
          if (v) setScope(v);
        }}
        options={scopeOptions}
        isSearchable={false}
        menuPlacement="bottom"
      />
      <PlanQSelect size="sm"
        value={viewOptions.find(o => o.value === view)}
        onChange={(opt: unknown) => {
          const v = (opt as { value?: CalendarViewMode } | null)?.value;
          if (v) setView(v);
        }}
        options={viewOptions}
        isSearchable={false}
        menuPlacement="bottom"
      />
      <NewEventBtn onClick={handleOpenNew} type="button" title={t('new')}>
        <NewEventIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </NewEventIcon>
        <NewEventText>{t('new')}</NewEventText>
      </NewEventBtn>
    </ActionsRow>
  );

  return (
    <PageShell title={t('title')} actions={headerActions}>
      <Toolbar>
        <ToolbarLeft>
          <TodayBtn onClick={goToday}>{t('today')}</TodayBtn>
          <HeaderTitle>{headerTitle}</HeaderTitle>
          <NavIconBtn onClick={goPrev} aria-label={t('prev')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </NavIconBtn>
          <NavIconBtn onClick={goNext} aria-label={t('next')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </NavIconBtn>
        </ToolbarLeft>
      </Toolbar>

      <ViewWrap>
        {view === 'month' && (
          <MonthView
            anchor={anchor}
            today={today}
            events={filteredEvents}
            onSelectEvent={handleSelectEvent}
            onSelectDate={handleSelectDate}
          />
        )}
        {(view === 'week' || view === 'day') && (
          <TimeGridView
            anchor={anchor}
            today={today}
            days={days}
            events={filteredEvents}
            onSelectEvent={handleSelectEvent}
            onSelectDate={handleSelectDate}
          />
        )}
      </ViewWrap>

      {selectedTaskId != null && bizId && myUserId != null && (
        <TaskDetailDrawer
          taskId={selectedTaskId}
          bizId={bizId}
          myId={myUserId}
          todayStr={todayStr}
          members={members}
          width={responsiveDrawerWidth()}
          onWidthChange={() => {}}
          onClose={() => setSelectedTaskId(null)}
          onPatch={() => { refreshTasks(); }}
          onRefresh={refreshTasks}
          onDuplicated={(newId) => { setSelectedTaskId(newId); refreshTasks(); }}
        />
      )}
      {selectedEvent && (
        <EventDrawer
          event={selectedEvent}
          projects={projects}
          myUserId={myUserId}
          myBusinessRole={user?.business_role || null}
          onClose={() => setSelectedEventId(null)}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          onCreateMeetingRoom={handleCreateMeetingRoom}
          gcalConnected={gcalConnected}
        />
      )}

      {showNewModal && (
        <NewEventModal
          initialStart={newModalInitial}
          projects={projects}
          businessId={bizId}
          onClose={() => setShowNewModal(false)}
          onCreate={handleCreate}
        />
      )}

      {errorMsg && (
        <ErrorToast onClick={() => setErrorMsg(null)}>{errorMsg}</ErrorToast>
      )}
      {loading && <LoadingBar />}
    </PageShell>
  );
};

export default QCalendarPage;

// ── styled ──
const ActionsRow = styled.div`
  display: flex; align-items: center; gap: 8px;
  @media (max-width: 640px) { gap: 6px; }
`;
const NewEventBtn = styled.button`
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 0 12px; height: 32px; border-radius: 8px; font-size: 13px; font-weight: 600;
  background: #14B8A6; color: #fff; border: none; cursor: pointer; white-space: nowrap;
  &:hover { background: #0F766E; }
  @media (max-width: 640px) { width: 32px; padding: 0; }
`;
const NewEventIcon = styled.svg`
  width: 16px; height: 16px; flex-shrink: 0;
`;
const NewEventText = styled.span`
  @media (max-width: 640px) { display: none; }
`;

const Toolbar = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 0 14px;
`;
const ToolbarLeft = styled.div` display: flex; align-items: center; gap: 6px; `;
const TodayBtn = styled.button`
  padding: 6px 12px; border: 1px solid #CBD5E1; border-radius: 6px;
  background: #fff; color: #0F172A; font-size: 12.5px; font-weight: 600; cursor: pointer;
  &:hover { background: #F8FAFC; }
`;
const NavIconBtn = styled.button`
  width: 30px; height: 30px; border: 1px solid #CBD5E1; border-radius: 6px;
  background: #fff; color: #475569; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  &:hover { background: #F8FAFC; color: #0F172A; }
`;
const HeaderTitle = styled.h2`
  margin: 0 10px 0 10px; font-size: 18px; font-weight: 700; color: #0F172A; letter-spacing: -0.3px;
  @media (max-width: 640px) { font-size: 16px; margin: 0 6px; }
`;
const ViewWrap = styled.div`
  height: calc(100vh - 60px - 56px - 40px); min-height: 520px;
  display: flex;
`;
const ErrorToast = styled.div`
  position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
  padding: 10px 16px; border-radius: 8px;
  background: #FEE2E2; color: #B91C1C; font-size: 13px; font-weight: 500;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12); cursor: pointer;
  z-index: 80;
`;
const LoadingBar = styled.div`
  position: fixed; top: 0; left: 0; right: 0; height: 2px;
  background: linear-gradient(90deg, transparent, #14B8A6, transparent);
  background-size: 200% 100%;
  animation: pqLoading 1.2s linear infinite;
  @keyframes pqLoading { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
  z-index: 100;
`;
