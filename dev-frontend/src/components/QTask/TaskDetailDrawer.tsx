// 업무 상세 드로어 — 오버레이(position:fixed) 패널.
// QTaskPage / QProjectDetailPage 양쪽에서 공용. 단일 taskId 를 받아 상세 + 워크플로우
// (리뷰어/히스토리/댓글/첨부/리치 본문) 를 자체 로드·편집.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import CalendarPicker from '../Common/CalendarPicker';
import RichEditor from '../Common/RichEditor';
import TaskAttachments from './TaskAttachments';
import { STATUS_COLOR, displayStatus, getStatusLabel, type StatusCode } from '../../utils/taskLabel';
import { getRoles, primaryPerspective } from '../../utils/taskRoles';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useEscapeStack } from '../../hooks/useEscapeStack';

export interface DrawerTaskPatch {
  id: number;
  title?: string;
  status?: string;
  description?: string | null;
  body?: string | null;
  start_date?: string | null;
  due_date?: string | null;
  estimated_hours?: number | null;
  actual_hours?: number | null;
  progress_percent?: number;
}

export interface DrawerMemberOption { user_id: number; name: string; }

interface CommentAttach {
  id: number;
  stored_name?: string;
  original_name: string;
  file_size: number;
  mime_type: string | null;
}
interface CommentRow {
  id: number;
  content: string;
  createdAt: string;
  author?: { name: string };
  attachments?: CommentAttach[];
}
interface ReviewerRow {
  id: number; user_id: number; state: 'pending'|'approved'|'revision';
  is_client: boolean; reverted_once: boolean; action_at: string | null;
  user?: { id: number; name: string };
}
interface HistoryRow {
  id: number; event_type: string; from_status: string | null; to_status: string | null;
  actor_user_id: number | null; actor_role: string | null; target_user_id: number | null;
  round: number | null; note: string | null; createdAt: string;
  actor?: { id: number; name: string }; target?: { id: number; name: string };
}
interface TaskDetail {
  id: number; title: string; description: string | null; body: string | null;
  status: string; priority_order: number | null;
  start_date: string | null; due_date: string | null;
  estimated_hours: number | null; actual_hours: number; progress_percent: number;
  source?: string; request_by_user_id?: number | null; request_ack_at?: string | null;
  review_round?: number | null; review_policy?: 'all'|'any';
  assignee_id: number | null; created_by: number; project_id: number | null;
  Project?: { id: number; name: string } | null;
  assignee?: { id: number; name: string } | null;
  requester?: { id: number; name: string } | null;
  creator?: { id: number; name: string } | null;
  comments?: CommentRow[];
  daily_progress?: { snapshot_date: string; progress_percent: number; actual_hours: number; estimated_hours: number | null }[];
}

export interface TaskDetailDrawerProps {
  taskId: number;
  bizId: number;
  myId: number;
  todayStr: string;
  members: DrawerMemberOption[];
  width?: number;
  onWidthChange?: (w: number) => void;
  onClose: () => void;
  onPatch?: (patch: DrawerTaskPatch) => void;
  onRefresh?: () => void;
}

const statusOptionsFor = (task: { source?: string }): string[] => {
  const isReq = task.source === 'internal_request' || task.source === 'qtalk_extract';
  if (isReq) return ['not_started','waiting','in_progress','reviewing','revision_requested','done_feedback','completed','canceled'];
  return ['not_started','in_progress','reviewing','revision_requested','done_feedback','completed','canceled'];
};

const TaskDetailDrawer: React.FC<TaskDetailDrawerProps> = ({
  taskId, bizId, myId, todayStr, members,
  width, onWidthChange, onClose, onPatch, onRefresh,
}) => {
  const { t } = useTranslation('qtask');
  const { hasRole } = useAuth();
  const drawerRef = useRef<HTMLElement>(null);
  useBodyScrollLock(!!taskId);
  useEscapeStack(!!taskId, onClose);
  useFocusTrap(drawerRef, !!taskId);

  const [detailTask, setDetailTask] = useState<TaskDetail | null>(null);
  const [reviewers, setReviewers] = useState<ReviewerRow[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [reviewPolicy, setReviewPolicy] = useState<'all'|'any'>('all');

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [statusOpen, setStatusOpen] = useState(false);
  const [openReviewers, setOpenReviewers] = useState(false);
  const [openHistory, setOpenHistory] = useState(false);
  const [openDaily, setOpenDaily] = useState(false);

  const [newComment, setNewComment] = useState('');
  const [commentFiles, setCommentFiles] = useState<File[]>([]);
  const [commentSending, setCommentSending] = useState(false);

  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionNote, setRevisionNote] = useState('');
  const [addReviewerOpen, setAddReviewerOpen] = useState(false);
  const [pendingReviewerAdd, setPendingReviewerAdd] = useState<number | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [saveStatus, setSaveStatus] = useState<'idle'|'saving'|'saved'|'error'>('idle');
  const saveStatusTimerRef = useRef<number | null>(null);
  const setSaveStatusTemp = (s: 'saving'|'saved'|'error') => {
    setSaveStatus(s);
    if (saveStatusTimerRef.current) window.clearTimeout(saveStatusTimerRef.current);
    if (s === 'saved') saveStatusTimerRef.current = window.setTimeout(() => setSaveStatus('idle'), 1800);
    if (s === 'error') saveStatusTimerRef.current = window.setTimeout(() => setSaveStatus('idle'), 4000);
  };

  const debouncedRef = useRef<{ [key: string]: number }>({});

  // ── 리사이즈 핸들 ──
  const [localWidth, setLocalWidth] = useState<number>(width ?? 560);
  useEffect(() => { if (width != null) setLocalWidth(width); }, [width]);
  const resizingRef = useRef(false);
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  };
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const w = Math.max(420, Math.min(1000, window.innerWidth - e.clientX));
      setLocalWidth(w);
    };
    const onUp = () => {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      onWidthChange?.(localWidth);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [localWidth, onWidthChange]);

  // ── 로드 ──
  const loadWorkflow = useCallback(async (id: number) => {
    try {
      const r = await (await apiFetch(`/api/tasks/${id}/workflow`)).json();
      if (r.success) {
        setReviewers(r.data.reviewers || []);
        setHistory(r.data.history || []);
        setReviewPolicy(r.data.task?.review_policy || 'all');
      }
    } catch { /* ignore */ }
  }, []);
  const loadDetail = useCallback(async (id: number) => {
    try {
      const [dr] = await Promise.all([
        apiFetch(`/api/tasks/${id}/detail`).then(r => r.json()),
        loadWorkflow(id),
      ]);
      if (dr.success) setDetailTask(dr.data);
    } catch { /* ignore */ }
  }, [loadWorkflow]);

  useEffect(() => {
    setDetailTask(null);
    setReviewers([]); setHistory([]);
    setEditingTitle(false); setStatusOpen(false);
    setOpenReviewers(false); setOpenHistory(false); setOpenDaily(false);
    setNewComment(''); setCommentFiles([]);
    setRevisionOpen(false); setRevisionNote('');
    setAddReviewerOpen(false); setPendingReviewerAdd(null);
    setDeleteConfirmOpen(false); setDeleting(false);
    loadDetail(taskId);
  }, [taskId, loadDetail]);

  // Esc 닫기 + 상태 드롭다운 외부 클릭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    if (!statusOpen) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) { if (e.key === 'Escape') setStatusOpen(false); return; }
      const tgt = e.target as HTMLElement | null;
      if (tgt && tgt.closest('[data-dropdown="status-detail"]')) return;
      setStatusOpen(false);
    };
    const id = window.setTimeout(() => {
      window.addEventListener('click', close as EventListener);
      window.addEventListener('keydown', close as EventListener);
    }, 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('click', close as EventListener);
      window.removeEventListener('keydown', close as EventListener);
    };
  }, [statusOpen]);

  // ── Save helpers ──
  const saveField = async (field: string, value: unknown) => {
    if (!detailTask) return;
    setSaveStatusTemp('saving');
    try {
      const r = await apiFetch(`/api/tasks/by-business/${bizId}/${detailTask.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (!r.ok) throw new Error('save_failed');
      setDetailTask(prev => prev ? { ...prev, [field]: value } as TaskDetail : prev);
      onPatch?.({ id: detailTask.id, [field]: value } as DrawerTaskPatch);
      setSaveStatusTemp('saved');
    } catch { setSaveStatusTemp('error'); }
  };
  const debouncedSave = (field: string, value: unknown, ms = 2000) => {
    if (!detailTask) return;
    const key = `${detailTask.id}:${field}`;
    if (debouncedRef.current[key]) window.clearTimeout(debouncedRef.current[key]);
    debouncedRef.current[key] = window.setTimeout(() => {
      saveField(field, value);
      delete debouncedRef.current[key];
    }, ms);
  };
  const flushDebounced = (field: string, value: unknown) => {
    if (!detailTask) return;
    const key = `${detailTask.id}:${field}`;
    if (debouncedRef.current[key]) {
      window.clearTimeout(debouncedRef.current[key]);
      delete debouncedRef.current[key];
    }
    saveField(field, value);
  };

  // 상태 변경 — progress+status 같이 쓰는 로직은 QTaskPage 와 동일
  const changeStatus = async (newStatus: string) => {
    if (!detailTask) return;
    setSaveStatusTemp('saving');
    try {
      await apiFetch(`/api/tasks/${detailTask.id}/time`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ progress_percent: newStatus === 'completed' ? 100 : undefined }),
      });
      await apiFetch(`/api/tasks/by-business/${bizId}/${detailTask.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      setDetailTask(prev => {
        if (!prev) return prev;
        const u: TaskDetail = { ...prev, status: newStatus };
        if (newStatus === 'completed') u.progress_percent = 100;
        return u;
      });
      onPatch?.({ id: detailTask.id, status: newStatus, progress_percent: newStatus === 'completed' ? 100 : undefined });
      setSaveStatusTemp('saved');
    } catch { setSaveStatusTemp('error'); }
  };

  // 워크플로우 액션 후 상세 + 워크플로우 리프레시.
  // 병렬 fetch → React 18 auto-batch 로 한 번의 리렌더에 두 state 모두 반영 → 액션 카드가
  // "사라졌다 나타나는" 깜빡임이 줄어든다.
  const refreshAfterAction = async () => {
    if (!detailTask) return;
    const id = detailTask.id;
    try {
      const [wfR, detailR] = await Promise.all([
        apiFetch(`/api/tasks/${id}/workflow`).then(r => r.json()),
        apiFetch(`/api/tasks/${id}/detail`).then(r => r.json()),
      ]);
      if (wfR.success) {
        setReviewers(wfR.data.reviewers || []);
        setHistory(wfR.data.history || []);
        setReviewPolicy(wfR.data.task?.review_policy || 'all');
      }
      if (detailR.success) setDetailTask(detailR.data);
    } catch { /* ignore */ }
    onRefresh?.();
  };
  const callAction = async (path: string, method: 'POST'|'DELETE'|'PATCH' = 'POST', body?: unknown) => {
    if (!detailTask || actionBusy) return;
    setActionBusy(true);
    try {
      const opts: RequestInit = { method };
      if (body) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
      const r = await (await apiFetch(`/api/tasks/${detailTask.id}${path}`, opts)).json();
      if (r.success) await refreshAfterAction();
      return r;
    } finally { setActionBusy(false); }
  };
  const actAck = () => callAction('/ack');
  const actSubmitReview = () => callAction('/submit-review');
  const actCancelReview = () => callAction('/cancel-review');
  const actComplete = () => callAction('/complete');
  const actApprove = () => callAction('/reviewers/me/approve');
  const actRevert = () => callAction('/reviewers/me/revert');
  const actStart = async () => {
    if (!detailTask || actionBusy) return;
    setActionBusy(true);
    try {
      await apiFetch(`/api/tasks/by-business/${bizId}/${detailTask.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in_progress' }),
      });
      await refreshAfterAction();
    } finally { setActionBusy(false); }
  };
  const submitRevision = async () => {
    const note = revisionNote.trim();
    if (!note) return;
    const r = await callAction('/reviewers/me/revision', 'POST', { note });
    if (r?.success) { setRevisionOpen(false); setRevisionNote(''); }
  };
  const addReviewer = async (userId: number) => {
    const inActiveRound = detailTask && (detailTask.status === 'reviewing' || detailTask.status === 'revision_requested');
    if (inActiveRound) { setPendingReviewerAdd(userId); return; }
    await callAction('/reviewers', 'POST', { user_id: userId });
    setAddReviewerOpen(false);
  };
  const confirmAddReviewer = async () => {
    if (!pendingReviewerAdd) return;
    await callAction('/reviewers', 'POST', { user_id: pendingReviewerAdd });
    setPendingReviewerAdd(null); setAddReviewerOpen(false);
  };
  const removeReviewer = async (userId: number) => { await callAction(`/reviewers/${userId}`, 'DELETE'); };
  const changePolicy = async (p: 'all'|'any') => {
    if (p === reviewPolicy) return;
    await callAction('/policy', 'PATCH', { review_policy: p });
  };

  const handleDelete = async () => {
    if (!detailTask || deleting) return;
    setDeleting(true);
    try {
      const r = await apiFetch(`/api/tasks/by-business/${bizId}/${detailTask.id}`, { method: 'DELETE' });
      const j = await r.json();
      if (!j.success) {
        setSaveStatusTemp('error');
        setDeleteConfirmOpen(false);
        return;
      }
      onRefresh?.();
      onClose();
    } catch {
      setSaveStatusTemp('error');
    } finally {
      setDeleting(false);
    }
  };

  const addComment = async () => {
    if (!detailTask || commentSending) return;
    if (!newComment.trim() && commentFiles.length === 0) return;
    setCommentSending(true);
    try {
      const content = newComment.trim() || '(첨부파일)';
      const r = await (await apiFetch(`/api/tasks/${detailTask.id}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })).json();
      if (!r.success) return;
      const comment = r.data;
      const attached: CommentAttach[] = [];
      for (const f of commentFiles) {
        const fd = new FormData();
        fd.append('file', f, f.name);
        const ur = await apiFetch(`/api/tasks/${detailTask.id}/attachments?context=comment&commentId=${comment.id}`, { method: 'POST', body: fd });
        const uj = await ur.json();
        if (uj.success) attached.push({ id: uj.data.id, original_name: uj.data.original_name, file_size: uj.data.file_size, mime_type: uj.data.mime_type });
      }
      setDetailTask(prev => prev ? { ...prev, comments: [...(prev.comments || []), { ...comment, attachments: attached }] } : prev);
      setNewComment(''); setCommentFiles([]);
    } finally { setCommentSending(false); }
  };

  const optionLabel = (status: string, role: string): string => {
    const task = detailTask; if (!task) return status;
    const isReq = task.source === 'internal_request' || task.source === 'qtalk_extract';
    if (status === 'not_started' && isReq && !task.request_ack_at) {
      return t(`status.task_requested.${role}`, t('status.task_requested.observer', '업무요청')) as string;
    }
    return t(`status.${status}.${role}`, t(`status.${status}.observer`, status)) as string;
  };

  return (<>
    <Backdrop onClick={onClose} />
    <Drawer ref={drawerRef} role="dialog" aria-modal="true" aria-label={detailTask?.title || 'task detail'} $w={localWidth} onMouseDown={(e) => e.stopPropagation()}>
      <ResizeHandle onMouseDown={startResize} />
      <DrawerHeader>
        <BackBtn onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          {t('detail.back', 'Back')}
        </BackBtn>
        <SaveStatusPill $status={saveStatus}>
          {saveStatus === 'saving' && <><PillSpinner/>{t('save.saving', '저장 중')}</>}
          {saveStatus === 'saved' && <>✓ {t('save.saved', '저장됨')}</>}
          {saveStatus === 'error' && <>! {t('save.error', '저장 실패')}</>}
        </SaveStatusPill>
        <CloseBtn onClick={onClose} title={t('detail.close', '닫기') as string}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </CloseBtn>
      </DrawerHeader>
      <Scroll>
        {!detailTask ? <Empty>Loading...</Empty> : (() => {
          const myRoles = getRoles({
            assignee_id: detailTask.assignee_id, created_by: detailTask.created_by,
            request_by_user_id: detailTask.request_by_user_id, reviewers: reviewers.map(rv => ({ user_id: rv.user_id })),
          }, myId);
          const iAmAssignee = myRoles.includes('assignee');
          const iAmReviewer = myRoles.includes('reviewer');
          const iAmRequesterOrOwner = myRoles.includes('requester');
          const myReviewer = reviewers.find(rv => rv.user_id === myId);
          const dStatus = displayStatus(detailTask, todayStr);
          const sc = STATUS_COLOR[dStatus];
          const role = primaryPerspective(myRoles);
          const statusLabel = getStatusLabel(detailTask, role, todayStr, (k, f) => t(k, f || '') as string);
          const ackAvailable = iAmAssignee && dStatus === 'task_requested';
          const resumeFromRevision = iAmAssignee && detailTask.status === 'revision_requested' && reviewers.length === 0;
          const startAvailable = iAmAssignee && !ackAvailable && (detailTask.status === 'not_started' || detailTask.status === 'waiting' || resumeFromRevision);
          const submitAvailable = iAmAssignee && reviewers.length > 0 && (detailTask.status === 'in_progress' || detailTask.status === 'revision_requested');
          const cancelReviewAvailable = iAmAssignee && detailTask.status === 'reviewing';
          const completeSimple = iAmAssignee && reviewers.length === 0 && detailTask.status === 'in_progress';
          const completeFinal = iAmAssignee && detailTask.status === 'done_feedback';
          const assigneeHasAction = ackAvailable || startAvailable || submitAvailable || cancelReviewAvailable || completeSimple || completeFinal || (detailTask.status === 'reviewing' && reviewers.length > 0 && reviewPolicy === 'all');
          const reviewerCanAct = iAmReviewer && (detailTask.status === 'reviewing' || detailTask.status === 'revision_requested');
          const approvedCount = reviewers.filter(rv => rv.state === 'approved').length;
          const canAddReviewer = iAmAssignee || iAmRequesterOrOwner;
          const memberOptions = members.filter(m => m.user_id !== detailTask.assignee_id && !reviewers.some(rv => rv.user_id === m.user_id));

          return (<>
            <Section>
              {editingTitle ? (
                <TitleInput autoFocus value={titleDraft}
                  onChange={e => setTitleDraft(e.target.value)}
                  onBlur={() => {
                    if (titleDraft.trim() && titleDraft.trim() !== detailTask.title) {
                      saveField('title', titleDraft.trim());
                    }
                    setEditingTitle(false);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
                    if (e.key === 'Escape') { setTitleDraft(''); setEditingTitle(false); }
                  }} />
              ) : (
                <Title role="button" tabIndex={0}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); setTitleDraft(detailTask.title); setEditingTitle(true); }}
                  title={t('detail.clickToEdit', '클릭하여 수정') as string}>
                  <TitleText>{detailTask.title}</TitleText>
                  <TitleEditIcon aria-hidden>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </TitleEditIcon>
                </Title>
              )}
              <Meta>
                <StatusBadgeWrap>
                  <StatusBadge as="button" $bg={sc.bg} $fg={sc.fg}
                    onClick={e => { e.stopPropagation(); setStatusOpen(v => !v); }}
                    title={t('list.statusHint', 'Click to change status') as string}>
                    {statusLabel} ▾
                  </StatusBadge>
                  {detailTask.review_round != null && detailTask.review_round > 0 &&
                    (detailTask.status === 'reviewing' || detailTask.status === 'revision_requested' || detailTask.status === 'done_feedback') &&
                    <RoundBadge title={t('detail.reviewers.roundTip', 'Review round') as string}>R{detailTask.review_round}</RoundBadge>}
                  {statusOpen && (
                    <StatusDropdown data-dropdown="status-detail">
                      {statusOptionsFor(detailTask).map(s => {
                        const c = STATUS_COLOR[s as StatusCode] || STATUS_COLOR.not_started;
                        return (
                          <StatusOption key={s} $bg={c.bg} $fg={c.fg} $active={detailTask.status === s}
                            onClick={async e => { e.stopPropagation(); setStatusOpen(false); await changeStatus(s); }}>
                            {optionLabel(s, role)}
                          </StatusOption>
                        );
                      })}
                    </StatusDropdown>
                  )}
                </StatusBadgeWrap>
                {detailTask.Project?.name && <ProjTag>{detailTask.Project.name}</ProjTag>}
                {(() => {
                  const isReq = detailTask.source === 'internal_request' || detailTask.source === 'qtalk_extract';
                  const reqUserId = detailTask.request_by_user_id ?? detailTask.created_by;
                  const reqName = detailTask.requester?.name || detailTask.creator?.name || '';
                  const asgName = detailTask.assignee?.name || '';
                  // 내가 받은 요청 → "{요청자}에게 요청받음" (from, 로즈)
                  if (detailTask.assignee_id === myId && isReq) {
                    return <DrawerNameChip $type="from" title={t('detail.chip.fromRequester', '요청자') as string}>
                      {reqName
                        ? t('detail.chip.fromLabel', '{{name}}에게 요청받음', { name: reqName })
                        : t('detail.chip.fromLabelAnon', '요청받음')}
                    </DrawerNameChip>;
                  }
                  // 내가 보낸 요청 → "{담당자}에게 요청함" (to, 티일)
                  if ((reqUserId === myId) && detailTask.assignee_id != null && detailTask.assignee_id !== myId) {
                    return <DrawerNameChip $type="to" title={t('detail.chip.toAssignee', '담당자') as string}>
                      {asgName
                        ? t('detail.chip.toLabel', '{{name}}에게 요청함', { name: asgName })
                        : t('detail.chip.toLabelAnon', '요청함')}
                    </DrawerNameChip>;
                  }
                  // 내가 담당자 (본인 업무, 요청 아님)
                  if (detailTask.assignee_id === myId) {
                    return <DrawerNameChip $type="mine" title={t('detail.chip.mine', '내 업무') as string}>
                      {t('detail.chip.mine', '내 업무')}
                    </DrawerNameChip>;
                  }
                  // 타인 담당 (관찰자 관점)
                  if (asgName) {
                    return <DrawerNameChip $type="observer" title={t('detail.chip.assignee', '담당자') as string}>
                      {t('detail.chip.assigneePrefix', '담당')} · {asgName}
                    </DrawerNameChip>;
                  }
                  return null;
                })()}
              </Meta>
              <MetaGrid>
                <MetaCell>
                  <MetaLabel>{t('detail.meta.period', '기간')}</MetaLabel>
                  <DateRangeCell start={detailTask.start_date} due={detailTask.due_date}
                    onSave={(s, d) => {
                      saveField('start_date', s);
                      saveField('due_date', d);
                    }} />
                </MetaCell>
                <MetaCell>
                  <MetaLabel>{t('detail.meta.est', '예측')}</MetaLabel>
                  <MetaHourRow>
                    <MetaNumInput defaultValue={detailTask.estimated_hours ?? ''} placeholder="-"
                      onBlur={e => { const v = e.target.value === '' ? null : Number(e.target.value); if (v === null || !isNaN(v)) saveField('estimated_hours', v); }} />
                    <MetaUnit>h</MetaUnit>
                  </MetaHourRow>
                </MetaCell>
                <MetaCell>
                  <MetaLabel>{t('detail.meta.act', '실제')}</MetaLabel>
                  <MetaHourRow>
                    <MetaNumInput defaultValue={detailTask.actual_hours ?? ''} placeholder="-"
                      onBlur={e => { const v = e.target.value === '' ? null : Number(e.target.value); if (v === null || !isNaN(v)) saveField('actual_hours', v); }} />
                    <MetaUnit>h</MetaUnit>
                  </MetaHourRow>
                </MetaCell>
                <MetaCell>
                  <MetaLabel>{t('detail.meta.progress', '진행')}</MetaLabel>
                  <MetaProgressRow>
                    <MetaRangeInput type="range" min="0" max="100" step="5" value={detailTask.progress_percent || 0}
                      style={{ '--pq-fill': `${detailTask.progress_percent || 0}%` } as React.CSSProperties}
                      onChange={e => { const v = Number(e.target.value); setDetailTask(prev => prev ? { ...prev, progress_percent: v } : prev); }}
                      onMouseUp={e => saveField('progress_percent', Number((e.target as HTMLInputElement).value))}
                      onTouchEnd={e => saveField('progress_percent', Number((e.target as HTMLInputElement).value))} />
                    <MetaProgressPct>{detailTask.progress_percent || 0}%</MetaProgressPct>
                  </MetaProgressRow>
                </MetaCell>
              </MetaGrid>
            </Section>

            {/* 액션 섹션 — 항상 마운트 유지 (상태 전환 시 섹션 자체가 사라지며 생기는 깜빡임 방지) */}
            <Section style={{ display: (assigneeHasAction || reviewerCanAct) ? 'block' : 'none' }}>
              {assigneeHasAction && <ActionCard>
                <ActionCardTitle>{t('detail.actions.assigneeTitle', 'As assignee')}</ActionCardTitle>
                {ackAvailable && <ActionPrimary onClick={actAck} disabled={actionBusy}>{t('detail.actions.ack', 'Acknowledge request')}</ActionPrimary>}
                {startAvailable && <ActionPrimary onClick={actStart} disabled={actionBusy}>{resumeFromRevision ? t('detail.actions.resume', 'Resume work') : t('detail.actions.start', 'Start working')}</ActionPrimary>}
                {submitAvailable && <ActionPrimary onClick={actSubmitReview} disabled={actionBusy}>{detailTask.status === 'revision_requested' ? t('detail.actions.resubmitReview', 'Resubmit after revision') : t('detail.actions.submitReview', 'Submit for review')}</ActionPrimary>}
                {cancelReviewAvailable && <ActionSecondary onClick={actCancelReview} disabled={actionBusy}>{t('detail.actions.cancelReview', 'Cancel review request')}</ActionSecondary>}
                {completeSimple && <ActionPrimary onClick={actComplete} disabled={actionBusy}>{t('detail.actions.completeSimple', 'Mark complete')}</ActionPrimary>}
                {completeFinal && <ActionPrimary onClick={actComplete} disabled={actionBusy}>{t('detail.actions.complete', 'Finalize')}</ActionPrimary>}
                {detailTask.status === 'reviewing' && reviewers.length > 0 && reviewPolicy === 'all' && <ActionHint>
                  <ReviewProgressTrack><ReviewProgressFill $w={(approvedCount / reviewers.length) * 100}/></ReviewProgressTrack>
                  <ReviewProgressText>{t('detail.actions.approvedOf', '{{n}} of {{total}} approved', { n: approvedCount, total: reviewers.length })}</ReviewProgressText>
                </ActionHint>}
              </ActionCard>}
              {reviewerCanAct && <ActionCard>
                <ActionCardTitle>{t('detail.actions.reviewerTitle', 'My actions (reviewer)')}</ActionCardTitle>
                {myReviewer?.state === 'pending' && <>
                  <ActionPrimary onClick={actApprove} disabled={actionBusy}>{t('detail.actions.approve', 'Approve')}</ActionPrimary>
                  {revisionOpen ? (
                    <RevisionForm>
                      <RevisionInput placeholder={t('detail.actions.revisionPlaceholder', 'What needs to change? (required)')}
                        value={revisionNote} onChange={e => setRevisionNote(e.target.value)} autoFocus />
                      <RevisionRow>
                        <ActionSecondary onClick={() => { setRevisionOpen(false); setRevisionNote(''); }}>{t('common.cancel', 'Cancel')}</ActionSecondary>
                        <ActionDanger onClick={submitRevision} disabled={actionBusy || !revisionNote.trim()}>{t('detail.actions.submitRevision', 'Send revision')}</ActionDanger>
                      </RevisionRow>
                    </RevisionForm>
                  ) : (
                    <ActionDanger onClick={() => setRevisionOpen(true)} disabled={actionBusy}>{t('detail.actions.requestRevision', 'Request revision')}</ActionDanger>
                  )}
                </>}
                {myReviewer && myReviewer.state !== 'pending' && <ActionHintRow>
                  <span>{myReviewer.state === 'approved' ? t('detail.actions.youApproved', 'You approved this round.') : t('detail.actions.youRequestedRevision', 'You requested revision.')}</span>
                  {!myReviewer.reverted_once && <TextLink onClick={actRevert} disabled={actionBusy}>{t('detail.actions.revert', 'Undo my decision')}</TextLink>}
                  {myReviewer.reverted_once && <MutedText title={t('detail.actions.revertUsed', 'You already used revert this round.') as string}>{t('detail.actions.revertDisabled', 'Revert used')}</MutedText>}
                </ActionHintRow>}
              </ActionCard>}
            </Section>

            <Section>
              <SectionTitle>{t('detail.description', '업무 설명')}</SectionTitle>
              <DescTextarea defaultValue={detailTask.description || ''}
                placeholder={t('detail.descPlaceholder', '이 업무에 대한 간단한 설명 (한두 줄)')}
                onChange={e => debouncedSave('description', e.target.value, 2000)}
                onBlur={e => flushDebounced('description', e.target.value)} />
            </Section>

            <Section>
              <SectionTitle>{t('detail.comments', 'Comments')} ({detailTask.comments?.length || 0})</SectionTitle>
              {(detailTask.comments || []).map(c => (
                <CommentItem key={c.id}>
                  <CommentHead><strong>{c.author?.name}</strong><span>{c.createdAt?.slice(5, 16).replace('T', ' ')}</span></CommentHead>
                  {c.content && c.content !== '(첨부파일)' && <CommentBody>{c.content}</CommentBody>}
                  {(c.attachments || []).length > 0 && <CmtAtts>
                    {(c.attachments || []).map(a => {
                      const isImg = a.mime_type?.startsWith('image/');
                      const preview = (isImg && a.stored_name) ? `/api/tasks/public/attach/${a.stored_name}` : null;
                      const dl = `/api/tasks/attachments/${a.id}/download`;
                      return isImg && preview ? (
                        <a key={a.id} href={dl} onClick={e => { e.preventDefault(); window.open(dl, '_blank'); }}>
                          <CmtAttImg src={preview} alt={a.original_name}/>
                        </a>
                      ) : (
                        <CmtAttFile key={a.id} href={dl} onClick={e => { e.preventDefault(); window.open(dl, '_blank'); }}>
                          <CmtAttIcon>{a.original_name.split('.').pop()?.slice(0, 3).toUpperCase() || 'FILE'}</CmtAttIcon>
                          <CmtAttName>{a.original_name}</CmtAttName>
                        </CmtAttFile>
                      );
                    })}
                  </CmtAtts>}
                </CommentItem>
              ))}
              <CommentComposer>
                <CommentInput value={newComment} placeholder={t('detail.writeComment', 'Write a comment...')}
                  onChange={e => setNewComment(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addComment(); } }} />
                {commentFiles.length > 0 && <CmtStagedRow>
                  {commentFiles.map((f, i) => (
                    <CmtStaged key={i}>
                      {f.name}
                      <CmtStagedX type="button" onClick={() => setCommentFiles(prev => prev.filter((_, j) => j !== i))}>×</CmtStagedX>
                    </CmtStaged>
                  ))}
                </CmtStagedRow>}
                <CmtComposerRow>
                  <CmtAttachBtn type="button" title={t('detail.attachFile', '파일 첨부') as string}
                    onClick={() => { const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.onchange = () => { if (i.files) setCommentFiles(prev => [...prev, ...Array.from(i.files!)]); }; i.click(); }}>
                    📎
                  </CmtAttachBtn>
                  <CommentSend onClick={addComment} disabled={commentSending || (!newComment.trim() && commentFiles.length === 0)}>
                    {commentSending ? t('detail.sending', '전송 중...') : t('detail.send', 'Send')}
                  </CommentSend>
                </CmtComposerRow>
              </CommentComposer>
            </Section>

            <Section>
              <SectionTitle>{t('detail.body', '결과물')}</SectionTitle>
              <RichEditor value={detailTask.body || ''}
                onChange={(html) => debouncedSave('body', html, 2000)}
                onBlur={(html) => flushDebounced('body', html)}
                placeholder={t('detail.bodyPlaceholder', '업무 결과물을 작성하세요.  / 입력 시 블록 추가')}
                uploadUrl={`/api/tasks/${detailTask.id}/attachments?context=description`}
                minHeight={260} />
            </Section>

            <TaskAttachments taskId={detailTask.id} onChangeCount={() => {}} />

            <Collapsible>
              <ColHeader onClick={() => setOpenReviewers(v => !v)}>
                <ColArrow $open={openReviewers}>▸</ColArrow>
                <span>{t('detail.reviewers.title', 'Reviewers')} ({reviewers.length})</span>
              </ColHeader>
              {openReviewers && <ColBody>
                {canAddReviewer && reviewers.length > 1 && <PolicySeg>
                  <PolicySegBtn $active={reviewPolicy === 'all'} onClick={() => changePolicy('all')} disabled={actionBusy}>{t('detail.reviewers.policyAll', 'All must approve')}</PolicySegBtn>
                  <PolicySegBtn $active={reviewPolicy === 'any'} onClick={() => changePolicy('any')} disabled={actionBusy}>{t('detail.reviewers.policyAny', 'Any one is enough')}</PolicySegBtn>
                </PolicySeg>}
                {reviewers.length === 0 ? <Empty>{t('detail.reviewers.empty', 'No reviewers yet')}</Empty> : (
                  <ReviewerList>
                    {reviewers.map(rv => (
                      <ReviewerRowE key={rv.id}>
                        <ReviewerName>{rv.user?.name || `user ${rv.user_id}`}</ReviewerName>
                        <ReviewerState $state={rv.state}>{t(`detail.reviewers.state.${rv.state}`, rv.state)}</ReviewerState>
                        {canAddReviewer && <ReviewerRemove onClick={() => removeReviewer(rv.user_id)} disabled={actionBusy} title={t('detail.reviewers.remove', 'Remove') as string}>×</ReviewerRemove>}
                      </ReviewerRowE>
                    ))}
                  </ReviewerList>
                )}
                {canAddReviewer && (addReviewerOpen ? (
                  <AddReviewerBox>
                    {memberOptions.length === 0 ? <MutedText>{t('detail.reviewers.noCandidates', 'No members to add')}</MutedText> : (
                      <AddReviewerList>
                        {memberOptions.map(m => (
                          <AddReviewerItem key={m.user_id} onClick={() => addReviewer(m.user_id)} disabled={actionBusy}>{m.name}</AddReviewerItem>
                        ))}
                      </AddReviewerList>
                    )}
                    <ActionSecondary onClick={() => setAddReviewerOpen(false)}>{t('common.cancel', 'Cancel')}</ActionSecondary>
                  </AddReviewerBox>
                ) : (
                  <ActionSecondary onClick={() => setAddReviewerOpen(true)} disabled={actionBusy}>+ {t('detail.reviewers.add', 'Add reviewer')}</ActionSecondary>
                ))}
                {pendingReviewerAdd && <WarnDialog>
                  <WarnTitle>{t('detail.reviewers.warnTitle', 'Reset current review round?')}</WarnTitle>
                  <WarnBody>{t('detail.reviewers.warnBody', 'Adding a reviewer during an active round resets all reviewers to pending. Previous approvals will need to be re-confirmed.')}</WarnBody>
                  <WarnRow>
                    <ActionSecondary onClick={() => setPendingReviewerAdd(null)}>{t('common.cancel', 'Cancel')}</ActionSecondary>
                    <ActionPrimary onClick={confirmAddReviewer} disabled={actionBusy}>{t('detail.reviewers.warnConfirm', 'Add and reset')}</ActionPrimary>
                  </WarnRow>
                </WarnDialog>}
              </ColBody>}
            </Collapsible>

            {history.length > 0 && <Collapsible>
              <ColHeader onClick={() => setOpenHistory(v => !v)}>
                <ColArrow $open={openHistory}>▸</ColArrow>
                <span>{t('detail.history.title', 'History')} ({history.length})</span>
              </ColHeader>
              {openHistory && <ColBody>
                <Timeline>
                  {history.map(h => (
                    <TimelineItem key={h.id}>
                      <TimelineDot $event={h.event_type}/>
                      <TimelineBody>
                        <TimelineHead>
                          <strong>{h.actor?.name || '—'}</strong>
                          <TimelineEvent>{t(`detail.history.event.${h.event_type}`, h.event_type)}</TimelineEvent>
                          {h.target?.name && <TimelineTarget>→ {h.target.name}</TimelineTarget>}
                          {h.round != null && <TimelineRound>R{h.round}</TimelineRound>}
                        </TimelineHead>
                        {h.note && <TimelineNote>{h.note}</TimelineNote>}
                        <TimelineTime>{h.createdAt?.slice(5, 16).replace('T', ' ')}</TimelineTime>
                      </TimelineBody>
                    </TimelineItem>
                  ))}
                </Timeline>
              </ColBody>}
            </Collapsible>}

            <Collapsible>
              <ColHeader onClick={() => setOpenDaily(v => !v)}>
                <ColArrow $open={openDaily}>▸</ColArrow>
                <span>{t('detail.dailyLog', 'Daily Log')} ({(detailTask.daily_progress || []).length})</span>
              </ColHeader>
              {openDaily && <ColBody>
                {(detailTask.daily_progress || []).length === 0 ? <Empty>{t('detail.noLog', 'No records yet')}</Empty> : (
                  <DailyGrid>
                    <DailyHead>
                      <span>{t('detail.date', 'Date')}</span>
                      <span>{t('detail.prog', '%')}</span>
                      <span>{t('detail.estUsed', 'Est used')}</span>
                      <span>{t('detail.actUsed', 'Act used')}</span>
                    </DailyHead>
                    {(detailTask.daily_progress || []).map(dp => {
                      const prog = (dp.progress_percent || 0) / 100;
                      const est = Number(dp.estimated_hours) || 0;
                      const act = Number(dp.actual_hours) || 0;
                      return (
                        <DailyRow key={dp.snapshot_date}>
                          <span>{dp.snapshot_date.slice(0, 10).slice(5).replace('-', '/')}</span>
                          <span>{dp.progress_percent || 0}%</span>
                          <span>{(est * prog).toFixed(1)}h</span>
                          <span>{(act * prog).toFixed(1)}h</span>
                        </DailyRow>
                      );
                    })}
                  </DailyGrid>
                )}
              </ColBody>}
            </Collapsible>

            {(() => {
              const isAdmin = hasRole('platform_admin', 'business_owner');
              const isMine = detailTask.created_by === myId
                || detailTask.assignee_id === myId
                || detailTask.request_by_user_id === myId;
              if (!isAdmin && !isMine) return null;
              return (
                <DangerSection>
                  {!deleteConfirmOpen ? (
                    <ActionDanger onClick={() => setDeleteConfirmOpen(true)} disabled={deleting}>
                      {t('detail.delete.button', '업무 삭제')}
                    </ActionDanger>
                  ) : (
                    <DangerConfirm>
                      <DangerTitle>{t('detail.delete.confirmTitle', '정말 삭제하시겠습니까?')}</DangerTitle>
                      <DangerBody>{t('detail.delete.confirmBody', '삭제된 업무는 복구할 수 없습니다. 댓글·첨부·이력도 함께 사라집니다.')}</DangerBody>
                      <DangerRow>
                        <ActionSecondary onClick={() => setDeleteConfirmOpen(false)} disabled={deleting}>
                          {t('common.cancel', '취소')}
                        </ActionSecondary>
                        <ActionDanger onClick={handleDelete} disabled={deleting}>
                          {deleting ? t('detail.delete.deleting', '삭제 중...') : t('detail.delete.confirm', '삭제')}
                        </ActionDanger>
                      </DangerRow>
                    </DangerConfirm>
                  )}
                </DangerSection>
              );
            })()}
          </>);
        })()}
      </Scroll>
    </Drawer>
  </>);
};

export default TaskDetailDrawer;

// ─── DateRangeCell (로컬) ───
const DateRangeCell: React.FC<{
  start: string | null | undefined;
  due: string | null | undefined;
  onSave: (start: string | null, due: string | null) => void;
}> = ({ start, due, onSave }) => {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const s = start?.slice(0, 10) || '';
  const d = due?.slice(0, 10) || '';
  const fmt = (v: string) => v ? v.slice(5).replace('-', '/') : '';
  const label = s && d ? (s === d ? fmt(d) : `${fmt(s)} ~ ${fmt(d)}`) : d ? fmt(d) : s ? fmt(s) : '-';
  const hasValue = !!(s || d);
  return (<>
    <DateTrigger ref={anchor} $empty={!hasValue} onClick={e => { e.stopPropagation(); setOpen(v => !v); }}>{label}</DateTrigger>
    {open && <CalendarPicker isOpen={open} startDate={s || d} endDate={d || s} anchorRef={anchor}
      onRangeSelect={(a, b) => { onSave(a || null, b || null); }} onClose={() => setOpen(false)} />}
  </>);
};

// ─── styled ───
const Backdrop = styled.div`
  position:fixed;inset:0;background:rgba(15, 23, 42, 0.08);
  z-index:39;
  animation:pqFadeIn 0.22s ease-out;
  @keyframes pqFadeIn{from{opacity:0;}to{opacity:1;}}
  @media (prefers-reduced-motion: reduce){animation:none;}
`;
const Drawer = styled.aside<{ $w: number }>`
  position:fixed;top:0;right:0;bottom:0;
  width:min(${p => p.$w}px, calc(100vw - 56px));
  background:#FFF;border-left:1px solid #E2E8F0;
  box-shadow:-16px 0 40px rgba(15,23,42,0.14);display:flex;flex-direction:column;overflow:hidden;z-index:40;
  animation:pqSlideIn 0.28s cubic-bezier(0.22,1,0.36,1);
  @keyframes pqSlideIn{from{transform:translateX(100%);}to{transform:translateX(0);}}
  padding-bottom:env(safe-area-inset-bottom,0px);
  @media (prefers-reduced-motion: reduce){animation:none;}
`;
const ResizeHandle = styled.div`
  position:absolute;top:0;left:-4px;width:8px;height:100%;cursor:col-resize;z-index:45;
  &:hover{background:rgba(20,184,166,0.25);}&:active{background:rgba(20,184,166,0.45);}
  @media (max-width: 1024px) { display: none; }
`;
const DrawerHeader = styled.div`height:60px;padding:14px 20px;border-bottom:1px solid #E2E8F0;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;`;
const BackBtn = styled.button`display:flex;align-items:center;gap:4px;background:transparent;border:none;color:#0F766E;font-size:12px;font-weight:600;cursor:pointer;padding:0;outline:none;&:hover{color:#134E4A;}&:focus{outline:none;}&:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;border-radius:4px;}`;
const CloseBtn = styled.button`width:28px;height:28px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;border-radius:6px;color:#64748B;cursor:pointer;outline:none;&:hover{background:#F1F5F9;color:#0F172A;}&:focus{outline:none;}&:focus-visible{outline:2px solid #14B8A6;outline-offset:-2px;}`;
const SaveStatusPill = styled.span<{ $status: 'idle'|'saving'|'saved'|'error' }>`
  display:inline-flex;align-items:center;gap:4px;margin-left:auto;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:600;
  opacity:${p => p.$status === 'idle' ? 0 : 1};transition:opacity 0.2s;
  ${p => p.$status === 'saving' ? 'background:#F0FDFA;color:#0F766E;' : ''}
  ${p => p.$status === 'saved' ? 'background:#D1FAE5;color:#065F46;' : ''}
  ${p => p.$status === 'error' ? 'background:#FEE2E2;color:#991B1B;' : ''}
`;
const PillSpinner = styled.span`
  width:10px;height:10px;border:1.5px solid #14B8A6;border-top-color:transparent;border-radius:50%;
  animation:pqspin 0.7s linear infinite;
  @keyframes pqspin{to{transform:rotate(360deg);}}
`;
const Scroll = styled.div`flex:1;overflow-y:auto;overflow-x:hidden;min-width:0;&>*{min-width:0;max-width:100%;}&::-webkit-scrollbar{width:6px;}&::-webkit-scrollbar-thumb{background:#E2E8F0;border-radius:3px;}`;
const Section = styled.div`border-bottom:1px solid #F1F5F9;padding:12px 14px;`;
const SectionTitle = styled.h4`font-size:12px;font-weight:700;color:#0F172A;margin:0 0 8px;`;
const Title = styled.h3`font-size:19px;font-weight:700;color:#0F172A;margin:0 0 8px;line-height:1.35;cursor:pointer;border-radius:6px;padding:4px 6px;margin-left:-6px;transition:background 0.12s;display:flex;align-items:center;gap:8px;&:hover{background:#F1F5F9;}&:hover > span:last-child{opacity:1;}&:focus{outline:none;}&:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;}`;
const TitleText = styled.span`flex:1;min-width:0;`;
const TitleEditIcon = styled.span`display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:6px;color:#94A3B8;opacity:0;transition:opacity 0.15s, background 0.12s;flex-shrink:0;`;
const TitleInput = styled.input`font-size:19px;font-weight:700;color:#0F172A;line-height:1.35;width:100%;padding:4px 8px;margin-left:-6px;margin-bottom:8px;border:1px solid #14B8A6;border-radius:6px;background:#FFF;font-family:inherit;&:focus{outline:none;box-shadow:0 0 0 2px rgba(20,184,166,0.15);}`;
const Meta = styled.div`display:flex;align-items:center;gap:6px;font-size:11px;color:#64748B;flex-wrap:wrap;`;
const StatusBadgeWrap = styled.span`position:relative;display:inline-flex;align-items:center;gap:4px;`;
const StatusBadge = styled.span<{ $bg: string; $fg: string }>`display:inline-flex;align-items:center;gap:2px;padding:3px 10px;font-size:11px;font-weight:700;background:${p => p.$bg};color:${p => p.$fg};border:none;border-radius:10px;cursor:pointer;user-select:none;&:hover{filter:brightness(0.95);}`;
const RoundBadge = styled.span`display:inline-flex;align-items:center;padding:2px 6px;font-size:10px;font-weight:800;color:#92400E;background:#FEF3C7;border-radius:6px;letter-spacing:0.3px;`;
const StatusDropdown = styled.div`
  position:absolute;top:100%;left:0;z-index:100;background:#FFF;border:1px solid #E2E8F0;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.12);padding:4px;min-width:140px;margin-top:4px;
`;
const StatusOption = styled.button<{ $bg: string; $fg: string; $active?: boolean }>`
  display:block;width:100%;padding:5px 10px;font-size:11px;font-weight:600;text-align:left;border:none;border-radius:6px;cursor:pointer;
  background:${p => p.$active ? p.$bg : 'transparent'};color:${p => p.$fg};&:hover{background:${p => p.$bg};}
`;
const ProjTag = styled.span`padding:1px 5px;background:#F1F5F9;color:#64748B;font-size:9px;font-weight:600;border-radius:4px;`;
const DrawerNameChip = styled.span<{ $type: 'from' | 'to' | 'observer' | 'mine' }>`
  display:inline-flex;align-items:center;padding:2px 8px;font-size:11px;font-weight:600;
  border-radius:10px;white-space:nowrap;max-width:220px;overflow:hidden;text-overflow:ellipsis;
  ${p => p.$type === 'from' ? 'color:#BE123C;background:#FFE4E6;'
    : p.$type === 'to' ? 'color:#0F766E;background:#CCFBF1;'
    : p.$type === 'mine' ? 'color:#0F766E;background:#F0FDFA;'
    : 'color:#64748B;background:#F1F5F9;'}
`;
const MetaGrid = styled.div`display:grid;grid-template-columns:1.6fr 1fr 1fr 2fr;gap:10px;margin-top:12px;padding-top:12px;border-top:1px solid #F1F5F9;`;
const MetaCell = styled.div`display:flex;flex-direction:column;gap:3px;min-width:0;`;
const MetaLabel = styled.span`font-size:10px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:0.3px;`;
const MetaNumInput = styled.input.attrs({ type: 'number', step: '0.5', min: '0' })`width:48px;font-size:13px;color:#0F172A;border:1px solid #E2E8F0;border-radius:5px;padding:3px 5px;font-family:inherit;&:focus{outline:none;border-color:#14B8A6;}`;
const MetaUnit = styled.span`font-size:11px;color:#94A3B8;`;
const MetaHourRow = styled.div`display:flex;align-items:center;gap:4px;`;
const MetaProgressRow = styled.div`display:flex;align-items:center;gap:8px;`;
const MetaProgressPct = styled.span`font-size:11px;color:#475569;font-weight:600;min-width:32px;text-align:right;`;
const MetaRangeInput = styled.input`
  flex:1;appearance:none;-webkit-appearance:none;height:8px;border-radius:4px;
  background:linear-gradient(to right,#14B8A6 0%,#14B8A6 var(--pq-fill,0%),#F1F5F9 var(--pq-fill,0%),#F1F5F9 100%);
  outline:none;cursor:pointer;margin:0;padding:0;
  &::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;border-radius:50%;background:#FFF;border:2px solid #14B8A6;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,0.1);}
  &::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#FFF;border:2px solid #14B8A6;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,0.1);}
  &::-moz-range-track{background:transparent;}
`;
const DateTrigger = styled.button<{ $empty?: boolean }>`
  width:100%;padding:4px 6px;font-size:12px;font-weight:600;background:transparent;border:1px solid transparent;border-radius:6px;cursor:pointer;
  white-space:nowrap;font-family:inherit;text-align:left;
  color:${p => p.$empty ? '#CBD5E1' : '#64748B'};
  &:hover{border-color:#14B8A6;color:#0F766E;}
`;
const DescTextarea = styled.textarea`width:100%;min-height:46px;max-height:120px;padding:8px 10px;border:1px solid #E2E8F0;border-radius:8px;font-size:13px;color:#0F172A;background:#FAFBFC;font-family:inherit;resize:vertical;line-height:1.5;&:focus{outline:none;border-color:#14B8A6;background:#FFF;}&::placeholder{color:#94A3B8;}`;

// Actions
const ActionCard = styled.div`background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:8px;& + &{margin-top:8px;}
  transition:opacity 0.18s ease-out;
  & > button{transition:background 0.15s, color 0.15s, border-color 0.15s;}
`;
const ActionCardTitle = styled.div`font-size:10px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.3px;`;
const ActionPrimary = styled.button`padding:8px 12px;background:#14B8A6;color:#FFF;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;transition:background 0.15s;&:disabled{background:#CBD5E1;cursor:not-allowed;}&:hover:not(:disabled){background:#0D9488;}`;
const ActionSecondary = styled.button`padding:7px 12px;background:#FFF;color:#334155;border:1px solid #CBD5E1;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;&:disabled{color:#CBD5E1;cursor:not-allowed;}&:hover:not(:disabled){border-color:#94A3B8;background:#F8FAFC;}`;
const ActionDanger = styled.button`padding:7px 12px;background:#FFF;color:#DC2626;border:1px solid #FECACA;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;&:disabled{color:#CBD5E1;border-color:#E2E8F0;cursor:not-allowed;}&:hover:not(:disabled){background:#FEF2F2;border-color:#DC2626;}`;
const ActionHint = styled.div`display:flex;flex-direction:column;gap:4px;`;
const ActionHintRow = styled.div`display:flex;align-items:center;gap:8px;font-size:12px;color:#475569;flex-wrap:wrap;`;
const TextLink = styled.button`background:transparent;border:none;color:#0F766E;font-size:12px;font-weight:600;cursor:pointer;padding:0;text-decoration:underline;&:disabled{color:#CBD5E1;cursor:not-allowed;}&:hover:not(:disabled){color:#134E4A;}`;
const MutedText = styled.span`font-size:11px;color:#94A3B8;`;
const ReviewProgressTrack = styled.div`height:6px;background:#E2E8F0;border-radius:999px;overflow:hidden;`;
const ReviewProgressFill = styled.div<{ $w: number }>`height:100%;background:linear-gradient(90deg,#14B8A6,#0D9488);width:${p => p.$w}%;transition:width 0.25s;`;
const ReviewProgressText = styled.div`font-size:11px;color:#475569;font-weight:600;`;
const RevisionForm = styled.div`display:flex;flex-direction:column;gap:6px;padding:8px;background:#FFF;border:1px solid #F43F5E;border-radius:8px;`;
const RevisionInput = styled.textarea`width:100%;min-height:60px;padding:6px 8px;border:1px solid #E2E8F0;border-radius:6px;font-size:12px;color:#0F172A;resize:vertical;font-family:inherit;&:focus{outline:none;border-color:#F43F5E;}`;
const RevisionRow = styled.div`display:flex;gap:6px;justify-content:flex-end;`;

// Comments
const CommentItem = styled.div`padding:8px 10px;background:#F8FAFC;border-radius:8px;& + &{margin-top:6px;}`;
const CommentHead = styled.div`display:flex;gap:8px;align-items:baseline;font-size:11px;color:#64748B;margin-bottom:3px;& strong{color:#0F172A;font-weight:600;}`;
const CommentBody = styled.div`font-size:12px;color:#1E293B;line-height:1.4;white-space:pre-wrap;`;
const CommentComposer = styled.div`display:flex;flex-direction:column;gap:6px;margin-top:8px;`;
const CmtComposerRow = styled.div`display:flex;justify-content:flex-end;gap:6px;align-items:center;`;
const CommentInput = styled.textarea`width:100%;padding:6px 10px;border:1px solid #E2E8F0;border-radius:8px;font-size:12px;color:#0F172A;font-family:inherit;resize:vertical;min-height:40px;max-height:120px;&:focus{outline:none;border-color:#14B8A6;}&::placeholder{color:#94A3B8;}`;
const CommentSend = styled.button`padding:6px 14px;background:#14B8A6;color:#FFF;border:none;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;&:disabled{background:#CBD5E1;cursor:not-allowed;}&:hover:not(:disabled){background:#0D9488;}`;
const CmtAttachBtn = styled.button`width:32px;height:28px;display:flex;align-items:center;justify-content:center;background:transparent;border:1px solid #E2E8F0;border-radius:6px;cursor:pointer;font-size:14px;&:hover{border-color:#14B8A6;background:#F0FDFA;}`;
const CmtStagedRow = styled.div`display:flex;flex-wrap:wrap;gap:4px;`;
const CmtStaged = styled.span`display:inline-flex;align-items:center;gap:4px;padding:2px 6px 2px 8px;background:#F0FDFA;color:#0F766E;border:1px solid #99F6E4;border-radius:12px;font-size:11px;`;
const CmtStagedX = styled.button`width:16px;height:16px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;color:#0F766E;cursor:pointer;font-size:14px;line-height:1;&:hover{color:#DC2626;}`;
const CmtAtts = styled.div`display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;`;
const CmtAttImg = styled.img`max-width:160px;max-height:120px;object-fit:cover;border-radius:6px;border:1px solid #E2E8F0;cursor:pointer;`;
const CmtAttFile = styled.a`display:inline-flex;align-items:center;gap:6px;padding:4px 8px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;text-decoration:none;color:#0F172A;font-size:11px;max-width:200px;&:hover{border-color:#14B8A6;background:#F0FDFA;color:#0F766E;}`;
const CmtAttIcon = styled.span`width:22px;height:22px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:#E2E8F0;color:#475569;font-size:9px;font-weight:700;border-radius:3px;`;
const CmtAttName = styled.span`overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;

// Reviewers
const Collapsible = styled.div`padding:10px 20px;border-bottom:1px solid #F1F5F9;`;
const ColHeader = styled.button`display:flex;align-items:center;gap:8px;width:100%;padding:6px 0;background:transparent;border:none;font-size:12px;font-weight:700;color:#64748B;cursor:pointer;text-align:left;&:hover{color:#0F172A;}`;
const ColArrow = styled.span<{ $open: boolean }>`display:inline-block;font-size:10px;color:#94A3B8;transition:transform 0.15s;transform:rotate(${p => p.$open ? '90deg' : '0deg'});`;
const ColBody = styled.div`padding:8px 0 4px 0;`;
const PolicySeg = styled.div`display:inline-flex;background:#F1F5F9;border-radius:6px;padding:2px;margin-bottom:6px;`;
const PolicySegBtn = styled.button<{ $active: boolean }>`padding:3px 10px;font-size:11px;font-weight:600;border:none;border-radius:4px;cursor:pointer;background:${p => p.$active ? '#FFF' : 'transparent'};color:${p => p.$active ? '#0F766E' : '#64748B'};box-shadow:${p => p.$active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none'};&:disabled{cursor:not-allowed;opacity:0.5;}`;
const ReviewerList = styled.div`display:flex;flex-direction:column;gap:4px;margin-bottom:6px;`;
const ReviewerRowE = styled.div`display:flex;align-items:center;gap:8px;padding:6px 8px;background:#FFF;border:1px solid #E2E8F0;border-radius:6px;`;
const ReviewerName = styled.span`flex:1;font-size:12px;color:#0F172A;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
const ReviewerState = styled.span<{ $state: string }>`padding:1px 6px;font-size:10px;font-weight:700;border-radius:4px;${p => p.$state === 'approved' ? 'background:#D1FAE5;color:#065F46;' : ''}${p => p.$state === 'revision' ? 'background:#FCE7F3;color:#9F1239;' : ''}${p => p.$state === 'pending' ? 'background:#F1F5F9;color:#64748B;' : ''}`;
const ReviewerRemove = styled.button`width:20px;height:20px;display:flex;align-items:center;justify-content:center;border:none;background:transparent;color:#94A3B8;border-radius:4px;cursor:pointer;font-size:14px;&:hover:not(:disabled){background:#FEE2E2;color:#DC2626;}&:disabled{cursor:not-allowed;opacity:0.5;}`;
const AddReviewerBox = styled.div`display:flex;flex-direction:column;gap:6px;padding:8px;background:#FFF;border:1px solid #E2E8F0;border-radius:8px;margin-top:6px;`;
const AddReviewerList = styled.div`display:flex;flex-direction:column;gap:2px;max-height:160px;overflow:auto;`;
const AddReviewerItem = styled.button`padding:6px 8px;text-align:left;background:transparent;border:none;border-radius:4px;font-size:12px;color:#0F172A;cursor:pointer;&:hover:not(:disabled){background:#F0FDFA;color:#0F766E;}&:disabled{color:#CBD5E1;cursor:not-allowed;}`;
const WarnDialog = styled.div`margin-top:8px;padding:10px;background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;display:flex;flex-direction:column;gap:6px;`;
const WarnTitle = styled.div`font-size:12px;font-weight:700;color:#991B1B;`;
const WarnBody = styled.div`font-size:11px;color:#7F1D1D;line-height:1.5;`;
const WarnRow = styled.div`display:flex;gap:6px;justify-content:flex-end;`;

// 업무 삭제 (위험 영역)
const DangerSection = styled.div`margin-top:16px;padding:16px 14px 20px;border-top:1px dashed #E2E8F0;display:flex;flex-direction:column;gap:8px;`;
const DangerConfirm = styled.div`padding:12px;background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;display:flex;flex-direction:column;gap:8px;`;
const DangerTitle = styled.div`font-size:13px;font-weight:700;color:#991B1B;`;
const DangerBody = styled.div`font-size:12px;color:#7F1D1D;line-height:1.5;`;
const DangerRow = styled.div`display:flex;gap:6px;justify-content:flex-end;`;

// History
const Timeline = styled.div`display:flex;flex-direction:column;gap:8px;padding-left:6px;border-left:2px solid #E2E8F0;margin-top:6px;`;
const TimelineItem = styled.div`display:flex;gap:8px;position:relative;padding-left:6px;`;
const TimelineDot = styled.div<{ $event: string }>`position:absolute;left:-13px;top:4px;width:10px;height:10px;border-radius:50%;border:2px solid #FFF;${p => {
  const e = p.$event;
  if (e === 'approve' || e === 'completed') return 'background:#14B8A6;';
  if (e === 'revision') return 'background:#F43F5E;';
  if (e === 'review_submit') return 'background:#92400E;';
  if (e === 'ack') return 'background:#3730A3;';
  if (e === 'revert' || e === 'review_cancel') return 'background:#94A3B8;';
  if (e === 'reviewer_add' || e === 'reviewer_remove') return 'background:#1E40AF;';
  return 'background:#CBD5E1;';
}}`;
const TimelineBody = styled.div`flex:1;font-size:12px;color:#334155;`;
const TimelineHead = styled.div`display:flex;flex-wrap:wrap;align-items:center;gap:4px;`;
const TimelineEvent = styled.span`color:#64748B;`;
const TimelineTarget = styled.span`color:#64748B;`;
const TimelineRound = styled.span`font-size:10px;font-weight:700;color:#0F766E;background:#CCFBF1;padding:0 5px;border-radius:4px;margin-left:auto;`;
const TimelineNote = styled.div`margin-top:2px;padding:4px 8px;background:#F8FAFC;border-radius:4px;font-size:11px;color:#475569;`;
const TimelineTime = styled.div`margin-top:2px;font-size:10px;color:#94A3B8;`;

// Daily
const DailyGrid = styled.div`display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:1px;background:#E2E8F0;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;`;
const DailyHead = styled.div`display:contents;& > span{padding:6px 8px;background:#F8FAFC;font-size:10px;font-weight:700;color:#94A3B8;text-align:center;}`;
const DailyRow = styled.div`display:contents;& > span{padding:6px 8px;background:#FFF;font-size:11px;color:#0F172A;text-align:center;font-variant-numeric:tabular-nums;}`;

const Empty = styled.div`padding:16px;text-align:center;color:#CBD5E1;font-size:11px;`;
