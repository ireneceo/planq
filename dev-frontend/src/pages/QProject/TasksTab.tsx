// 프로젝트 업무 탭 — 리스트 / 타임라인 / 캘린더 3뷰 + 추가
import React, { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import PlanQSelect from '../../components/Common/PlanQSelect';
import CalendarPicker from '../../components/Common/CalendarPicker';
import ProjectTaskList from './ProjectTaskList';
import TaskDetailDrawer from '../../components/QTask/TaskDetailDrawer';
import { todayInTz, detectBrowserTz } from '../../utils/timezones';
import { GanttHeader, GanttRowTrack, GanttBar, useGanttScrollSync } from '../../components/Common/GanttTrack';
import { STATUS_COLOR, displayStatus, getStatusLabel, type StatusCode } from '../../utils/taskLabel';
import { getRoles, primaryPerspective } from '../../utils/taskRoles';
import { useTranslation } from 'react-i18next';

type ViewMode = 'split' | 'list' | 'timeline' | 'calendar';

export interface TaskRow {
  id: number; project_id: number | null; business_id: number;
  title: string; status: string; due_date: string | null; start_date: string | null;
  progress_percent: number; estimated_hours: number | null; actual_hours: number | null;
  assignee_id: number | null; assignee?: { id: number; name: string } | null;
}

interface Member { user_id: number; name: string; }

type Props = {
  projectId: number;
  businessId: number;
  tasks: TaskRow[];
  onRefresh: () => void;
};


const TasksTab: React.FC<Props> = ({ projectId, businessId, tasks, onRefresh }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const myId = user ? Number(user.id) : -1;
  const wsTz = user?.workspace_timezone || detectBrowserTz();
  const todayStr = todayInTz(wsTz);

  // 업무 상세 드로어 — 프로젝트 페이지 안에서 오버레이로 오픈
  const [detailTaskId, setDetailTaskId] = useState<number | null>(() => {
    const q = new URLSearchParams(location.search).get('task');
    return q ? Number(q) : null;
  });
  const [drawerWidth, setDrawerWidth] = useState<number>(() => {
    try { const v = localStorage.getItem('qtask_drawer_width'); return v ? Math.max(420, Math.min(1000, Number(v))) : 560; } catch { return 560; }
  });
  const openDetail = (id: number) => {
    // 같은 업무 재클릭 → 드로어 닫기 (토글). 통일된 UX 원칙.
    if (detailTaskId === id) { closeDetail(); return; }
    setDetailTaskId(id);
    const sp = new URLSearchParams(location.search);
    sp.set('task', String(id));
    navigate(`${location.pathname}?${sp.toString()}`, { replace: true });
  };
  const closeDetail = () => {
    setDetailTaskId(null);
    const sp = new URLSearchParams(location.search);
    sp.delete('task');
    const qs = sp.toString();
    navigate(qs ? `${location.pathname}?${qs}` : location.pathname, { replace: true });
  };
  // 뷰 모드 URL 싱크 — ?view=split/list/timeline/calendar (기본 split 은 파라미터 생략)
  const viewFromUrl = (): ViewMode => {
    const v = new URLSearchParams(location.search).get('view');
    if (v === 'list' || v === 'timeline' || v === 'calendar' || v === 'split') return v;
    return 'split';
  };
  const [view, setViewState] = useState<ViewMode>(viewFromUrl);
  const setView = (v: ViewMode) => {
    setViewState(v);
    const sp = new URLSearchParams(location.search);
    if (v === 'split') sp.delete('view'); else sp.set('view', v);
    const qs = sp.toString();
    navigate(qs ? `${location.pathname}?${qs}` : location.pathname, { replace: true });
  };
  const [adding, setAdding] = useState<null | 'top' | 'bottom'>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newAssignee, setNewAssignee] = useState<number | null>(null);
  const [newStart, setNewStart] = useState('');
  const [newDue, setNewDue] = useState('');
  const [newEst, setNewEst] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const dateAnchorRef = useRef<HTMLButtonElement>(null);
  // Optimistic local copy — prop 변경 시 reseed
  const [localTasks, setLocalTasks] = useState<TaskRow[]>(tasks);
  useEffect(() => { setLocalTasks(tasks); }, [tasks]);
  const onLocalUpdate = (taskId: number, patch: Partial<TaskRow>) => {
    setLocalTasks(prev => prev.map(x => x.id === taskId ? { ...x, ...patch } : x));
  };

  useEffect(() => {
    apiFetch(`/api/projects/${projectId}`).then(r => r.json()).then(j => {
      if (j.success) {
        const ms = (j.data.projectMembers || []).map((m: { user_id: number; User?: { name: string } }) =>
          ({ user_id: m.user_id, name: m.User?.name || `#${m.user_id}` }));
        setMembers(ms);
      }
    });
  }, [projectId]);

  const sorted = useMemo(() => [...localTasks].sort((a, b) => {
    const as = a.start_date || a.due_date || '9999-12-31';
    const bs = b.start_date || b.due_date || '9999-12-31';
    return as.localeCompare(bs);
  }), [localTasks]);

  const resetNew = () => { setNewTitle(''); setNewAssignee(null); setNewStart(''); setNewDue(''); setNewEst(''); };

  const submit = async () => {
    if (submitting || !newTitle.trim()) return;
    setSubmitting(true);
    try {
      await apiFetch('/api/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId, project_id: projectId, title: newTitle.trim(),
          assignee_id: newAssignee || myId,
          start_date: newStart || null, due_date: newDue || null,
          estimated_hours: newEst ? Number(newEst) : null,
        }),
      });
      resetNew();
      setAdding(null);
      onRefresh();
    } finally { setSubmitting(false); }
  };

  const renderAddForm = () => (
    <AddForm>
      <AddInput autoFocus placeholder="업무명 (Ctrl+Enter 저장)" value={newTitle}
        onChange={e => setNewTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } if (e.key === 'Escape') { setAdding(null); resetNew(); } }} />
      <AddOptRow>
        <AddOptField>
          <AddOptLabel>담당자</AddOptLabel>
          <PlanQSelect size="sm" isClearable
            placeholder="담당자: 나"
            value={newAssignee == null ? null : { value: String(newAssignee), label: members.find(m => m.user_id === newAssignee)?.name || String(newAssignee) }}
            onChange={v => setNewAssignee((v as { value?: string } | null)?.value ? Number((v as { value: string }).value) : null)}
            options={members.map(m => ({ value: String(m.user_id), label: m.name + (m.user_id === myId ? ' (나)' : '') }))} />
        </AddOptField>
        <AddOptField style={{ flex: '1 1 240px' }}>
          <AddOptLabel>기간</AddOptLabel>
          <DateTrigger ref={dateAnchorRef} type="button" onClick={() => setDatePickerOpen(v => !v)}>
            {(newStart || newDue) ? (
              <>{newStart?.replace(/-/g, '/') || '—'} ~ {newDue?.replace(/-/g, '/') || '—'}</>
            ) : <DatePlaceholder>기간 선택</DatePlaceholder>}
          </DateTrigger>
          {datePickerOpen && (
            <CalendarPicker
              isOpen={datePickerOpen}
              anchorRef={dateAnchorRef}
              startDate={newStart}
              endDate={newDue || newStart}
              onRangeSelect={(s, e) => { setNewStart(s || ''); setNewDue(e || ''); }}
              onClose={() => setDatePickerOpen(false)}
            />
          )}
        </AddOptField>
        <AddOptField style={{ flex: '0 0 80px' }}>
          <AddOptLabel>예측(h)</AddOptLabel>
          <AddDateInput type="number" step="0.5" min="0" value={newEst} onChange={e => setNewEst(e.target.value)} />
        </AddOptField>
      </AddOptRow>
      <AddBtnRow>
        <CancelBtn type="button" onClick={() => { setAdding(null); resetNew(); }}>취소</CancelBtn>
        <SaveBtn type="button" onClick={submit} disabled={submitting || !newTitle.trim()}>
          {submitting ? '저장 중...' : '추가'}
        </SaveBtn>
      </AddBtnRow>
    </AddForm>
  );

  return (
    <Wrap>
      <Toolbar>
        <ViewTabs>
          <ViewBtn $active={view === 'split'} onClick={() => setView('split')}>기본</ViewBtn>
          <ViewBtn $active={view === 'list'} onClick={() => setView('list')}>리스트</ViewBtn>
          <ViewBtn $active={view === 'timeline'} onClick={() => setView('timeline')}>타임라인</ViewBtn>
          <ViewBtn $active={view === 'calendar'} onClick={() => setView('calendar')}>캘린더</ViewBtn>
        </ViewTabs>
        <AddTaskBtn type="button" onClick={() => setAdding(adding === 'top' ? null : 'top')}>{adding === 'top' ? '취소' : '+ 업무 추가'}</AddTaskBtn>
      </Toolbar>

      {view === 'split' && (
        <TableWrap>
          <ProjectTaskList tasks={sorted} members={members} businessId={businessId} myId={myId}
            onOpen={openDetail} onLocalUpdate={onLocalUpdate}
            showTimeline />
        </TableWrap>
      )}
      {view === 'list' && (
        <TableWrap>
          <ProjectTaskList tasks={sorted} members={members} businessId={businessId} myId={myId}
            onOpen={openDetail} onLocalUpdate={onLocalUpdate} />
        </TableWrap>
      )}
      {view === 'timeline' && <TimelineView tasks={sorted} onOpen={openDetail} todayStr={todayStr} myId={myId} />}
      {view === 'calendar' && <CalendarView tasks={sorted} onOpen={openDetail} todayStr={todayStr} myId={myId} />}

      {/* 하단 간이 추가 — 글자만 좌측정렬. 클릭 시 하단에 폼이 뜸 (표와 간격 유지) */}
      {adding === 'bottom'
        ? <BottomAddSlot>{renderAddForm()}</BottomAddSlot>
        : <BottomAddLink type="button" onClick={() => setAdding('bottom')}>+ 업무 추가</BottomAddLink>}

      {/* 상단 버튼 → 우측 오버레이 드로어 (Q Task 패턴). Backdrop 클릭 시 닫힘. */}
      {adding === 'top' && (<>
        <AddBackdrop onClick={() => { setAdding(null); resetNew(); }} />
        <AddDrawer>
          <AddDrawerHeader>
            <AddDrawerTitle>+ 업무 추가</AddDrawerTitle>
            <AddDrawerClose onClick={() => { setAdding(null); resetNew(); }} aria-label="닫기">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </AddDrawerClose>
          </AddDrawerHeader>
          <AddDrawerBody>
            {renderAddForm()}
          </AddDrawerBody>
        </AddDrawer>
      </>)}

      {detailTaskId && (
        <TaskDetailDrawer
          taskId={detailTaskId}
          bizId={businessId}
          myId={myId}
          todayStr={todayStr}
          members={members.map(m => ({ user_id: m.user_id, name: m.name }))}
          width={drawerWidth}
          onWidthChange={(w) => { setDrawerWidth(w); try { localStorage.setItem('qtask_drawer_width', String(w)); } catch { /* ignore */ } }}
          onClose={closeDetail}
          onPatch={(patch) => onLocalUpdate(patch.id, patch as Partial<TaskRow>)}
          onRefresh={onRefresh}
        />
      )}
    </Wrap>
  );
};


// ─── Timeline (간트) view — GanttTrack 공용 프리미티브 ───
const TimelineView: React.FC<{ tasks: TaskRow[]; onOpen: (id: number) => void; todayStr: string; myId: number; }> = ({ tasks, onOpen, todayStr, myId }) => {
  const tasksWithDates = tasks.filter(t => t.start_date || t.due_date);
  const gantt = useGanttScrollSync();
  const { t: tr } = useTranslation('qtask');
  if (tasksWithDates.length === 0) return <EmptyBox>기간이 설정된 업무가 없습니다. 시작일/마감일을 지정하세요.</EmptyBox>;

  const dates = tasksWithDates.flatMap(t => [t.start_date, t.due_date].filter(Boolean) as string[]).map(d => d.slice(0, 10));
  const from = dates.reduce((a, b) => (a < b ? a : b));
  const to = dates.reduce((a, b) => (a > b ? a : b));
  const range = { from, to };

  return (
    <TLWrap>
      <TLHeadRow>
        <TLLabelCol />
        <GanttHeader registry={gantt} range={range} tickMode="auto" />
      </TLHeadRow>
      {tasksWithDates.map(task => {
        const dStatus = displayStatus(task, todayStr);
        const sc = STATUS_COLOR[dStatus as StatusCode] || STATUS_COLOR.not_started;
        const role = primaryPerspective(getRoles(task, myId));
        const statusLabel = getStatusLabel(task, role, todayStr, (k, f) => tr(k, f || k));
        const prog = task.progress_percent || 0;
        return (
          <TLRow key={task.id}>
            <TLLabelCol onClick={() => onOpen(task.id)}>
              <TLTitle>{task.title}</TLTitle>
              <TLMeta>
                <StatusPillSm $bg={sc.bg} $fg={sc.fg}>{statusLabel}</StatusPillSm>
                {task.assignee?.name && <TLAssignee>{task.assignee.name}</TLAssignee>}
                <TLProgress>{prog}%</TLProgress>
              </TLMeta>
            </TLLabelCol>
            <GanttRowTrack registry={gantt} range={range} todayStr={todayStr} showGrid height={24}>
              <GanttBar range={range} start={task.start_date} end={task.due_date}
                bg={sc.bg} fg={sc.fg} label={task.assignee?.name || ''}
                onClick={(e) => { e.stopPropagation(); onOpen(task.id); }}
                title={`${task.start_date?.slice(0,10) || ''} ~ ${task.due_date?.slice(0,10) || ''}`} />
            </GanttRowTrack>
          </TLRow>
        );
      })}
    </TLWrap>
  );
};

// ─── Calendar view ───
const CalendarView: React.FC<{ tasks: TaskRow[]; onOpen: (id: number) => void; todayStr: string; myId: number; }> = ({ tasks, onOpen, todayStr, myId }) => {
  const { t: tr } = useTranslation('qtask');
  const [anchorDate, setAnchorDate] = useState(new Date());
  const year = anchorDate.getFullYear();
  const month = anchorDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = firstDay.getDay(); // 0(sun)~6
  const daysInMonth = lastDay.getDate();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const tasksByDate = useMemo(() => {
    const m: Record<string, TaskRow[]> = {};
    for (const t of tasks) {
      const keys = new Set<string>();
      if (t.start_date) keys.add(t.start_date.slice(0, 10));
      if (t.due_date) keys.add(t.due_date.slice(0, 10));
      keys.forEach(k => { (m[k] = m[k] || []).push(t); });
    }
    return m;
  }, [tasks]);

  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = fmt(new Date());

  return (
    <CalWrap>
      <CalHead>
        <CalNavBtn onClick={() => setAnchorDate(new Date(year, month - 1, 1))}>‹</CalNavBtn>
        <CalTitle>{year}년 {month + 1}월</CalTitle>
        <CalNavBtn onClick={() => setAnchorDate(new Date(year, month + 1, 1))}>›</CalNavBtn>
        <CalNavBtn onClick={() => setAnchorDate(new Date())} style={{ marginLeft: 'auto', fontSize: 11 }}>오늘</CalNavBtn>
      </CalHead>
      <CalGrid>
        {['일', '월', '화', '수', '목', '금', '토'].map(w => <CalDow key={w}>{w}</CalDow>)}
        {cells.map((d, i) => (
          <CalCell key={i} $off={!d} $today={!!d && fmt(d) === today}>
            {d && <>
              <CalDate>{d.getDate()}</CalDate>
              {(tasksByDate[fmt(d)] || []).slice(0, 3).map(task => {
                const dStatus = displayStatus(task, todayStr);
                const sc = STATUS_COLOR[dStatus as StatusCode] || STATUS_COLOR.not_started;
                const role = primaryPerspective(getRoles(task, myId));
                const statusLabel = getStatusLabel(task, role, todayStr, (k, f) => tr(k, f || k));
                return (
                  <CalTaskDot key={task.id} onClick={() => onOpen(task.id)} title={`${task.title} · ${statusLabel}`}
                    style={{ background: sc.bg, color: sc.fg, borderLeft: `3px solid ${sc.fg}` }}>
                    {task.title.length > 11 ? task.title.slice(0, 11) + '…' : task.title}
                  </CalTaskDot>
                );
              })}
              {(tasksByDate[fmt(d)] || []).length > 3 && <CalMore>+{(tasksByDate[fmt(d)] || []).length - 3}</CalMore>}
            </>}
          </CalCell>
        ))}
      </CalGrid>
    </CalWrap>
  );
};

export default TasksTab;
void CalendarPicker; // keep import (future date pickers)

// ─── styled ───
const Wrap = styled.div``;
const Toolbar = styled.div`display:flex;align-items:center;gap:8px;margin-bottom:12px;`;
const ViewTabs = styled.div`display:inline-flex;background:#F1F5F9;padding:3px;border-radius:8px;gap:2px;`;
const ViewBtn = styled.button<{$active?:boolean}>`padding:6px 14px;border:none;background:${p=>p.$active?'#FFF':'transparent'};color:${p=>p.$active?'#0F766E':'#64748B'};border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;box-shadow:${p=>p.$active?'0 1px 2px rgba(0,0,0,0.06)':'none'};&:hover{color:#0F766E;}`;
const AddTaskBtn = styled.button`margin-left:auto;padding:7px 14px;background:#14B8A6;color:#FFF;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;&:hover{background:#0D9488;}`;

const AddForm = styled.div`display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px;padding:10px;background:#F8FAFC;border:1px solid #14B8A6;border-radius:10px;margin-bottom:12px;`;
const AddInput = styled.input`flex:2 1 220px;min-width:180px;height:32px;padding:0 10px;border:1px solid #14B8A6;border-radius:6px;font-size:13px;font-family:inherit;&:focus{outline:none;box-shadow:0 0 0 2px rgba(20,184,166,0.15);}`;
const AddOptRow = styled.div`display:contents;`;
const AddOptField = styled.div`flex:1 1 130px;min-width:120px;display:flex;flex-direction:column;gap:2px;`;
const AddOptLabel = styled.label`font-size:10px;color:#64748B;font-weight:600;text-transform:uppercase;letter-spacing:0.3px;`;
const AddDateInput = styled.input`height:32px;padding:0 10px;font-size:13px;color:#0F172A;border:1px solid #E2E8F0;border-radius:6px;background:#FFF;font-family:inherit;&:focus{outline:none;border-color:#14B8A6;}`;
const AddBtnRow = styled.div`display:flex;justify-content:flex-end;gap:6px;flex:0 0 auto;`;
const CancelBtn = styled.button`padding:6px 12px;background:#FFF;color:#64748B;border:1px solid #E2E8F0;border-radius:6px;font-size:13px;cursor:pointer;&:hover{background:#F8FAFC;}`;
const SaveBtn = styled.button`padding:6px 14px;background:#14B8A6;color:#FFF;border:none;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;&:hover:not(:disabled){background:#0D9488;}&:disabled{background:#CBD5E1;cursor:not-allowed;}`;

// List — Q Task 스타일
const DateTrigger = styled.button`width:100%;height:32px;padding:0 10px;border:1px solid #E2E8F0;border-radius:6px;font-size:12px;color:#0F172A;background:#FFF;font-family:inherit;text-align:left;cursor:pointer;&:hover{border-color:#14B8A6;}`;
const DatePlaceholder = styled.span`color:#94A3B8;`;
const TableWrap = styled.div`background:#FFF;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;`;
const BottomAddLink = styled.button`margin-top:10px;padding:8px 14px;background:transparent;color:#94A3B8;border:none;font-size:13px;font-weight:500;cursor:pointer;text-align:left;display:block;font-family:inherit;&:hover{color:#0F766E;}`;
const BottomAddSlot = styled.div`margin-top:16px;`;
const AddBackdrop = styled.div`
  position:fixed;inset:0;background:rgba(15, 23, 42, 0.08);
  z-index:39;
  animation:pqFadeIn 0.22s ease-out;
  @keyframes pqFadeIn{from{opacity:0;}to{opacity:1;}}
  @media (prefers-reduced-motion: reduce){animation:none;}
`;
const AddDrawer = styled.aside`
  position:fixed;top:0;right:0;bottom:0;
  width:min(520px, calc(100vw - 56px));
  background:#FFF;border-left:1px solid #E2E8F0;
  box-shadow:-16px 0 40px rgba(15,23,42,0.14);display:flex;flex-direction:column;overflow:hidden;z-index:40;
  animation:pqSlideIn 0.28s cubic-bezier(0.22,1,0.36,1);
  @keyframes pqSlideIn{from{transform:translateX(100%);}to{transform:translateX(0);}}
  padding-bottom:env(safe-area-inset-bottom,0px);
  @media (prefers-reduced-motion: reduce){animation:none;}
`;
const AddDrawerHeader = styled.div`height:60px;padding:14px 20px;border-bottom:1px solid #E2E8F0;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;`;
const AddDrawerTitle = styled.h2`font-size:14px;font-weight:700;color:#0F172A;margin:0;`;
const AddDrawerClose = styled.button`width:28px;height:28px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;border-radius:6px;color:#64748B;cursor:pointer;&:hover{background:#F1F5F9;color:#0F172A;}`;
const AddDrawerBody = styled.div`flex:1;overflow-y:auto;padding:16px;`;
const EmptyBox = styled.div`padding:40px;text-align:center;color:#94A3B8;font-size:13px;background:#FFF;border:1px solid #E2E8F0;border-radius:8px;`;

// Timeline
const TLWrap = styled.div`background:#FFF;border:1px solid #E2E8F0;border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:4px;`;
const TLHeadRow = styled.div`display:flex;align-items:center;gap:8px;border-bottom:1px solid #E2E8F0;padding-bottom:6px;margin-bottom:4px;`;
const TLLabelCol = styled.div`width:220px;flex-shrink:0;display:flex;flex-direction:column;gap:3px;padding:2px 8px 2px 0;cursor:pointer;min-height:22px;&:hover > *:first-child{color:#0F766E;}`;
const TLTitle = styled.div`font-size:12px;font-weight:600;color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
const TLMeta = styled.div`display:flex;align-items:center;gap:6px;font-size:10px;color:#94A3B8;`;
const StatusPillSm = styled.span<{ $bg:string; $fg:string }>`padding:1px 6px;background:${p=>p.$bg};color:${p=>p.$fg};font-size:9px;font-weight:600;border-radius:6px;`;
const TLAssignee = styled.span`color:#64748B;`;
const TLProgress = styled.span`font-weight:600;color:#475569;margin-left:auto;`;
const TLRow = styled.div`display:flex;align-items:center;gap:8px;padding:4px 0;&:hover{background:#F8FAFC;}`;

// Calendar
const CalWrap = styled.div`background:#FFF;border:1px solid #E2E8F0;border-radius:8px;padding:12px;`;
const CalHead = styled.div`display:flex;align-items:center;gap:8px;margin-bottom:10px;`;
const CalTitle = styled.div`font-size:14px;font-weight:700;color:#0F172A;`;
const CalNavBtn = styled.button`padding:4px 10px;background:#F1F5F9;border:none;border-radius:6px;cursor:pointer;font-size:13px;color:#475569;&:hover{background:#E2E8F0;}`;
const CalGrid = styled.div`display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:#E2E8F0;border:1px solid #E2E8F0;border-radius:6px;overflow:hidden;`;
const CalDow = styled.div`background:#F8FAFC;padding:8px;font-size:11px;font-weight:700;color:#64748B;text-align:center;`;
const CalCell = styled.div<{$off?:boolean;$today?:boolean}>`background:${p=>p.$off?'#FAFBFC':p.$today?'#F0FDFA':'#FFF'};min-height:80px;padding:4px;display:flex;flex-direction:column;gap:2px;`;
const CalDate = styled.div`font-size:11px;font-weight:600;color:#475569;margin-bottom:2px;`;
const CalTaskDot = styled.div`padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;&:hover{filter:brightness(0.95);}`;
const CalMore = styled.div`font-size:10px;color:#94A3B8;padding-left:4px;`;
