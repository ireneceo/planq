// 프로젝트 업무 탭용 리스트 — Q Task 테이블 디자인 그대로
// (프로젝트 컬럼·예측·실제 컬럼 제외)
// R1-C3: workstreams prop 이 오면 워크스트림(업무 그룹) 단위로 묶어 표시.
//   그룹 헤더(색·인라인 이름·카운트·진행바·▲▼·삭제) + "(그룹 없음)" + 인라인 추가 그룹
//   + 행별 그룹 드롭다운 + 드래그 핸들. 캔버스↔업무리스트 단일 진실 원천(project_workstreams) 양방향 동기화.
import React, { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import CalendarPicker from '../../components/Common/CalendarPicker';
import PartnerKindBadge from '../../components/Common/PartnerKindBadge';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import {
  AddGroupBtn,
  AddGroupRow,
  AddTaskInGroupBtn,
  AddTaskInGroupGo,
  AddTaskInGroupInput,
  AddTaskInGroupRow,
  AssigneeDropdown,
  AssigneeLabel,
  AssigneeOpt,
  AssigneeOptInner,
  Col,
  ColRow,
  DateTrigger,
  DelayBadge,
  DescEmpty,
  DescText,
  DetailBtn,
  DragHandle,
  EmptyMsg,
  GroupActions,
  GroupBar,
  GroupBarFill,
  GroupBody,
  GroupCollapseBtn,
  GroupCount,
  GroupDot,
  GroupEmpty,
  GroupHeader,
  GroupIconBtn,
  GroupMenu,
  GroupMenuHint,
  GroupMenuItem,
  GroupMoveBtn,
  GroupMoveWrap,
  GroupPct,
  GroupTitle,
  GroupTitleInput,
  InlineAddRow,
  InlineInput,
  InlineSpacer,
  NameChip,
  SliderFill,
  SliderPct,
  SliderRange,
  SliderTrack,
  SliderWrap,
  Spacer,
  StatusDropdown,
  StatusOption,
  StatusPill,
  TCell,
  TRow,
  TaskCheck,
  TaskTitle,
  TitleInput,
} from './ProjectTaskList.styles';

import TaskRowActionMenu from '../../components/QTask/TaskRowActionMenu';
import { GanttHeader, GanttRowTrack, GanttBar, useGanttScrollSync, type GanttRange } from '../../components/Common/GanttTrack';
import { STATUS_COLOR, displayStatus, getStatusLabel, statusOptionsFor, type StatusCode } from '../../utils/taskLabel';
import { StatusGlyph } from '../../components/Common/Icons';
import { getRoles, primaryPerspective } from '../../utils/taskRoles';
import { friendlyDeleteError } from '../../utils/taskDeleteError';
import {
  createWorkstream, updateWorkstream, deleteWorkstream, reorderWorkstreams, wsColor,
  type Workstream,
} from '../../services/projectCanvas';

export interface TaskRow {
  id: number; project_id: number | null; business_id: number;
  title: string; description?: string | null;
  status: string; due_date: string | null; start_date: string | null;
  progress_percent: number; priority_order?: number | null;
  workstream_id?: number | null;
  // #277 — 표시명 정본은 display_name*. 서버가 applyMemberDisplayName 으로 채워 보내고,
  //   낙관적 갱신도 같은 모양으로 만든다(둘이 다르면 spread 병합에서 계정명이 이긴다).
  assignee_id: number | null; assignee?: { id: number; name: string; display_name?: string | null; display_name_localized?: Record<string, string> | null } | null;
  requester?: { id: number; name: string; display_name?: string | null; display_name_localized?: Record<string, string> | null } | null;
  source?: string; request_by_user_id?: number | null; created_by?: number;
  request_ack_at?: string | null; review_round?: number | null;
  reviewers?: Array<{ id: number; user_id: number; state: 'pending'|'approved'|'revision'; is_client?: boolean }>;
}

// 업무 종류별 드롭다운 옵션 (Q Task 와 동일)
type SortKey = 'priority_order' | 'title' | 'status' | 'progress_percent' | 'due_date' | 'start_date';
type SortDir = 'asc' | 'desc';

type Props = {
  tasks: TaskRow[];
  members: { user_id: number; name: string }[];
  businessId: number;
  myId: number;
  selectedId?: number | null;
  onOpen: (id: number) => void;
  onLocalUpdate: (taskId: number, patch: Partial<TaskRow>) => void;
  onRefresh?: () => void;
  showTimeline?: boolean; // split view
  projectStart?: string | null;
  projectEnd?: string | null;
  // R1-C3 — 워크스트림(업무 그룹). 전달되면 그룹 모드로 렌더.
  workstreams?: Workstream[];
  projectId?: number | null;
  onWorkstreamsChanged?: () => void;
};

const ProjectTaskList: React.FC<Props> = ({
  tasks, members, businessId, myId, selectedId, onOpen, onLocalUpdate, onRefresh,
  showTimeline, projectStart, projectEnd,
  workstreams, projectId: projectIdProp, onWorkstreamsChanged,
}) => {
  // 운영 #279 — 기간 편집 권한 판정에 워크스페이스 역할이 필요하다(prop 에는 myId 만 온다).
  const { user } = useAuth();
  const myWsRole = (user?.workspaces || []).find((w) => w.business_id === businessId)?.role
    || (user?.business_id === businessId ? user?.business_role : null);
  const isOwnerOrAdmin = myWsRole === 'owner' || myWsRole === 'admin' || user?.platform_role === 'platform_admin';
  const [sortKey, setSortKey] = useState<SortKey>('start_date');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [editingTitle, setEditingTitle] = useState<number | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [addingBelowId, setAddingBelowId] = useState<number | null>(null);
  const [newBelowTitle, setNewBelowTitle] = useState('');
  const [submittingBelow, setSubmittingBelow] = useState(false);
  // ★ 아래 두 인라인 quick-add 는 `assignee_id: myId` 를 **일부러 명시**한다.
  //   상단 "+ 업무 추가" 드로어 폼은 담당자를 비워 보내 서버 체인(프로젝트 기본담당자→PM→생성자)을 태우지만,
  //   여기는 담당자 셀렉터가 없는 즉석 한 줄 추가다. 체인을 태우면 내가 적은 한 줄이 남의 업무가 되고
  //   내부요청으로 둔갑해(자동 컨펌자 + 배정 알림) 엉뚱한 사람에게 알림이 간다 — 의도 초과다.
  //   "즉석 추가 = 내 것", "폼으로 추가 = 프로젝트 규칙" 으로 나눈 것이 의도된 설계다.
  const submitBelow = async (after: TaskRow) => {
    if (!newBelowTitle.trim() || submittingBelow) return;
    setSubmittingBelow(true);
    try {
      const r = await apiFetch('/api/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          project_id: after.project_id,
          title: newBelowTitle.trim(),
          assignee_id: myId,
          start_date: after.start_date || null,
          due_date: after.due_date || null,
          workstream_id: after.workstream_id ?? null,  // 같은 그룹에 추가
        }),
      });
      if (!r.ok) return;  // apiFetch 는 throw 안 함 — 실패 시 폼 유지(입력 보존), 닫지 않음
      setAddingBelowId(null);
      setNewBelowTitle('');
      onRefresh?.();
    } finally { setSubmittingBelow(false); }
  };
  // #120 — 그룹(워크스트림)별 업무 직접 추가. 빈 그룹도 드래그 없이 바로 추가 가능.
  const [addingInGroup, setAddingInGroup] = useState<number | 'none' | null>(null);
  const [newGroupTaskTitle, setNewGroupTaskTitle] = useState('');
  const [submittingGroupTask, setSubmittingGroupTask] = useState(false);
  const submitGroupTask = async (gid: number | 'none') => {
    if (!newGroupTaskTitle.trim() || submittingGroupTask) return;
    setSubmittingGroupTask(true);
    try {
      const r = await apiFetch('/api/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          project_id: projectId,
          title: newGroupTaskTitle.trim(),
          assignee_id: myId,
          workstream_id: gid === 'none' ? null : gid,  // 이 그룹에 배치
        }),
      });
      if (!r.ok) return;  // 실패 시 폼 유지(입력 보존)
      setAddingInGroup(null);
      setNewGroupTaskTitle('');
      onRefresh?.();
    } finally { setSubmittingGroupTask(false); }
  };
  const [statusOpenId, setStatusOpenId] = useState<number | null>(null);
  const [dateOpenId, setDateOpenId] = useState<number | null>(null);
  const [assigneeOpenId, setAssigneeOpenId] = useState<number | null>(null);
  const [groupMenuTaskId, setGroupMenuTaskId] = useState<number | null>(null);  // 행별 그룹 이동 드롭다운
  const dateRefs = useRef<Record<number, HTMLButtonElement | null>>({});

  // ─── 그룹(워크스트림) 모드 상태 ───
  const grouped = Array.isArray(workstreams);
  const projectId = useMemo(
    () => projectIdProp ?? tasks.find(tk => tk.project_id != null)?.project_id ?? null,
    [projectIdProp, tasks],
  );
  const [collapsed, setCollapsed] = useState<Set<number | 'none'>>(new Set());
  const [dragTaskId, setDragTaskId] = useState<number | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<number | 'none' | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [groupTitleDraft, setGroupTitleDraft] = useState('');
  const [headerMenuGroupId, setHeaderMenuGroupId] = useState<number | null>(null);  // 그룹 헤더 ⋯ 메뉴
  const [addingGroup, setAddingGroup] = useState(false);
  const [newGroupTitle, setNewGroupTitle] = useState('');
  const [groupBusy, setGroupBusy] = useState(false);

  const toggleCollapse = (gid: number | 'none') => {
    setCollapsed(prev => { const n = new Set(prev); if (n.has(gid)) n.delete(gid); else n.add(gid); return n; });
  };

  // 모든 인라인 드롭다운(그룹 이동·헤더 ⋯·상태·담당자) 바깥 클릭/Esc 닫기 — data-dropdown 내부 클릭은 유지.
  useEffect(() => {
    if (groupMenuTaskId == null && headerMenuGroupId == null && statusOpenId == null && assigneeOpenId == null) return;
    const closeAll = () => { setGroupMenuTaskId(null); setHeaderMenuGroupId(null); setStatusOpenId(null); setAssigneeOpenId(null); };
    const onClick = (e: MouseEvent) => { if ((e.target as HTMLElement)?.closest('[data-dropdown]')) return; closeAll(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeAll(); };
    window.addEventListener('click', onClick);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('click', onClick); window.removeEventListener('keydown', onKey); };
  }, [groupMenuTaskId, headerMenuGroupId, statusOpenId, assigneeOpenId]);

  // D2-b (#66) — 이 프로젝트에 참여한 외부 파트너(담당자 후보). 멤버와 합쳐 인라인 picker 에 노출.
  const [externals, setExternals] = useState<{ user_id: number; name: string; kind: string }[]>([]);
  useEffect(() => {
    if (!projectId || !businessId) { setExternals([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await apiFetch(`/api/tasks/by-business/${businessId}/assignable-externals?project_id=${projectId}`);
        const j = await r.json();
        if (!cancelled && j.success && Array.isArray(j.data)) {
          setExternals(j.data.map((e: { user_id: number; name: string; kind: string }) => ({ user_id: e.user_id, name: e.name, kind: e.kind })));
        } else if (!cancelled) { setExternals([]); }
      } catch { if (!cancelled) setExternals([]); }
    })();
    return () => { cancelled = true; };
  }, [projectId, businessId]);
  // 멤버와 중복 제거 (방어적)
  const externalCandidates = useMemo(
    () => externals.filter(e => !members.some(m => m.user_id === e.user_id)),
    [externals, members],
  );

  // 타임라인 가로 스크롤 동기화 — 공용 훅
  const gantt = useGanttScrollSync();
  const { t } = useTranslation('qtask');

  // 상태 드롭다운 옵션 라벨 — not_started + 요청업무 + 미ack 면 task_requested 로 표시
  const optionLabel = (task: TaskRow, status: string, role: string): string => {
    const isReq = task.source === 'internal_request' || task.source === 'qtalk_extract';
    if (status === 'not_started' && isReq && !task.request_ack_at) {
      return t(`status.task_requested.${role}`, t('status.task_requested.observer', '업무요청')) as string;
    }
    return t(`status.${status}.${role}`, t(`status.${status}.observer`, status)) as string;
  };

  const handleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('asc'); }
  };
  const sortIcon = (k: SortKey) => sortKey === k ? (sortDir === 'asc' ? '↑' : '↓') : '';

  const today = new Date().toISOString().slice(0, 10);
  const sortTasks = (arr: TaskRow[]) => [...arr].sort((a, b) => {
    const va = a[sortKey] as unknown;
    const vb = b[sortKey] as unknown;
    const aNull = va == null || va === '';
    const bNull = vb == null || vb === '';
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;
    if (typeof va === 'string' && typeof vb === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    return sortDir === 'asc' ? Number(va) - Number(vb) : Number(vb) - Number(va);
  });
  const sorted = sortTasks(tasks);

  // 운영 #279 — 여러 필드는 한 번의 PUT 으로. 기간을 두 번 쏘면 경쟁 + 부분 저장이 난다.
  const saveFields = async (taskId: number, patch: Record<string, unknown>) => {
    const row = tasks.find((t) => t.id === taskId) as Record<string, unknown> | undefined;
    const prevVals: Record<string, unknown> = {};
    for (const k of Object.keys(patch)) prevVals[k] = row?.[k];
    onLocalUpdate(taskId, patch as Partial<TaskRow>);
    const r = await apiFetch(`/api/tasks/by-business/${businessId}/${taskId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    if (!r.ok) { onLocalUpdate(taskId, prevVals as Partial<TaskRow>); return; }  // 실패 시 낙관적 되돌림(assignGroup 패턴)
    // #206 — status 전이는 백엔드가 Focus 세션을 전환/종료한다. 위젯 30초 폴링을 기다리지 않게 즉시 동기화.
    if (patch.status !== undefined) { try { window.dispatchEvent(new CustomEvent('focus:refresh')); } catch { /* noop */ } }
  };
  const saveField = async (taskId: number, field: string, value: unknown) => saveFields(taskId, { [field]: value });
  // 운영 #279 — 백엔드 FIELD_RULES.due_date/start_date 와 같은 집합 (담당자/작성자/owner/admin).
  const canEditDatesFor = (t: { created_by?: number | null; assignee_id?: number | null }) => (
    t.created_by === myId || t.assignee_id === myId || isOwnerOrAdmin
  );

  // 업무 → 그룹 이동 (드롭다운·드래그 공용). 실패 시 optimistic 되돌림.
  const assignGroup = async (task: TaskRow, wsId: number | null) => {
    const prev = task.workstream_id ?? null;
    if (prev === wsId) { setGroupMenuTaskId(null); return; }
    onLocalUpdate(task.id, { workstream_id: wsId });
    setGroupMenuTaskId(null);
    try {
      const r = await apiFetch(`/api/tasks/by-business/${businessId}/${task.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workstream_id: wsId }),
      });
      if (!r.ok) onLocalUpdate(task.id, { workstream_id: prev });  // 권한 등 실패 시 복원
    } catch { onLocalUpdate(task.id, { workstream_id: prev }); }
  };

  // ─── 그룹(워크스트림) CRUD — 단일 진실 원천 project_workstreams. 변경 시 onWorkstreamsChanged 로 캔버스/타임라인 동기. ───
  const submitNewGroup = async () => {
    if (!projectId || !newGroupTitle.trim() || groupBusy) return;
    setGroupBusy(true);
    try {
      await createWorkstream(projectId, { title: newGroupTitle.trim() });
      setNewGroupTitle(''); setAddingGroup(false);
      onWorkstreamsChanged?.();
    } catch { /* ignore */ } finally { setGroupBusy(false); }
  };
  const renameGroup = async (wsId: number) => {
    const ws = (workstreams || []).find(w => w.id === wsId);
    setEditingGroupId(null);
    if (!projectId || !ws || !groupTitleDraft.trim() || groupTitleDraft.trim() === ws.title) return;
    try { await updateWorkstream(projectId, wsId, { title: groupTitleDraft.trim() }); onWorkstreamsChanged?.(); } catch { /* ignore */ }
  };
  const removeGroup = async (wsId: number) => {
    setHeaderMenuGroupId(null);
    if (!projectId || groupBusy) return;
    setGroupBusy(true);
    try { await deleteWorkstream(projectId, wsId); onWorkstreamsChanged?.(); } catch { /* ignore */ } finally { setGroupBusy(false); }
  };
  const moveGroup = async (wsId: number, dir: -1 | 1) => {
    setHeaderMenuGroupId(null);
    const ordered = [...(workstreams || [])].sort((a, b) => a.order_index - b.order_index);
    const idx = ordered.findIndex(w => w.id === wsId);
    const swap = idx + dir;
    if (!projectId || idx < 0 || swap < 0 || swap >= ordered.length) return;
    [ordered[idx], ordered[swap]] = [ordered[swap], ordered[idx]];
    try { await reorderWorkstreams(projectId, ordered.map(w => w.id)); onWorkstreamsChanged?.(); } catch { /* ignore */ }
  };

  // 타임라인 범위 — GanttRange. 업무/프로젝트 일자 합쳐서 최소·최대.
  const range: GanttRange | null = useMemo(() => {
    const datesAll: string[] = [];
    if (projectStart) datesAll.push(projectStart.slice(0, 10));
    if (projectEnd) datesAll.push(projectEnd.slice(0, 10));
    tasks.forEach(t => { if (t.start_date) datesAll.push(t.start_date.slice(0, 10)); if (t.due_date) datesAll.push(t.due_date.slice(0, 10)); });
    if (datesAll.length === 0) return null;
    const s = datesAll.reduce((a, b) => a < b ? a : b);
    const e = datesAll.reduce((a, b) => a > b ? a : b);
    return { from: s, to: e };
  }, [tasks, projectStart, projectEnd]);

  // ─── 단일 업무 행 렌더 (그룹/플랫 공용) ───
  const renderTaskRow = (task: TaskRow) => {
    const isDelayed = !!(task.due_date && task.due_date.slice(0, 10) < today && task.status !== 'completed' && task.status !== 'canceled');
    const dispStatus = displayStatus(task, today);
    const sc = STATUS_COLOR[dispStatus as StatusCode] || STATUS_COLOR.not_started;
    const role = primaryPerspective(getRoles(task, myId));
    const statusLabel = getStatusLabel(task, role, today, (k, f) => t(k, f || k));
    const isEditing = editingTitle === task.id;
    const prog = task.progress_percent || 0;
    // #206 — 보류/외부컨펌도 완료와 같은 회색(흐르지 않는 상태의 시각 언어)
    const frozen = task.status === 'completed' || task.status === 'on_hold' || task.status === 'external_review';
    const holdBlocked = task.status === 'on_hold' || task.status === 'external_review';
    const sliderColor = frozen ? '#94A3B8' : isDelayed ? '#DC2626' : '#14B8A6';

    return (
      <Fragment key={task.id}>
        <TRow data-task-row $done={task.status === 'completed'} $delayed={isDelayed} $selected={selectedId === task.id} $dragging={dragTaskId === task.id}
          onClick={(e) => {
            const tgt = e.target as HTMLElement;
            if (tgt.closest('button,a,input,select,textarea,[role="button"],[data-dropdown]')) return;
            onOpen(task.id);
          }}
          style={{ cursor: 'pointer' }}>

          {/* #236 — 업무명 셀은 $flex2(바닥 240px). $flex(100px)면 좁은 폭에서 제목이 먼저 뭉개진다
              ("업무명은 마지막까지 적절하게 제대로 보여야 해"). 폭이 모자라면 뒤쪽 메타가 크롭되고
              표 전체는 TableWrap 가로 스크롤로 도달한다 — Q Task 리스트(#249)와 같은 규칙. */}
          <TCell $flex2>
            {grouped && (
              <DragHandle draggable role="button" aria-label={t('list.group.dragMove', '드래그하여 그룹 이동') as string}
                title={t('list.group.dragMove', '드래그하여 그룹 이동') as string}
                onClick={(e) => e.stopPropagation()}
                onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(task.id)); setDragTaskId(task.id); }}
                onDragEnd={() => { setDragTaskId(null); setDragOverGroup(null); }}>
                <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor"><circle cx="3" cy="3" r="1.3"/><circle cx="9" cy="3" r="1.3"/><circle cx="3" cy="7" r="1.3"/><circle cx="9" cy="7" r="1.3"/><circle cx="3" cy="11" r="1.3"/><circle cx="9" cy="11" r="1.3"/></svg>
              </DragHandle>
            )}
            <TaskRowActionMenu
              onAddBelow={() => { setNewBelowTitle(''); setAddingBelowId(task.id); }}
              onCopy={async () => {  // 실패 표면화 (onDelete 패턴) — apiFetch throw 안 함
                const r = await apiFetch(`/api/tasks/${task.id}/copy`, { method: 'POST' });
                if (!r.ok) { const j = await r.json().catch(() => ({})); return { ok: false, message: j?.message }; }
                onRefresh?.(); return { ok: true };
              }}
              onDelete={async () => {
                const r = await apiFetch(`/api/tasks/by-business/${businessId}/${task.id}`, { method: 'DELETE' });
                if (!r.ok) {
                  const j = await r.json().catch(() => ({}));
                  return { ok: false, message: friendlyDeleteError(j?.message, t) };
                }
                // 성공: 부모가 socket task:deleted 로 즉시 제거 (전체 reload 안 함 — 리프레시 제거)
                return { ok: true };
              }}
            />
            {/* #206 — 보류/외부컨펌 중 완료 우회 차단 (백엔드 가드와 미러) */}
            <TaskCheck type="checkbox" checked={task.status === 'completed'} disabled={holdBlocked}
              title={holdBlocked ? t('hold.completeBlocked', '보류 해제 후 완료 처리할 수 있어요') as string : undefined}
              onChange={() => saveField(task.id, 'status', task.status === 'completed' ? 'in_progress' : 'completed')} />
            {isEditing ? (
              <TitleInput autoFocus value={titleDraft}
                onChange={e => setTitleDraft(e.target.value)}
                onClick={e => e.stopPropagation()}
                onMouseDown={e => e.stopPropagation()}
                onBlur={() => { if (titleDraft.trim() && titleDraft !== task.title) saveField(task.id, 'title', titleDraft.trim()); setEditingTitle(null); }}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingTitle(null); }} />
            ) : (<>
              <TaskTitle role="button" $done={task.status === 'completed'}
                onClick={(e) => { e.stopPropagation(); setEditingTitle(task.id); setTitleDraft(task.title); }}
                title={t('list.titleClickEdit', '클릭하여 업무명 수정') as string}>
                {task.title}
              </TaskTitle>
              {(() => {
                if (task.assignee_id === myId && (task.source === 'internal_request' || task.source === 'qtalk_extract') && task.requester?.name)
                  return <NameChip $type="from">{task.requester.name}</NameChip>;
                if ((task.request_by_user_id === myId || task.created_by === myId) && task.assignee?.name && task.assignee_id !== myId)
                  return <NameChip $type="to">{task.assignee.name}</NameChip>;
                if (task.assignee?.name && task.assignee_id !== myId)
                  return <NameChip $type="observer">{task.assignee.name}</NameChip>;
                return null;
              })()}
              {isDelayed && <DelayBadge>{t('status.delayed', '지연')}</DelayBadge>}
              <Spacer />
              {grouped && (
                <GroupMoveWrap>
                  <GroupMoveBtn data-dropdown aria-label={t('list.group.moveTo', '그룹 이동') as string} title={t('list.group.moveTo', '그룹 이동') as string}
                    onClick={(e) => { e.stopPropagation(); setGroupMenuTaskId(groupMenuTaskId === task.id ? null : task.id); }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="6 9 12 15 18 9"/></svg>
                  </GroupMoveBtn>
                  {groupMenuTaskId === task.id && (
                    <GroupMenu data-dropdown onClick={e => e.stopPropagation()}>
                      {[...(workstreams || [])].sort((a, b) => a.order_index - b.order_index).map((w, i) => (
                        <GroupMenuItem key={w.id} $active={(task.workstream_id ?? null) === w.id} onClick={() => assignGroup(task, w.id)}>
                          <GroupDot style={{ background: wsColor(w, i) }} />{w.title}
                        </GroupMenuItem>
                      ))}
                      <GroupMenuItem $active={(task.workstream_id ?? null) === null} onClick={() => assignGroup(task, null)}>
                        <GroupDot style={{ background: '#CBD5E1' }} />{t('list.group.none', '(그룹 없음)')}
                      </GroupMenuItem>
                    </GroupMenu>
                  )}
                </GroupMoveWrap>
              )}
              <DetailBtn $active={selectedId === task.id} onClick={e => { e.stopPropagation(); onOpen(task.id); }} title={t('listRow.detailTitle', '상세 보기') as string}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
              </DetailBtn>
            </>)}
          </TCell>
          <TCell $w={showTimeline ? '90px' : '150px'} $center $hideBelow={900} style={{ position: 'relative', overflow: 'visible' }}>
            <AssigneeLabel data-dropdown onClick={e => { e.stopPropagation(); setAssigneeOpenId(assigneeOpenId === task.id ? null : task.id); }}>
              {task.assignee?.name || <span style={{ color: '#CBD5E1' }}>{t('listRow.assigneePlaceholder', '담당자')}</span>}
            </AssigneeLabel>
            {assigneeOpenId === task.id && (
              <AssigneeDropdown data-dropdown onClick={e => e.stopPropagation()}>
                {members.length === 0 && <AssigneeOpt>{t('listRow.noMembers', '멤버 없음')}</AssigneeOpt>}
                <AssigneeOpt $active={!task.assignee_id} onClick={() => { saveField(task.id, 'assignee_id', null); onLocalUpdate(task.id, { assignee: null }); setAssigneeOpenId(null); }}>{t('listRow.noAssignee', '— 없음 —')}</AssigneeOpt>
                {members.map(m => (
                  <AssigneeOpt key={m.user_id} $active={task.assignee_id === m.user_id}
                    onClick={() => { saveField(task.id, 'assignee_id', m.user_id); onLocalUpdate(task.id, { assignee: { id: m.user_id, name: m.name, display_name: m.name } }); setAssigneeOpenId(null); }}>
                    {m.name}{m.user_id === myId ? t('listRow.meSuffix', ' (나)') : ''}
                  </AssigneeOpt>
                ))}
                {externalCandidates.map(e => (
                  <AssigneeOpt key={`e-${e.user_id}`} $active={task.assignee_id === e.user_id}
                    onClick={() => { saveField(task.id, 'assignee_id', e.user_id); onLocalUpdate(task.id, { assignee: { id: e.user_id, name: e.name, display_name: e.name } }); setAssigneeOpenId(null); }}>
                    <AssigneeOptInner><PartnerKindBadge kind={e.kind} size="xs" />{e.name}</AssigneeOptInner>
                  </AssigneeOpt>
                ))}
              </AssigneeDropdown>
            )}
          </TCell>
          <TCell $w={showTimeline ? '60px' : '100px'} $center style={{ position: 'relative', overflow: 'visible' }}>
            <StatusPill data-dropdown $bg={sc.bg} $fg={sc.fg} $clickable
              onClick={e => { e.stopPropagation(); setStatusOpenId(statusOpenId === task.id ? null : task.id); }}
              aria-haspopup="listbox" aria-expanded={statusOpenId === task.id}>
              <StatusGlyph code={task.status} /> {statusLabel}
            </StatusPill>
            {statusOpenId === task.id && (
              <StatusDropdown data-dropdown>
                {statusOptionsFor(task).map(s => {
                  const c = STATUS_COLOR[s as StatusCode] || STATUS_COLOR.not_started;
                  return (
                    <StatusOption key={s} $bg={c.bg} $fg={c.fg} $active={task.status === s}
                      onClick={e => { e.stopPropagation(); saveField(task.id, 'status', s); setStatusOpenId(null); }}>
                      {optionLabel(task, s, role)}
                    </StatusOption>
                  );
                })}
              </StatusDropdown>
            )}
          </TCell>
          <TCell $w={showTimeline ? '110px' : '180px'} $center $hideBelow={1024}>
            <SliderWrap>
              <SliderTrack><SliderFill $w={prog} $color={sliderColor} /></SliderTrack>
              <SliderRange type="range" min="0" max="100" step="5" value={prog}
                onClick={e => e.stopPropagation()}
                onChange={e => onLocalUpdate(task.id, { progress_percent: Number(e.target.value) })}
                onMouseUp={e => saveField(task.id, 'progress_percent', Number((e.target as HTMLInputElement).value))} />
              <SliderPct>{prog}%</SliderPct>
            </SliderWrap>
          </TCell>
          <TCell $w="100px" $center>
            <DateTrigger ref={el => { dateRefs.current[task.id] = el; }}
              $color={isDelayed ? 'overdue' : (task.due_date?.slice(0, 10) === today ? 'today' : 'default')}
              $empty={!(task.start_date || task.due_date)}
              disabled={!canEditDatesFor(task)}
              title={canEditDatesFor(task) ? undefined : t('listRow.datesReadOnly', '기간은 요청자·담당자·관리자만 변경할 수 있어요') as string}
              onClick={e => { e.stopPropagation(); if (!canEditDatesFor(task)) return; setDateOpenId(dateOpenId === task.id ? null : task.id); }}>
              {(() => {
                const s = task.start_date?.slice(0, 10);
                const d = task.due_date?.slice(0, 10);
                const fmt = (v?: string) => v ? v.slice(5).replace('-', '/') : '';
                if (!s && !d) return t('listRow.emptyDash', '—');
                if (s && d && s !== d) return `${fmt(s)} ~ ${fmt(d)}`;
                return fmt(d || s);
              })()}
            </DateTrigger>
            {dateOpenId === task.id && canEditDatesFor(task) && (
              <CalendarPicker isOpen anchorRef={{ current: dateRefs.current[task.id] }}
                startDate={task.start_date?.slice(0, 10) || ''} endDate={task.due_date?.slice(0, 10) || task.start_date?.slice(0, 10) || ''}
                onRangeSelect={(s, e) => { saveFields(task.id, { start_date: s || null, due_date: e || null }); }}
                onClose={() => setDateOpenId(null)} />
            )}
          </TCell>
          {!showTimeline && (
            <TCell $flex $hideBelow={768} style={{ padding: '0 8px' }}>
              <DescText>{task.description || <DescEmpty>{t('listRow.emptyDash', '—')}</DescEmpty>}</DescText>
            </TCell>
          )}
          {showTimeline && range && (
            <TCell $flex2 style={{ overflow: 'visible' }}>
              <GanttRowTrack registry={gantt} range={range} todayStr={today} showGrid>
                <GanttBar range={range} start={task.start_date} end={task.due_date}
                  bg={sc.bg} fg={sc.fg} label={task.assignee?.name || ''}
                  onClick={(e) => { e.stopPropagation(); onOpen(task.id); }}
                  title={`${task.start_date?.slice(0,10) || ''} ~ ${task.due_date?.slice(0,10) || ''}`} />
              </GanttRowTrack>
            </TCell>
          )}
        </TRow>
        {addingBelowId === task.id && (
          <InlineAddRow>
            <InlineSpacer />
            <InlineInput
              autoFocus value={newBelowTitle}
              placeholder={t('list.inlineAddPh', '업무명 입력 (Enter 저장 / Esc 취소)') as string}
              onChange={e => setNewBelowTitle(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newBelowTitle.trim()) submitBelow(task);
                if (e.key === 'Escape') { setAddingBelowId(null); setNewBelowTitle(''); }
              }}
              onBlur={() => { if (!newBelowTitle.trim()) setAddingBelowId(null); }}
            />
          </InlineAddRow>
        )}
      </Fragment>
    );
  };

  // ─── 그룹 헤더 ───
  const renderGroupHeader = (g: { id: number | 'none'; title: string; color: string; rollup?: { total: number; progress_pct: number } | null; idx: number; isFirst: boolean; isLast: boolean }, count: number, pct: number) => {
    const gid = g.id;
    const isCollapsed = collapsed.has(gid);
    const editable = gid !== 'none';
    return (
      <GroupHeader $over={dragOverGroup === gid}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOverGroup !== gid) setDragOverGroup(gid); }}
        onDragLeave={() => setDragOverGroup(prev => prev === gid ? null : prev)}
        onDrop={(e) => {
          e.preventDefault();
          const id = Number(e.dataTransfer.getData('text/plain'));
          const tk = tasks.find(x => x.id === id);
          if (tk) assignGroup(tk, gid === 'none' ? null : gid);
          setDragOverGroup(null); setDragTaskId(null);
        }}>
        <GroupCollapseBtn aria-label={isCollapsed ? t('list.group.expand', '펼치기') as string : t('list.group.collapse', '접기') as string}
          onClick={() => toggleCollapse(gid)}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s' }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </GroupCollapseBtn>
        <GroupDot style={{ background: g.color }} />
        {editingGroupId === gid && editable ? (
          <GroupTitleInput autoFocus value={groupTitleDraft}
            onChange={e => setGroupTitleDraft(e.target.value)}
            onBlur={() => renameGroup(gid as number)}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingGroupId(null); }} />
        ) : (
          <GroupTitle $editable={editable}
            onClick={() => { if (editable) { setEditingGroupId(gid as number); setGroupTitleDraft(g.title); } }}
            title={editable ? t('list.group.rename', '클릭하여 이름 변경') as string : undefined}>
            {g.title}
          </GroupTitle>
        )}
        <GroupCount>{count}</GroupCount>
        <GroupBar><GroupBarFill style={{ width: `${pct}%` }} /></GroupBar>
        <GroupPct>{pct}%</GroupPct>
        {editable && (
          <GroupActions>
            <GroupIconBtn disabled={g.isFirst} aria-label={t('list.group.moveUp', '위로') as string} title={t('list.group.moveUp', '위로') as string}
              onClick={() => moveGroup(gid as number, -1)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15"/></svg>
            </GroupIconBtn>
            <GroupIconBtn disabled={g.isLast} aria-label={t('list.group.moveDown', '아래로') as string} title={t('list.group.moveDown', '아래로') as string}
              onClick={() => moveGroup(gid as number, 1)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
            </GroupIconBtn>
            <GroupMoveWrap data-dropdown>
              <GroupIconBtn data-dropdown aria-label={t('list.group.menu', '그룹 메뉴') as string} title={t('list.group.menu', '그룹 메뉴') as string}
                onClick={() => setHeaderMenuGroupId(headerMenuGroupId === gid ? null : (gid as number))}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>
              </GroupIconBtn>
              {headerMenuGroupId === gid && (
                <GroupMenu data-dropdown style={{ right: 0, left: 'auto' }}>
                  <GroupMenuItem $danger onClick={() => removeGroup(gid as number)}>
                    {t('list.group.delete', '그룹 삭제')}
                  </GroupMenuItem>
                  <GroupMenuHint>{t('list.group.deleteHint', '소속 업무는 미분류로 이동됩니다')}</GroupMenuHint>
                </GroupMenu>
              )}
            </GroupMoveWrap>
          </GroupActions>
        )}
      </GroupHeader>
    );
  };

  const colRow = (
    <ColRow>
      {/* ★ 헤더 라벨과 본문 셀은 **같은 prop** 을 받아야 세로로 맞는다 (#236 후속).
          styled 분기만 같게 맞추는 것으로는 부족했다 — 정렬을 정하는 건 각 컬럼에 넘기는
          `$w`(뷰 의존 폭)와 `$hideBelow`(숨김 시점)다. 헤더는 64/52/72px 고정에 $hideBelow 도 없어서
          고정폭 합이 본문과 240px 넘게 달랐고(288 vs 530), 남는 폭을 flexible 컬럼이 다르게 나눠 가져
          전 컬럼이 밀렸다. 게다가 좁은 폭에서 본문 컬럼이 사라져도 헤더 라벨만 남았다.
          아래 값들은 본문 TCell(446·469·489·499·521·526행)과 **글자 그대로 같아야 한다** — 한쪽만 고치지 말 것. */}
      <Col $flex2 onClick={() => handleSort('title')}>{t('col.task', '업무')} {sortIcon('title')}</Col>
      <Col $w={showTimeline ? '90px' : '150px'} $center $hideBelow={900}>{t('col.assignee', '담당자')}</Col>
      <Col $w={showTimeline ? '60px' : '100px'} $center onClick={() => handleSort('status')}>{t('col.status', '상태')} {sortIcon('status')}</Col>
      <Col $w={showTimeline ? '110px' : '180px'} $center $hideBelow={1024} onClick={() => handleSort('progress_percent')}>{t('col.progressPercent', '진행률')} {sortIcon('progress_percent')}</Col>
      <Col $w="100px" $center onClick={() => handleSort('start_date')}>{t('col.dates', '기간')} {sortIcon('start_date')}</Col>
      {showTimeline && range && (
        <Col $flex2 $center style={{ position: 'relative', overflow: 'visible' }}>
          <GanttHeader registry={gantt} range={range} tickMode="auto" />
        </Col>
      )}
      {/* 본문 설명 셀(521행)의 `padding:0 8px` 를 헤더에도 준다 — border-box 에서 flex-basis:0 인
          항목의 패딩은 **기본 크기 16px** 로 잡혀 남는 폭 배분이 2:1 에서 어긋난다(11px 밀림 실측). */}
      {!showTimeline && <Col $flex $hideBelow={768} style={{ padding: '0 8px' }}>{t('col.desc', '설명')}</Col>}
    </ColRow>
  );

  // ─── 그룹 모드 렌더 ───
  if (grouped) {
    const ordered = [...(workstreams || [])].sort((a, b) => a.order_index - b.order_index);
    const groups: { id: number | 'none'; title: string; color: string }[] = [
      ...ordered.map((w, i) => ({ id: w.id, title: w.title, color: wsColor(w, i) })),
      { id: 'none' as const, title: t('list.group.none', '(그룹 없음)') as string, color: '#CBD5E1' },
    ];
    // 방어: 삭제된 그룹을 가리키는 stale workstream_id 도 미분류로 버킷 — 어느 그룹에도 안 잡혀 사라지는 회귀 차단.
    const validIds = new Set(ordered.map(w => w.id));
    const groupOf = (tk: TaskRow): number | 'none' => {
      const w = tk.workstream_id ?? null;
      return (w != null && validIds.has(w)) ? w : 'none';
    };
    const byGroup = (gid: number | 'none') => sortTasks(tasks.filter(tk => groupOf(tk) === gid));
    const noneTasks = byGroup('none');

    return (
      <>
        {colRow}
        {groups.map((g, gi) => {
          if (g.id === 'none' && noneTasks.length === 0) return null;  // 미분류 0건이면 헤더 숨김
          const gTasks = g.id === 'none' ? noneTasks : byGroup(g.id);
          const count = gTasks.length;
          // 진행률 = 업무 progress_percent 평균 (백엔드 serializeWorkstream.progress_pct·캔버스와 동일 공식 — 단일 진실 원천).
          const pct = count > 0 ? Math.round(gTasks.reduce((s, tk) => s + (tk.progress_percent || 0), 0) / count) : 0;
          const isCollapsed = collapsed.has(g.id);
          return (
            <Fragment key={String(g.id)}>
              {renderGroupHeader(
                { id: g.id, title: g.title, color: g.color, idx: gi, isFirst: gi === 0, isLast: gi === ordered.length - 1 },
                count, pct,
              )}
              {!isCollapsed && (
                <GroupBody $over={dragOverGroup === g.id}
                  onDragOver={(e) => { e.preventDefault(); if (dragOverGroup !== g.id) setDragOverGroup(g.id); }}
                  onDragLeave={() => setDragOverGroup(prev => prev === g.id ? null : prev)}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = Number(e.dataTransfer.getData('text/plain'));
                    const tk = tasks.find(x => x.id === id);
                    if (tk) assignGroup(tk, g.id === 'none' ? null : g.id);
                    setDragOverGroup(null); setDragTaskId(null);
                  }}>
                  {gTasks.length === 0
                    ? <GroupEmpty>{t('list.group.empty', '이 그룹에 업무가 없습니다 — 아래에서 추가하거나 드래그하세요')}</GroupEmpty>
                    : gTasks.map(renderTaskRow)}
                  {/* #120 — 그룹별 업무 직접 추가 (빈 그룹 포함) */}
                  {projectId != null && (addingInGroup === g.id ? (
                    <AddTaskInGroupRow>
                      <AddTaskInGroupInput autoFocus value={newGroupTaskTitle}
                        placeholder={t('list.group.addTaskPh', '업무 제목 입력 (Enter 추가 / Esc 취소)') as string}
                        onChange={e => setNewGroupTaskTitle(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') submitGroupTask(g.id); if (e.key === 'Escape') { setAddingInGroup(null); setNewGroupTaskTitle(''); } }}
                        onBlur={() => { if (!newGroupTaskTitle.trim()) setAddingInGroup(null); }} />
                      <AddTaskInGroupGo type="button" disabled={submittingGroupTask || !newGroupTaskTitle.trim()} onClick={() => submitGroupTask(g.id)}>
                        {t('list.group.addTaskGo', '추가')}
                      </AddTaskInGroupGo>
                    </AddTaskInGroupRow>
                  ) : (
                    <AddTaskInGroupBtn type="button" onClick={() => { setNewGroupTaskTitle(''); setAddingInGroup(g.id); }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      {t('list.group.addTask', '업무 추가')}
                    </AddTaskInGroupBtn>
                  ))}
                </GroupBody>
              )}
            </Fragment>
          );
        })}
        {addingGroup ? (
          <AddGroupRow>
            <GroupDot style={{ background: '#CBD5E1' }} />
            <GroupTitleInput autoFocus value={newGroupTitle}
              placeholder={t('list.group.newGroupPh', '그룹 이름 입력 (Enter 추가 / Esc 취소)') as string}
              onChange={e => setNewGroupTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitNewGroup(); if (e.key === 'Escape') { setAddingGroup(false); setNewGroupTitle(''); } }}
              onBlur={() => { if (!newGroupTitle.trim()) setAddingGroup(false); }} />
          </AddGroupRow>
        ) : (
          projectId != null && <AddGroupBtn type="button" onClick={() => { setNewGroupTitle(''); setAddingGroup(true); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            {t('list.group.addGroup', '추진과제(그룹) 추가')}
          </AddGroupBtn>
        )}
        {tasks.length === 0 && !addingGroup && <EmptyMsg>{t('list.empty', '업무가 없습니다')}</EmptyMsg>}
      </>
    );
  }

  // ─── 플랫 모드 (그룹 prop 없을 때 — 기존 동작) ───
  return (
    <>
      {colRow}
      {sorted.map(renderTaskRow)}
      {sorted.length === 0 && <EmptyMsg>{t('list.empty', '업무가 없습니다')}</EmptyMsg>}
    </>
  );
};

export default ProjectTaskList;

