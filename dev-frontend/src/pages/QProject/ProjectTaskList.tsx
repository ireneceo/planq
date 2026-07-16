// 프로젝트 업무 탭용 리스트 — Q Task 테이블 디자인 그대로
// (프로젝트 컬럼·예측·실제 컬럼 제외)
// R1-C3: workstreams prop 이 오면 워크스트림(업무 그룹) 단위로 묶어 표시.
//   그룹 헤더(색·인라인 이름·카운트·진행바·▲▼·삭제) + "(그룹 없음)" + 인라인 추가 그룹
//   + 행별 그룹 드롭다운 + 드래그 핸들. 캔버스↔업무리스트 단일 진실 원천(project_workstreams) 양방향 동기화.
import React, { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import CalendarPicker from '../../components/Common/CalendarPicker';
import PartnerKindBadge from '../../components/Common/PartnerKindBadge';
import { apiFetch } from '../../contexts/AuthContext';
import TaskRowActionMenu from '../../components/QTask/TaskRowActionMenu';
import { GanttHeader, GanttRowTrack, GanttBar, useGanttScrollSync, type GanttRange } from '../../components/Common/GanttTrack';
import { STATUS_COLOR, displayStatus, getStatusLabel, type StatusCode } from '../../utils/taskLabel';
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
  assignee_id: number | null; assignee?: { id: number; name: string } | null;
  requester?: { id: number; name: string } | null;
  source?: string; request_by_user_id?: number | null; created_by?: number;
  request_ack_at?: string | null; review_round?: number | null;
  reviewers?: Array<{ id: number; user_id: number; state: 'pending'|'approved'|'revision'; is_client?: boolean }>;
}

// 업무 종류별 드롭다운 옵션 (Q Task 와 동일)
// 사이클 N+6: reviewer 0명이면 reviewing/revision_requested 단계 자체가 노출되지 않음. 백엔드 PUT 가드 (no_reviewers_assigned 400) 와 일관.
// 사이클 N+22 (2026-05-18): waiting (진행대기) 은 DB ENUM 정식 값 — 리스트/뱃지에서 노출되므로 드롭다운도 일관 포함 (요청·비요청 무관).
const statusOptionsFor = (task: { source?: string; reviewers?: Array<{ user_id: number }> }): string[] => {
  const hasReviewers = (task.reviewers || []).length > 0;
  let opts = ['not_started', 'waiting', 'in_progress', 'reviewing', 'revision_requested', 'completed', 'canceled'];
  if (!hasReviewers) opts = opts.filter(s => s !== 'reviewing' && s !== 'revision_requested');
  return opts;
};

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
  const [sortKey, setSortKey] = useState<SortKey>('start_date');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [editingTitle, setEditingTitle] = useState<number | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [addingBelowId, setAddingBelowId] = useState<number | null>(null);
  const [newBelowTitle, setNewBelowTitle] = useState('');
  const [submittingBelow, setSubmittingBelow] = useState(false);
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

  const saveField = async (taskId: number, field: string, value: unknown) => {
    const prevVal = (tasks.find((t) => t.id === taskId) as Record<string, unknown> | undefined)?.[field];
    onLocalUpdate(taskId, { [field]: value } as Partial<TaskRow>);
    const r = await apiFetch(`/api/tasks/by-business/${businessId}/${taskId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [field]: value }) });
    if (!r.ok) onLocalUpdate(taskId, { [field]: prevVal } as Partial<TaskRow>);  // 실패 시 낙관적 되돌림(assignGroup 패턴)
  };

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
    const sliderColor = task.status === 'completed' ? '#94A3B8' : isDelayed ? '#DC2626' : '#14B8A6';

    return (
      <Fragment key={task.id}>
        <TRow data-task-row $done={task.status === 'completed'} $delayed={isDelayed} $selected={selectedId === task.id} $dragging={dragTaskId === task.id}
          onClick={(e) => {
            const tgt = e.target as HTMLElement;
            if (tgt.closest('button,a,input,select,textarea,[role="button"],[data-dropdown]')) return;
            onOpen(task.id);
          }}
          style={{ cursor: 'pointer' }}>

          <TCell $flex>
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
            <TaskCheck type="checkbox" checked={task.status === 'completed'}
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
                    onClick={() => { saveField(task.id, 'assignee_id', m.user_id); onLocalUpdate(task.id, { assignee: { id: m.user_id, name: m.name } }); setAssigneeOpenId(null); }}>
                    {m.name}{m.user_id === myId ? t('listRow.meSuffix', ' (나)') : ''}
                  </AssigneeOpt>
                ))}
                {externalCandidates.map(e => (
                  <AssigneeOpt key={`e-${e.user_id}`} $active={task.assignee_id === e.user_id}
                    onClick={() => { saveField(task.id, 'assignee_id', e.user_id); onLocalUpdate(task.id, { assignee: { id: e.user_id, name: e.name } }); setAssigneeOpenId(null); }}>
                    <AssigneeOptInner><PartnerKindBadge kind={e.kind} size="xs" />{e.name}</AssigneeOptInner>
                  </AssigneeOpt>
                ))}
              </AssigneeDropdown>
            )}
          </TCell>
          <TCell $w={showTimeline ? '60px' : '100px'} $center style={{ position: 'relative', overflow: 'visible' }}>
            <StatusPill data-dropdown $bg={sc.bg} $fg={sc.fg} $clickable
              onClick={e => { e.stopPropagation(); setStatusOpenId(statusOpenId === task.id ? null : task.id); }}>
              {statusLabel}
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
              onClick={e => { e.stopPropagation(); setDateOpenId(dateOpenId === task.id ? null : task.id); }}>
              {(() => {
                const s = task.start_date?.slice(0, 10);
                const d = task.due_date?.slice(0, 10);
                const fmt = (v?: string) => v ? v.slice(5).replace('-', '/') : '';
                if (!s && !d) return t('listRow.emptyDash', '—');
                if (s && d && s !== d) return `${fmt(s)} ~ ${fmt(d)}`;
                return fmt(d || s);
              })()}
            </DateTrigger>
            {dateOpenId === task.id && (
              <CalendarPicker isOpen anchorRef={{ current: dateRefs.current[task.id] }}
                startDate={task.start_date?.slice(0, 10) || ''} endDate={task.due_date?.slice(0, 10) || task.start_date?.slice(0, 10) || ''}
                onRangeSelect={(s, e) => { saveField(task.id, 'start_date', s || null); saveField(task.id, 'due_date', e || null); }}
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
      <Col $flex onClick={() => handleSort('title')}>{t('col.task', '업무')} {sortIcon('title')}</Col>
      <Col $w="64px" $center>{t('col.assignee', '담당자')}</Col>
      <Col $w="52px" $center onClick={() => handleSort('status')}>{t('col.status', '상태')} {sortIcon('status')}</Col>
      <Col $w="72px" $center onClick={() => handleSort('progress_percent')}>{t('col.progressPercent', '진행률')} {sortIcon('progress_percent')}</Col>
      <Col $w="100px" $center onClick={() => handleSort('start_date')}>{t('col.dates', '기간')} {sortIcon('start_date')}</Col>
      {showTimeline && range && (
        <Col $flex2 $center style={{ position: 'relative', overflow: 'visible' }}>
          <GanttHeader registry={gantt} range={range} tickMode="auto" />
        </Col>
      )}
      {!showTimeline && <Col $flex $hideBelow={768}>{t('col.desc', '설명')}</Col>}
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

// ═══ Styled (Q Task 와 완전 동일) ═══
const ColRow = styled.div`display:flex;align-items:center;gap:6px;padding:6px 14px;border-bottom:1px solid #E2E8F0;background:#F8FAFC;position:sticky;top:0;z-index:1;min-width:520px;`;
const Col = styled.span<{$w?:string;$flex?:boolean;$flex2?:boolean;$center?:boolean;$hideBelow?:number}>`
  box-sizing:border-box;min-width:0;
  ${p=>p.$flex2 ? 'flex:2.5 1 0;'
                : p.$flex ? 'flex:3 1 0;'
                : `flex:1 1 ${p.$w||'72px'};max-width:${p.$w||'auto'};`}
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-size:11px;font-weight:700;color:#94A3B8;cursor:pointer;user-select:none;
  ${p=>p.$center&&'text-align:center;'}
  &:hover{color:#475569;}
  ${p=>p.$hideBelow?`@media (max-width: ${p.$hideBelow}px){display:none;}`:''}
`;
const TRow = styled.div<{$done?:boolean;$delayed?:boolean;$selected?:boolean;$dragging?:boolean}>`
  display:flex;align-items:center;gap:6px;padding:6px 12px;border-bottom:1px solid #F8FAFC;
  min-width:520px;opacity:${p=>p.$dragging?0.4:p.$done?0.45:1};
  ${p=>p.$selected?'background:#FFF1F2;box-shadow:inset 3px 0 0 #F43F5E;':p.$delayed&&!p.$done?'box-shadow:inset 3px 0 0 #DC2626;':''}
  &:hover{background:${p=>p.$selected?'#FFE4E6':p.$delayed&&!p.$done?'#FEF2F2':'#FAFBFC'};}
`;
const TCell = styled.div<{$w?:string;$flex?:boolean;$flex2?:boolean;$center?:boolean;$hideBelow?:number}>`
  box-sizing:border-box;
  ${p=>p.$flex2 ? 'flex:2 1 0;min-width:160px;display:flex;align-items:center;gap:6px;overflow:hidden;' : p.$flex ? 'flex:1 1 0;min-width:100px;display:flex;align-items:center;gap:6px;overflow:hidden;' : `flex:0 0 ${p.$w||'auto'};width:${p.$w||'auto'};overflow:hidden;`}
  ${p=>p.$center&&'display:flex;justify-content:center;align-items:center;'}
  ${p=>p.$hideBelow?`@media (max-width: ${p.$hideBelow}px){display:none;}`:''}
`;
const Spacer = styled.div`flex:1;min-width:8px;`;
const DragHandle = styled.span`
  display:inline-flex;align-items:center;justify-content:center;width:18px;height:24px;flex-shrink:0;
  color:#CBD5E1;cursor:grab;border-radius:4px;
  &:hover{color:#94A3B8;background:#F1F5F9;}
  &:active{cursor:grabbing;}
`;
const TaskCheck = styled.input`accent-color:#0D9488;cursor:pointer;width:15px;height:15px;flex-shrink:0;`;
const InlineAddRow = styled.div`
  display: flex; align-items: center; gap: 8px;
  padding: 6px 12px;
  background: #F0FDFA;
  border-bottom: 1px solid #F8FAFC;
  min-width: 520px;
`;
const InlineSpacer = styled.div`width: 24px; flex-shrink: 0;`;
const InlineInput = styled.input`
  flex: 1; min-width: 0;
  padding: 4px 8px; height: 26px;
  font-size: 13px; color: #0F172A;
  background: #FFFFFF; border: 1px solid #14B8A6; border-radius: 6px;
  font-family: inherit;
  &:focus { outline: none; box-shadow: 0 0 0 2px rgba(20,184,166,0.15); }
  &::placeholder { color: #94A3B8; }
`;
const TaskTitle = styled.span<{$done?:boolean}>`font-size:14px;font-weight:500;color:#0F172A;cursor:text;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${p=>p.$done&&'text-decoration:line-through;color:#94A3B8;'}&:hover{color:#0F766E;}`;
const TitleInput = styled.input`flex:1;font-size:14px;font-weight:500;color:#0F172A;border:1px solid #14B8A6;background:#F0FDFA;padding:2px 8px;border-radius:6px;font-family:inherit;height:24px;box-sizing:border-box;&:focus{outline:none;box-shadow:0 0 0 2px rgba(20,184,166,0.15);}`;
const DelayBadge = styled.span`padding:1px 6px;font-size:9px;font-weight:700;color:#DC2626;background:#FEF2F2;border:1px solid #FECACA;border-radius:4px;flex-shrink:0;white-space:nowrap;`;
const DetailBtn = styled.button<{$active?:boolean}>`display:flex;align-items:center;justify-content:center;width:28px;height:28px;background:${p=>p.$active?'#F43F5E':'transparent'};border:1px solid ${p=>p.$active?'#F43F5E':'transparent'};border-radius:6px;color:${p=>p.$active?'#FFF':'#94A3B8'};cursor:pointer;flex-shrink:0;transition:all 0.15s;&:hover{background:${p=>p.$active?'#E11D48':'#F1F5F9'};color:${p=>p.$active?'#FFF':'#0F766E'};border-color:${p=>p.$active?'#E11D48':'#E2E8F0'};}`;
const NameChip = styled.span<{$type:'from'|'to'|'observer'}>`
  display:inline-flex;align-items:center;padding:1px 8px;font-size:10px;font-weight:700;border-radius:8px;white-space:nowrap;flex-shrink:0;
  ${p=>p.$type==='from'?'background:#FFF1F2;color:#9F1239;'
    :p.$type==='to'?'background:#F0FDFA;color:#0F766E;'
    :'background:#F1F5F9;color:#64748B;'}
`;
// 그룹 이동 (행별 드롭다운)
const GroupMoveWrap = styled.div`position:relative;flex-shrink:0;`;
const GroupMoveBtn = styled.button`display:inline-flex;align-items:center;gap:1px;height:24px;padding:0 5px;background:transparent;border:1px solid transparent;border-radius:6px;color:#94A3B8;cursor:pointer;&:hover{background:#F1F5F9;color:#0F766E;border-color:#E2E8F0;}`;
const GroupMenu = styled.div`position:absolute;top:100%;left:0;z-index:120;min-width:160px;max-height:240px;overflow-y:auto;background:#FFF;border:1px solid #E2E8F0;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.12);padding:4px;margin-top:4px;`;
const GroupMenuItem = styled.button<{$active?:boolean;$danger?:boolean}>`
  display:flex;align-items:center;gap:8px;width:100%;padding:6px 10px;font-size:12px;text-align:left;border:none;border-radius:6px;cursor:pointer;
  background:${p=>p.$active?'#F0FDFA':'transparent'};
  color:${p=>p.$danger?'#DC2626':p.$active?'#0F766E':'#0F172A'};font-weight:${p=>p.$active?600:500};
  &:hover{background:${p=>p.$danger?'#FEF2F2':'#F0FDFA'};color:${p=>p.$danger?'#DC2626':'#0F766E'};}
`;
const GroupMenuHint = styled.div`padding:4px 10px 2px;font-size:10px;color:#94A3B8;`;
const GroupDot = styled.span`width:9px;height:9px;border-radius:50%;flex-shrink:0;`;
// 그룹 헤더
const GroupHeader = styled.div<{$over?:boolean}>`
  display:flex;align-items:center;gap:8px;padding:8px 12px;min-width:520px;
  background:${p=>p.$over?'#F0FDFA':'#FBFCFE'};border-bottom:1px solid #E2E8F0;border-top:1px solid #F1F5F9;
  ${p=>p.$over&&'box-shadow:inset 0 0 0 2px #99F6E4;'}
`;
const GroupCollapseBtn = styled.button`display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;background:transparent;border:none;border-radius:4px;color:#64748B;cursor:pointer;flex-shrink:0;&:hover{background:#F1F5F9;color:#0F172A;}`;
const GroupTitle = styled.span<{$editable?:boolean}>`font-size:13px;font-weight:700;color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px;${p=>p.$editable&&'cursor:text;&:hover{color:#0F766E;}'}`;
const GroupTitleInput = styled.input`font-size:13px;font-weight:700;color:#0F172A;border:1px solid #14B8A6;background:#F0FDFA;padding:2px 8px;border-radius:6px;font-family:inherit;height:26px;box-sizing:border-box;min-width:160px;flex:0 1 240px;&:focus{outline:none;box-shadow:0 0 0 2px rgba(20,184,166,0.15);}&::placeholder{color:#94A3B8;font-weight:500;}`;
const GroupCount = styled.span`display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:18px;padding:0 6px;background:#E2E8F0;color:#475569;border-radius:999px;font-size:10px;font-weight:700;flex-shrink:0;`;
const GroupBar = styled.div`flex:0 1 120px;min-width:48px;height:5px;background:#F1F5F9;border-radius:999px;overflow:hidden;margin-left:4px;`;
const GroupBarFill = styled.div`height:100%;background:linear-gradient(90deg,#99F6E4,#14B8A6);border-radius:999px;`;
const GroupPct = styled.span`font-size:11px;font-weight:700;color:#64748B;font-variant-numeric:tabular-nums;flex-shrink:0;min-width:30px;`;
const GroupActions = styled.div`display:flex;align-items:center;gap:2px;margin-left:auto;flex-shrink:0;`;
const GroupIconBtn = styled.button`display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;background:transparent;border:1px solid transparent;border-radius:6px;color:#94A3B8;cursor:pointer;&:hover:not(:disabled){background:#F1F5F9;color:#0F766E;border-color:#E2E8F0;}&:disabled{opacity:0.35;cursor:default;}`;
const GroupBody = styled.div<{$over?:boolean}>`${p=>p.$over&&'background:#F0FDFA;'}`;
const GroupEmpty = styled.div`padding:10px 16px 10px 40px;font-size:12px;color:#CBD5E1;min-width:520px;`;
const AddGroupBtn = styled.button`display:inline-flex;align-items:center;gap:6px;margin:10px 0 4px 12px;padding:7px 12px;background:transparent;color:#0F766E;border:1px dashed #99F6E4;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;&:hover{background:#F0FDFA;border-color:#14B8A6;}`;
const AddGroupRow = styled.div`display:flex;align-items:center;gap:8px;padding:8px 12px;min-width:520px;background:#F0FDFA;border-top:1px solid #99F6E4;`;
// #120 — 그룹별 업무 추가
const AddTaskInGroupBtn = styled.button`display:inline-flex;align-items:center;gap:5px;margin:4px 0 4px 40px;padding:5px 10px;background:transparent;color:#94A3B8;border:1px dashed #E2E8F0;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;&:hover{background:#F0FDFA;border-color:#99F6E4;color:#0F766E;}`;
const AddTaskInGroupRow = styled.div`display:flex;align-items:center;gap:8px;padding:6px 12px 6px 40px;min-width:520px;`;
const AddTaskInGroupInput = styled.input`flex:0 1 360px;font-size:13px;color:#0F172A;border:1px solid #14B8A6;background:#F0FDFA;padding:5px 10px;border-radius:6px;font-family:inherit;height:30px;box-sizing:border-box;&:focus{outline:none;box-shadow:0 0 0 2px rgba(20,184,166,0.15);}&::placeholder{color:#94A3B8;}`;
const AddTaskInGroupGo = styled.button`height:30px;padding:0 14px;background:#14B8A6;color:#FFF;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;&:hover:not(:disabled){background:#0D9488;}&:disabled{opacity:0.5;cursor:not-allowed;}`;
const StatusPill = styled.span<{$bg:string;$fg:string;$clickable?:boolean}>`
  padding:2px 8px;background:${p=>p.$bg};color:${p=>p.$fg};font-size:10px;font-weight:600;
  border-radius:8px;white-space:nowrap;${p=>p.$clickable?'cursor:pointer;user-select:none;&:hover{filter:brightness(0.96);}':''}
`;
const StatusDropdown = styled.div`position:absolute;top:100%;left:50%;transform:translateX(-50%);z-index:100;background:#FFF;border:1px solid #E2E8F0;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.12);padding:4px;min-width:100px;margin-top:4px;`;
const StatusOption = styled.button<{$bg:string;$fg:string;$active?:boolean}>`
  display:block;width:100%;padding:5px 10px;font-size:11px;font-weight:600;text-align:left;border:none;border-radius:6px;cursor:pointer;
  background:${p=>p.$active?p.$bg:'transparent'};color:${p=>p.$fg};&:hover{background:${p=>p.$bg};}
`;
const SliderWrap = styled.div`display:flex;align-items:center;gap:6px;width:100%;position:relative;`;
const SliderTrack = styled.div`flex:1;height:6px;background:#F1F5F9;border-radius:3px;overflow:hidden;`;
const SliderFill = styled.div<{$w:number;$color:string}>`height:100%;width:${p=>p.$w}%;background:${p=>p.$color};border-radius:3px;`;
const SliderRange = styled.input`position:absolute;left:0;top:-4px;width:calc(100% - 40px);height:18px;opacity:0;cursor:pointer;`;
const SliderPct = styled.span`font-size:12px;font-weight:700;color:#475569;min-width:32px;text-align:right;`;
const DateTrigger = styled.button<{$color?:string;$empty?:boolean}>`
  width:100%;padding:4px 6px;font-size:12px;font-weight:600;background:transparent;border:1px solid transparent;border-radius:6px;cursor:pointer;white-space:nowrap;font-family:inherit;text-align:center;
  color:${p=>p.$empty?'#CBD5E1':p.$color==='overdue'?'#DC2626':p.$color==='today'?'#EA580C':'#64748B'};
  ${p=>p.$color==='overdue'&&!p.$empty?'background:#FEF2F2;':p.$color==='today'&&!p.$empty?'background:#FFF7ED;':''}
  &:hover{border-color:#14B8A6;color:#0F766E;}
`;
const AssigneeLabel = styled.span`display:inline-block;font-size:12px;color:#0F172A;cursor:pointer;padding:2px 6px;border-radius:4px;&:hover{background:#F1F5F9;}`;
const AssigneeDropdown = styled.div`position:absolute;top:100%;left:0;z-index:100;min-width:140px;max-height:220px;overflow-y:auto;background:#FFF;border:1px solid #E2E8F0;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.12);padding:4px;margin-top:4px;`;
const AssigneeOpt = styled.button<{$active?:boolean}>`display:block;width:100%;padding:5px 10px;font-size:12px;text-align:left;border:none;border-radius:6px;cursor:pointer;background:${p=>p.$active?'#F0FDFA':'transparent'};color:${p=>p.$active?'#0F766E':'#0F172A'};font-weight:${p=>p.$active?600:500};&:hover{background:#F0FDFA;color:#0F766E;}`;
const AssigneeOptInner = styled.span`display:inline-flex;align-items:center;gap:8px;`;
const EmptyMsg = styled.div`padding:32px;text-align:center;color:#94A3B8;font-size:13px;`;
const DescText = styled.span`font-size:12px;color:#64748B;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;`;
const DescEmpty = styled.span`color:#CBD5E1;`;
