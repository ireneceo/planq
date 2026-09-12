// 프로젝트 업무 탭 — 리스트 / 타임라인 / 캘린더 3뷰 + 추가
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import { joinRoom, leaveRoom, onSocket } from '../../services/socket';
import TaskCreateForm from '../../components/QTask/TaskCreateForm';
import ProjectTaskList from './ProjectTaskList';
import TaskDetailDrawer from '../../components/QTask/TaskDetailDrawer';
import { responsiveDrawerWidth } from '../../utils/responsiveDrawer';
import AiTaskCreateModal from '../../components/QTask/AiTaskCreateModal';
import TemplateSelectModal from '../../components/QTask/TemplateSelectModal';
import TemplateSaveModal from '../../components/QTask/TemplateSaveModal';
import AiActionButton from '../../components/Common/AiActionButton';
import { todayInTz, detectBrowserTz } from '../../utils/timezones';
import { GanttHeader, GanttRowTrack, GanttBar, useGanttScrollSync } from '../../components/Common/GanttTrack';
import { STATUS_COLOR, displayStatus, getStatusLabel, type StatusCode } from '../../utils/taskLabel';
import { getRoles, primaryPerspective } from '../../utils/taskRoles';
import { listWorkstreams, type Workstream } from '../../services/projectCanvas';
import { useTranslation } from 'react-i18next';

type ViewMode = 'split' | 'list' | 'timeline' | 'calendar';

export interface TaskRow {
  id: number; project_id: number | null; business_id: number;
  title: string; status: string; due_date: string | null; start_date: string | null;
  progress_percent: number; estimated_hours: number | null; actual_hours: number | null;
  // 최신 estimation 출처 — 'ai' 면 시각 분기 (회색 italic + ✨)
  latest_estimation_source?: 'ai' | 'user' | null;
  // actual_hours 출처 — 'auto' (status 전환 자동 누적) vs 'user' (직접 입력). 사이클 N+6.
  actual_source?: 'auto' | 'user' | null;
  workstream_id?: number | null;  // R1-C3 — 업무 그룹(워크스트림)
  assignee_id: number | null; assignee?: { id: number; name: string } | null;
}

interface Member { user_id: number; name: string; }

type Props = {
  projectId: number;
  businessId: number;
  projectName?: string;
  tasks: TaskRow[];
  onRefresh: () => void;
};


const TasksTab: React.FC<Props> = ({ projectId, businessId, projectName, tasks, onRefresh }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { t: tp } = useTranslation('qproject');
  const myId = user ? Number(user.id) : -1;
  const wsTz = user?.workspace_timezone || detectBrowserTz();
  const todayStr = todayInTz(wsTz);

  // 업무 상세 드로어 — 프로젝트 페이지 안에서 오버레이로 오픈
  const [detailTaskId, setDetailTaskId] = useState<number | null>(() => {
    const q = new URLSearchParams(location.search).get('task');
    return q ? Number(q) : null;
  });
  const [drawerWidth, setDrawerWidth] = useState<number>(() => responsiveDrawerWidth('qtask_drawer_width'));
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
  const [aiOpen, setAiOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [tplInitialId, setTplInitialId] = useState<number | null>(null);
  const [tplSaveOpen, setTplSaveOpen] = useState(false);
  // ★ 업무 추가 폼은 **components/QTask/TaskCreateForm 한 벌**이다(2026-09-12).
  //   여기 있던 자체 폼이 네 번째 복사본이었다 — 태그·첨부가 없고, 반복 UI 가 달랐고,
  //   우측 드로어 껍데기를 손으로 그려(AddDrawer/AddBackdrop) 표준 CreateDrawer 와 갈라져 있었다.
  //   이 화면이 더 주는 맥락은 둘뿐이다: 프로젝트 고정 · 업무 그룹(워크스트림).
  const [members, setMembers] = useState<Member[]>([]);

  // ★ 외부 인력(고객·협력사·프리랜서) 담당자 후보는 **공용 폼이 직접** 읽는다
  //   (`assignable-externals?project_id=`) — 여기서 또 읽으면 두 벌이 된다.
  // Optimistic local copy — prop 변경 시 reseed
  const [localTasks, setLocalTasks] = useState<TaskRow[]>(tasks);
  useEffect(() => { setLocalTasks(tasks); }, [tasks]);
  const onLocalUpdate = (taskId: number, patch: Partial<TaskRow>) => {
    setLocalTasks(prev => prev.map(x => x.id === taskId ? { ...x, ...patch } : x));
  };

  // 프로젝트 멤버 — 업무 목록·공용 폼의 담당자 후보.
  //   ("담당자 비우면 실제로 누가 맡는가" 미리보기는 공용 폼이 같은 라우트로 스스로 읽는다)
  useEffect(() => {
    apiFetch(`/api/projects/${projectId}`).then(r => r.json()).then(j => {
      if (j.success) {
        // ProjectMember.User 에 백엔드가 display_name (워크스페이스 표시명) enrich 함
        // 운영 #263 — 폴백이 `#${user_id}` 라 이름 없는 멤버가 목록에 **날 id 로** 떴다.
        //   사용자에게 숫자는 아무 뜻이 없다. 사람 말로 바꾼다.
        const ms = (j.data.projectMembers || []).map((m: { user_id: number; User?: { name: string; display_name?: string | null } }) =>
          ({ user_id: m.user_id, name: m.User?.display_name || m.User?.name || (tp('members.unknown', '알 수 없는 멤버') as string) }));
        setMembers(ms);
      }
    });
  }, [projectId]);

  // R1-C3 — 워크스트림(업무 그룹). 단일 진실 원천 project_workstreams 를 캔버스와 공유.
  const [workstreams, setWorkstreams] = useState<Workstream[]>([]);
  const reloadWorkstreams = useCallback(() => {
    listWorkstreams(projectId).then(setWorkstreams).catch(() => { /* keep */ });
  }, [projectId]);
  useEffect(() => { reloadWorkstreams(); }, [reloadWorkstreams]);

  // §16 실시간 — 다른 사용자의 워크스트림/업무 변경(project:updated·task:updated broadcast) 시 그룹 즉시 갱신.
  const reloadWsRef = useRef(reloadWorkstreams);
  reloadWsRef.current = reloadWorkstreams;
  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => { if (pending) clearTimeout(pending); pending = setTimeout(() => reloadWsRef.current(), 250); };
    joinRoom(`business:${Number(businessId)}`);
    joinRoom(`project:${Number(projectId)}`);
    const offProjUpd = onSocket('project:updated', debounced);
    const offTaskUpd = onSocket('task:updated', debounced);
    const offTaskNew = onSocket('task:new', debounced);
    const offTaskDel = onSocket('task:deleted', debounced);
    return () => {
      if (pending) clearTimeout(pending);
      leaveRoom(`business:${Number(businessId)}`);
      leaveRoom(`project:${Number(projectId)}`);
      offProjUpd(); offTaskUpd(); offTaskNew(); offTaskDel();
    };
  }, [businessId, projectId]);

  const sorted = useMemo(() => [...localTasks].sort((a, b) => {
    const as = a.start_date || a.due_date || '9999-12-31';
    const bs = b.start_date || b.due_date || '9999-12-31';
    return as.localeCompare(bs);
  }), [localTasks]);

  // 공용 폼에 넘기는 맥락 — 두 자리(하단 인라인 / 상단 드로어)가 같은 값을 받는다
  const addFormProps = {
    businessId,
    fixedProjectId: projectId,
    workstreams,
    members: members.map((m) => ({ user_id: m.user_id, name: m.name })),
    onClose: () => setAdding(null),
    onCreated: () => onRefresh(),
  };

  return (
    <Wrap>
      <Toolbar>
        <ViewTabs>
          <ViewBtn $active={view === 'split'} onClick={() => setView('split')}>{tp('view.split', '기본')}</ViewBtn>
          <ViewBtn $active={view === 'list'} onClick={() => setView('list')}>{tp('view.list', '리스트')}</ViewBtn>
          <ViewBtn $active={view === 'timeline'} onClick={() => setView('timeline')}>{tp('view.timeline', '타임라인')}</ViewBtn>
          <ViewBtn $active={view === 'calendar'} onClick={() => setView('calendar')}>{tp('view.calendar', '캘린더')}</ViewBtn>
        </ViewTabs>
        <ToolbarRight>
          <AiActionButton
            onClick={() => setAiOpen(true)}
            label={tp('ai.btnShort', 'AI')}
            title={tp('ai.btnHint', '자연어 한 줄로 여러 업무 자동 생성') as string}
          />
          <TemplateBtn type="button" onClick={() => setTplOpen(true)} title={tp('tpl.btnHint', '시스템 preset 또는 워크스페이스 템플릿에서 시작') as string}>
            {tp('tpl.btn', '템플릿')}
          </TemplateBtn>
          <TemplateBtn type="button" onClick={() => setTplSaveOpen(true)} title={tp('tpl.saveHint', '현재 프로젝트의 일정을 템플릿으로 저장') as string}>
            {tp('tpl.saveBtn', '템플릿으로 저장')}
          </TemplateBtn>
          <AddTaskBtn type="button" data-testid="project-task-add-btn" onClick={() => setAdding(adding === 'top' ? null : 'top')}>{adding === 'top' ? tp('addTask.cancel', '취소') : tp('addTask.add', '+ 업무 추가')}</AddTaskBtn>
        </ToolbarRight>
      </Toolbar>

      {view === 'split' && (
        <TableWrap>
          <ProjectTaskList tasks={sorted} members={members} businessId={businessId} myId={myId}
            onOpen={openDetail} onLocalUpdate={onLocalUpdate} onRefresh={onRefresh}
            workstreams={workstreams} projectId={projectId} onWorkstreamsChanged={reloadWorkstreams}
            showTimeline />
        </TableWrap>
      )}
      {view === 'list' && (
        <TableWrap>
          <ProjectTaskList tasks={sorted} members={members} businessId={businessId} myId={myId}
            onOpen={openDetail} onLocalUpdate={onLocalUpdate} onRefresh={onRefresh}
            workstreams={workstreams} projectId={projectId} onWorkstreamsChanged={reloadWorkstreams} />
        </TableWrap>
      )}
      {view === 'timeline' && <TimelineView tasks={sorted} onOpen={openDetail} todayStr={todayStr} myId={myId} />}
      {view === 'calendar' && <CalendarView tasks={sorted} onOpen={openDetail} todayStr={todayStr} myId={myId} />}

      {/* 하단 간이 추가 — 글자만 좌측정렬. 클릭 시 하단에 폼이 뜸 (표와 간격 유지) */}
      {adding === 'bottom'
        ? <TaskCreateForm {...addFormProps} layout="inline" />
        : <BottomAddLink type="button" data-testid="project-task-add-below"
            onClick={() => setAdding('bottom')}>{tp('addTask.add', '+ 업무 추가')}</BottomAddLink>}

      {/* 상단 버튼 → 표준 생성 드로어(CreateDrawer). 껍데기를 손으로 그리지 않는다 — 규격이 갈라진다. */}
      {adding === 'top' && (
        <TaskCreateForm {...addFormProps} layout="drawer"
          drawerTitle={tp('addTask.drawerTitle', '+ 업무 추가')} />
      )}

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
          onDuplicated={(newId) => { openDetail(newId); onRefresh(); }}
        />
      )}
      <AiTaskCreateModal
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        businessId={businessId}
        projectId={projectId}
        projectFixed
        members={members}
        onCreated={() => { onRefresh(); }}
        onUseTemplate={(id) => { setAiOpen(false); setTplInitialId(id); setTplOpen(true); }}
      />
      <TemplateSelectModal
        open={tplOpen}
        onClose={() => { setTplOpen(false); setTplInitialId(null); }}
        businessId={businessId}
        projectId={projectId}
        members={members}
        onApplied={() => { onRefresh(); }}
        initialTemplateId={tplInitialId}
      />
      <TemplateSaveModal
        open={tplSaveOpen}
        onClose={() => setTplSaveOpen(false)}
        businessId={businessId}
        projectId={projectId}
        projectName={projectName || ''}
        onSaved={() => { /* 저장만 — 페이지 reload 불필요 */ }}
      />
    </Wrap>
  );
};


// ─── Timeline (간트) view — GanttTrack 공용 프리미티브 ───
const TimelineView: React.FC<{ tasks: TaskRow[]; onOpen: (id: number) => void; todayStr: string; myId: number; }> = ({ tasks, onOpen, todayStr, myId }) => {
  const tasksWithDates = tasks.filter(t => t.start_date || t.due_date);
  const gantt = useGanttScrollSync();
  const { t: tr } = useTranslation('qtask');
  const { t: tp } = useTranslation('qproject');
  if (tasksWithDates.length === 0) return <EmptyBox>{tp('timeline.emptyWithHint', '기간이 설정된 업무가 없습니다. 시작일/마감일을 지정하세요.')}</EmptyBox>;

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
  const { t: tp } = useTranslation('qproject');
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
        <CalTitle>{tp('calHeader.monthYear', { year, month: month + 1 })}</CalTitle>
        <CalNavBtn onClick={() => setAnchorDate(new Date(year, month + 1, 1))}>›</CalNavBtn>
        <CalNavBtn onClick={() => setAnchorDate(new Date())} style={{ marginLeft: 'auto', fontSize: '0.6875rem' }}>{tp('cal.today', '오늘')}</CalNavBtn>
      </CalHead>
      <CalGrid>
        {[tp('cal.sun', '일'), tp('cal.mon', '월'), tp('cal.tue', '화'), tp('cal.wed', '수'), tp('cal.thu', '목'), tp('cal.fri', '금'), tp('cal.sat', '토')].map(w => <CalDow key={w}>{w}</CalDow>)}
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

// ─── styled ───
const Wrap = styled.div``;
const Toolbar = styled.div`display:flex;align-items:center;gap:8px;margin-bottom:12px;`;
const ViewTabs = styled.div`display:inline-flex;background:#F1F5F9;padding:3px;border-radius:8px;gap:2px;`;
const ViewBtn = styled.button<{$active?:boolean}>`padding:6px 14px;border:none;background:${p=>p.$active?'#FFF':'transparent'};color:${p=>p.$active?'#0F766E':'#64748B'};border-radius:6px;font-size:0.75rem;font-weight:600;cursor:pointer;box-shadow:${p=>p.$active?'0 1px 2px rgba(0,0,0,0.06)':'none'};&:hover{color:#0F766E;}`;
const ToolbarRight = styled.div`margin-left:auto;display:inline-flex;align-items:center;gap:6px;`;
const TemplateBtn = styled.button`
  display:inline-flex;align-items:center;gap:6px;
  height:32px;padding:0 12px;
  background:#F0FDFA;color:#0F766E;
  border:1px solid #14B8A6;border-radius:8px;
  font-size:0.75rem;font-weight:600;cursor:pointer;
  transition:background 0.15s,color 0.15s;
  &:hover{background:#14B8A6;color:#FFF;}
`;
// 헤더 생성 버튼 규격 = ActionButton sm (h36)
const AddTaskBtn = styled.button`display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 14px;background:#14B8A6;color:#FFF;border:none;border-radius:8px;font-size:0.8125rem;font-weight:700;cursor:pointer;white-space:nowrap;&:hover{background:#0D9488;}`;

// 반복 선택기는 자체 배경 카드를 갖고 있어 폼 폭을 통째로 쓴다(행 안에 끼우면 눌린다)

// List — Q Task 스타일
const TableWrap = styled.div`background:#FFF;border:1px solid #E2E8F0;border-radius:8px;overflow-x:auto;overflow-y:hidden;&::-webkit-scrollbar{height:6px;}&::-webkit-scrollbar-thumb{background:#E2E8F0;border-radius:3px;}`;
const BottomAddLink = styled.button`margin-top:10px;padding:8px 14px;background:transparent;color:#94A3B8;border:none;font-size:0.8125rem;font-weight:500;cursor:pointer;text-align:left;display:block;font-family:inherit;&:hover{color:#0F766E;}`;
const EmptyBox = styled.div`padding:40px;text-align:center;color:#94A3B8;font-size:0.8125rem;background:#FFF;border:1px solid #E2E8F0;border-radius:8px;`;

// Timeline
const TLWrap = styled.div`background:#FFF;border:1px solid #E2E8F0;border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:4px;`;
const TLHeadRow = styled.div`display:flex;align-items:center;gap:8px;border-bottom:1px solid #E2E8F0;padding-bottom:6px;margin-bottom:4px;`;
const TLLabelCol = styled.div`width:220px;flex-shrink:0;display:flex;flex-direction:column;gap:3px;padding:2px 8px 2px 0;cursor:pointer;min-height:22px;&:hover > *:first-child{color:#0F766E;}`;
const TLTitle = styled.div`font-size:0.75rem;font-weight:600;color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
const TLMeta = styled.div`display:flex;align-items:center;gap:6px;font-size:0.625rem;color:#94A3B8;`;
const StatusPillSm = styled.span<{ $bg:string; $fg:string }>`padding:1px 6px;background:${p=>p.$bg};color:${p=>p.$fg};font-size:0.5625rem;font-weight:600;border-radius:6px;`;
const TLAssignee = styled.span`color:#64748B;`;
const TLProgress = styled.span`font-weight:600;color:#475569;margin-left:auto;`;
const TLRow = styled.div`display:flex;align-items:center;gap:8px;padding:4px 0;&:hover{background:#F8FAFC;}`;

// Calendar
const CalWrap = styled.div`background:#FFF;border:1px solid #E2E8F0;border-radius:8px;padding:12px;`;
const CalHead = styled.div`display:flex;align-items:center;gap:8px;margin-bottom:10px;`;
const CalTitle = styled.div`font-size:0.875rem;font-weight:700;color:#0F172A;`;
const CalNavBtn = styled.button`padding:4px 10px;background:#F1F5F9;border:none;border-radius:6px;cursor:pointer;font-size:0.8125rem;color:#475569;&:hover{background:#E2E8F0;}`;
const CalGrid = styled.div`display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:#E2E8F0;border:1px solid #E2E8F0;border-radius:6px;overflow:hidden;`;
const CalDow = styled.div`background:#F8FAFC;padding:8px;font-size:0.6875rem;font-weight:700;color:#64748B;text-align:center;`;
const CalCell = styled.div<{$off?:boolean;$today?:boolean}>`background:${p=>p.$off?'#FAFBFC':p.$today?'#F0FDFA':'#FFF'};min-height:80px;padding:4px;display:flex;flex-direction:column;gap:2px;`;
const CalDate = styled.div`font-size:0.6875rem;font-weight:600;color:#475569;margin-bottom:2px;`;
const CalTaskDot = styled.div`padding:2px 6px;border-radius:4px;font-size:0.625rem;font-weight:600;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;&:hover{filter:brightness(0.95);}`;
const CalMore = styled.div`font-size:0.625rem;color:#94A3B8;padding-left:4px;`;
