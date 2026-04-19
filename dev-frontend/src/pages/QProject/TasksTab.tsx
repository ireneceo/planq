// 프로젝트 업무 탭 — 리스트 / 타임라인 / 캘린더 3뷰 + 추가
import React, { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useNavigate } from 'react-router-dom';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import PlanQSelect from '../../components/Common/PlanQSelect';
import CalendarPicker from '../../components/Common/CalendarPicker';
import ProjectTaskList from './ProjectTaskList';

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

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  not_started: { label: '미시작', color: '#94A3B8' },
  waiting: { label: '대기', color: '#EAB308' },
  in_progress: { label: '진행중', color: '#14B8A6' },
  reviewing: { label: '컨펌중', color: '#3B82F6' },
  revision_requested: { label: '수정요청', color: '#F59E0B' },
  done_feedback: { label: '마무리', color: '#22C55E' },
  completed: { label: '완료', color: '#64748B' },
  canceled: { label: '취소', color: '#94A3B8' },
};

const TasksTab: React.FC<Props> = ({ projectId, businessId, tasks, onRefresh }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const myId = user ? Number(user.id) : -1;
  const [view, setView] = useState<ViewMode>('split');
  const [adding, setAdding] = useState(false);
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
      setAdding(false);
      onRefresh();
    } finally { setSubmitting(false); }
  };

  return (
    <Wrap>
      <Toolbar>
        <ViewTabs>
          <ViewBtn $active={view === 'split'} onClick={() => setView('split')}>기본</ViewBtn>
          <ViewBtn $active={view === 'list'} onClick={() => setView('list')}>리스트</ViewBtn>
          <ViewBtn $active={view === 'timeline'} onClick={() => setView('timeline')}>타임라인</ViewBtn>
          <ViewBtn $active={view === 'calendar'} onClick={() => setView('calendar')}>캘린더</ViewBtn>
        </ViewTabs>
        <AddTaskBtn type="button" onClick={() => setAdding(v => !v)}>{adding ? '취소' : '+ 업무 추가'}</AddTaskBtn>
      </Toolbar>

      {adding && (
        <AddForm>
          <AddInput autoFocus placeholder="업무명 (Ctrl+Enter 저장)" value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } if (e.key === 'Escape') { setAdding(false); resetNew(); } }} />
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
            <CancelBtn type="button" onClick={() => { setAdding(false); resetNew(); }}>취소</CancelBtn>
            <SaveBtn type="button" onClick={submit} disabled={submitting || !newTitle.trim()}>
              {submitting ? '저장 중...' : '추가'}
            </SaveBtn>
          </AddBtnRow>
        </AddForm>
      )}

      {view === 'split' && (
        <TableWrap>
          <ProjectTaskList tasks={sorted} members={members} businessId={businessId} myId={myId}
            onOpen={(id) => navigate(`/tasks?task=${id}`)} onLocalUpdate={onLocalUpdate}
            showTimeline />
        </TableWrap>
      )}
      {view === 'list' && (
        <TableWrap>
          <ProjectTaskList tasks={sorted} members={members} businessId={businessId} myId={myId}
            onOpen={(id) => navigate(`/tasks?task=${id}`)} onLocalUpdate={onLocalUpdate} />
        </TableWrap>
      )}
      {view === 'timeline' && <TimelineView tasks={sorted} onOpen={(id) => navigate(`/tasks?task=${id}`)} />}
      {view === 'calendar' && <CalendarView tasks={sorted} onOpen={(id) => navigate(`/tasks?task=${id}`)} />}

      {/* 좌측 하단 간이 추가 버튼 (Q Task 패턴) */}
      <BottomAddBtn type="button" onClick={() => setAdding(true)}>+ 업무 추가</BottomAddBtn>
    </Wrap>
  );
};


// ─── Timeline (간트) view ───
const TimelineView: React.FC<{ tasks: TaskRow[]; onOpen: (id: number) => void; }> = ({ tasks, onOpen }) => {
  const tasksWithDates = tasks.filter(t => t.start_date || t.due_date);
  if (tasksWithDates.length === 0) return <EmptyBox>기간이 설정된 업무가 없습니다. 시작일/마감일을 지정하세요.</EmptyBox>;

  // 범위 계산
  const dates = tasksWithDates.flatMap(t => [t.start_date, t.due_date].filter(Boolean) as string[]).map(d => d.slice(0, 10));
  const minD = dates.reduce((a, b) => (a < b ? a : b));
  const maxD = dates.reduce((a, b) => (a > b ? a : b));
  const minTime = new Date(minD).getTime();
  const maxTime = new Date(maxD).getTime();
  const totalDays = Math.max(1, Math.round((maxTime - minTime) / 86400000) + 1);

  const pct = (dateStr: string) => {
    const t = new Date(dateStr.slice(0, 10)).getTime();
    return ((t - minTime) / 86400000 / totalDays) * 100;
  };

  // 주요 날짜 눈금 (약 6개)
  const ticks: string[] = [];
  const step = Math.ceil(totalDays / 6);
  for (let i = 0; i <= totalDays; i += step) {
    const d = new Date(minTime + i * 86400000);
    ticks.push(d.toISOString().slice(0, 10));
  }

  return (
    <TLWrap>
      <TLHead>
        {ticks.map((d, i) => (<TLTick key={i} style={{ left: `${((new Date(d).getTime() - minTime) / 86400000 / totalDays) * 100}%` }}>{d.slice(5).replace('-', '/')}</TLTick>))}
      </TLHead>
      <TLBody>
        {tasksWithDates.map(t => {
          const s = t.start_date || t.due_date!;
          const e = t.due_date || t.start_date!;
          const left = pct(s);
          const width = Math.max(2, pct(e) - pct(s) + (2 / totalDays) * 100);
          const color = STATUS_LABEL[t.status]?.color || '#14B8A6';
          return (
            <TLRow key={t.id} onClick={() => onOpen(t.id)}>
              <TLLabel>{t.title}</TLLabel>
              <TLTrack>
                <TLBar style={{ left: `${left}%`, width: `${width}%`, background: color }}>
                  <TLBarLabel>{t.assignee?.name || ''}</TLBarLabel>
                </TLBar>
              </TLTrack>
            </TLRow>
          );
        })}
      </TLBody>
    </TLWrap>
  );
};

// ─── Calendar view ───
const CalendarView: React.FC<{ tasks: TaskRow[]; onOpen: (id: number) => void; }> = ({ tasks, onOpen }) => {
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
              {(tasksByDate[fmt(d)] || []).slice(0, 3).map(t => (
                <CalTaskDot key={t.id} onClick={() => onOpen(t.id)} title={t.title}
                  style={{ background: STATUS_LABEL[t.status]?.color || '#14B8A6' }}>
                  {t.title.length > 12 ? t.title.slice(0, 12) + '…' : t.title}
                </CalTaskDot>
              ))}
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
const BottomAddBtn = styled.button`margin-top:14px;padding:8px 14px;background:transparent;color:#94A3B8;border:1px dashed #E2E8F0;border-radius:8px;font-size:13px;font-weight:500;cursor:pointer;width:100%;&:hover{border-color:#14B8A6;color:#0F766E;background:#F0FDFA;}`;
const EmptyBox = styled.div`padding:40px;text-align:center;color:#94A3B8;font-size:13px;background:#FFF;border:1px solid #E2E8F0;border-radius:8px;`;

// Timeline
const TLWrap = styled.div`background:#FFF;border:1px solid #E2E8F0;border-radius:8px;padding:12px;`;
const TLHead = styled.div`position:relative;height:24px;margin-left:200px;border-bottom:1px solid #E2E8F0;margin-bottom:8px;`;
const TLTick = styled.span`position:absolute;top:4px;font-size:10px;color:#94A3B8;transform:translateX(-50%);`;
const TLBody = styled.div`display:flex;flex-direction:column;gap:4px;`;
const TLRow = styled.div`display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;&:hover{background:#F8FAFC;}`;
const TLLabel = styled.div`width:192px;font-size:12px;color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
const TLTrack = styled.div`flex:1;position:relative;height:24px;background:#F8FAFC;border-radius:4px;`;
const TLBar = styled.div`position:absolute;top:2px;bottom:2px;border-radius:4px;display:flex;align-items:center;padding:0 6px;min-width:4px;overflow:hidden;`;
const TLBarLabel = styled.span`font-size:10px;color:#FFF;font-weight:600;white-space:nowrap;`;

// Calendar
const CalWrap = styled.div`background:#FFF;border:1px solid #E2E8F0;border-radius:8px;padding:12px;`;
const CalHead = styled.div`display:flex;align-items:center;gap:8px;margin-bottom:10px;`;
const CalTitle = styled.div`font-size:14px;font-weight:700;color:#0F172A;`;
const CalNavBtn = styled.button`padding:4px 10px;background:#F1F5F9;border:none;border-radius:6px;cursor:pointer;font-size:13px;color:#475569;&:hover{background:#E2E8F0;}`;
const CalGrid = styled.div`display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:#E2E8F0;border:1px solid #E2E8F0;border-radius:6px;overflow:hidden;`;
const CalDow = styled.div`background:#F8FAFC;padding:8px;font-size:11px;font-weight:700;color:#64748B;text-align:center;`;
const CalCell = styled.div<{$off?:boolean;$today?:boolean}>`background:${p=>p.$off?'#FAFBFC':p.$today?'#F0FDFA':'#FFF'};min-height:80px;padding:4px;display:flex;flex-direction:column;gap:2px;`;
const CalDate = styled.div`font-size:11px;font-weight:600;color:#475569;margin-bottom:2px;`;
const CalTaskDot = styled.div`padding:1px 4px;border-radius:3px;color:#FFF;font-size:10px;font-weight:600;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;&:hover{opacity:0.8;}`;
const CalMore = styled.div`font-size:10px;color:#94A3B8;padding-left:4px;`;
