// 업무 상세 드로어 — 오버레이(position:fixed) 패널.
// QTaskPage / QProjectDetailPage 양쪽에서 공용. 단일 taskId 를 받아 상세 + 워크플로우
// (리뷰어/히스토리/댓글/첨부/리치 본문) 를 자체 로드·편집.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import { formatDate } from '../../utils/dateFormat';
import CalendarPicker from '../Common/CalendarPicker';
import SingleDateField from '../Common/SingleDateField';
import PlanQSelect from '../Common/PlanQSelect';
import IdentityContext from '../Common/IdentityContext';
import PartnerKindBadge from '../Common/PartnerKindBadge';
import RichEditor from '../Common/RichEditor';
import ShareModal from '../Common/ShareModal';
import ConfirmDialog from '../Common/ConfirmDialog';
import ActionButton from '../Common/ActionButton';
import {
  buildPresetRRule, buildCustomRRule, parseRRule,
  type RecurPreset, type RecurEndType, type RecurCustomUnit,
} from '../../utils/recurrence';
import AttachmentField from '../Common/AttachmentField';
import { useImageLightbox } from '../Common/ImageLightbox';
import TaskFocusBar from '../Focus/TaskFocusBar';
import TaskAttachments from './TaskAttachments';
import RelatedTasksSection from './RelatedTasksSection';
import DescriptionAttachments from './DescriptionAttachments';
import { STATUS_COLOR, displayStatus, getStatusLabel, type StatusCode } from '../../utils/taskLabel';
import { getRoles, primaryPerspective } from '../../utils/taskRoles';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { CheckIcon } from '../Common/Icons';
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
  is_milestone?: boolean;
}

interface DrawerOrgUnit { id: number; name: string; name_en?: string | null }
export interface DrawerMemberOption { user_id: number; name: string; department?: DrawerOrgUnit | null; team?: DrawerOrgUnit | null; }
// D2-b (#66) — 프로젝트 참여 외부 파트너(user 계정 client) 후보. picker 에서 멤버와 합쳐 노출 + 유형 배지.
export interface DrawerExternalOption { user_id: number; name: string; kind: string; company_name?: string | null; }

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
  author?: { id?: number; name: string };
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
type CueKind = 'summarize' | 'draft_reply' | 'categorize' | 'research';
interface CueSource { type: 'conversation' | 'post' | 'kb_document' | 'meeting'; id: number; label: string; }
interface CueMeta {
  kind: CueKind;
  context_ref: Record<string, unknown> | null;
  sources: CueSource[];
  last_event: {
    action: 'cue.task_executed' | 'cue.task_failed' | 'cue.task_skipped';
    at: string;
    detail: Record<string, unknown> | null;
  } | null;
}
interface TaskDetail {
  id: number; title: string; description: string | null; body: string | null;
  status: string; priority_order: number | null;
  start_date: string | null; due_date: string | null;
  estimated_hours: number | null; actual_hours: number; progress_percent: number;
  // 시스템 자동 vs 사용자 입력 시그널 — 'ai'/'auto' 면 회색 italic, 'user' 면 검정 (사이클 N+6)
  latest_estimation_source?: 'ai' | 'user' | null;
  actual_source?: 'auto' | 'user' | null;
  source?: string; request_by_user_id?: number | null; request_ack_at?: string | null;
  created_at?: string | null;
  review_round?: number | null; review_policy?: 'all'|'any';
  assignee_id: number | null; created_by: number; project_id: number | null;
  is_milestone?: boolean;
  cue_kind?: CueKind | null;
  cue_context_ref?: Record<string, unknown> | null;
  cue_meta?: CueMeta | null;
  Project?: { id: number; name: string } | null;
  assignee?: { id: number; name: string } | null;
  requester?: { id: number; name: string } | null;
  creator?: { id: number; name: string } | null;
  comments?: CommentRow[];
  daily_progress?: { snapshot_date: string; progress_percent: number; actual_hours: number; estimated_hours: number | null }[];
  recurrence_rule?: string | null;
  recurrence_parent_id?: number | null;
}

export interface DrawerProjectOption { id: number; name: string; }

export interface TaskDetailDrawerProps {
  taskId: number;
  bizId: number;
  myId: number;
  todayStr: string;
  members: DrawerMemberOption[];
  // 프로젝트 변경 옵션 — 호출 측에서 가지고 있으면 전달, 없으면 drawer 가 자체 fetch.
  projects?: DrawerProjectOption[];
  width?: number;
  onWidthChange?: (w: number) => void;
  onClose: () => void;
  onPatch?: (patch: DrawerTaskPatch) => void;
  onRefresh?: () => void;
  // N+63 — 복사 후 새 task drawer 자동 전환 (parent 가 URL ?task= 변경)
  onDuplicated?: (newTaskId: number) => void;
}

// 사이클 N+6: reviewer 0명이면 reviewing/revision_requested 단계 자체가 노출되지 않음.
// 백엔드 PUT 도 같은 가드 (no_reviewers_assigned 400) — 양쪽 동시 적용으로 모순 0.
// 사이클 N+22 (2026-05-18): waiting (진행대기) 은 DB ENUM 정식 값이고 리스트/뱃지에서 노출되므로
// 드롭다운에서도 일관 포함 — 요청·비요청 구분 없이 동일 7 옵션 제공.
const statusOptionsFor = (task: { source?: string; reviewers?: Array<{ user_id: number }> }): string[] => {
  const hasReviewers = (task.reviewers || []).length > 0;
  let opts = ['not_started','waiting','in_progress','reviewing','revision_requested','completed','canceled'];
  if (!hasReviewers) opts = opts.filter(s => s !== 'reviewing' && s !== 'revision_requested');
  return opts;
};

const TaskDetailDrawer: React.FC<TaskDetailDrawerProps> = ({
  taskId, bizId, myId, todayStr, members, projects: projectsProp,
  width, onWidthChange, onClose, onPatch, onRefresh, onDuplicated,
}) => {
  const { t, i18n } = useTranslation('qtask');
  // 댓글 첨부 이미지 라이트박스 — 한 댓글의 이미지들이 갤러리로 묶임
  const { open: openImageLightbox, lightbox: imageLightbox } = useImageLightbox();
  // 프로젝트 옵션 — props 우선, 없으면 자체 fetch (TodoPage / QCalendarPage 같은 호출 측 호환)
  const [projectsFetched, setProjectsFetched] = useState<DrawerProjectOption[]>([]);
  React.useEffect(() => {
    if (projectsProp || !bizId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await apiFetch(`/api/projects?business_id=${bizId}&status=active`);
        const j = await r.json();
        if (!cancelled && j.success && Array.isArray(j.data)) {
          setProjectsFetched(j.data.map((p: { id: number; name: string }) => ({ id: p.id, name: p.name })));
        }
      } catch { /* ignore — 프로젝트 변경 셀이 비어 있을 뿐 */ }
    })();
    return () => { cancelled = true; };
  }, [projectsProp, bizId]);
  const projects = projectsProp ?? projectsFetched;
  const { user, hasRole } = useAuth();
  const drawerRef = useRef<HTMLElement>(null);
  useBodyScrollLock(!!taskId);
  useEscapeStack(!!taskId, onClose);
  useFocusTrap(drawerRef, !!taskId);

  const [detailTask, setDetailTask] = useState<TaskDetail | null>(null);
  const [reviewers, setReviewers] = useState<ReviewerRow[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [reviewPolicy, setReviewPolicy] = useState<'all'|'any'>('all');

  // D2-b (#66) — 이 업무의 project 에 참여 중인 외부 파트너(담당자/컨펌자 후보).
  //   project 없으면 빈 배열(외부인은 프로젝트 스코프 필수 — 백엔드 assertAssignable 와 일치).
  const [externals, setExternals] = useState<DrawerExternalOption[]>([]);
  React.useEffect(() => {
    const pid = detailTask?.project_id;
    if (!pid || !bizId) { setExternals([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await apiFetch(`/api/tasks/by-business/${bizId}/assignable-externals?project_id=${pid}`);
        const j = await r.json();
        if (!cancelled && j.success && Array.isArray(j.data)) {
          setExternals(j.data.map((e: { user_id: number; name: string; kind: string; company_name?: string | null }) => ({ user_id: e.user_id, name: e.name, kind: e.kind, company_name: e.company_name ?? null })));
        } else if (!cancelled) { setExternals([]); }
      } catch { if (!cancelled) setExternals([]); }
    })();
    return () => { cancelled = true; };
  }, [detailTask?.project_id, bizId]);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [aiEstLoading, setAiEstLoading] = useState(false);
  // Recurrence (정기업무) — 추가 폼과 동일 옵션
  const [recurEnabled, setRecurEnabled] = useState(false);
  const [recurPreset, setRecurPreset] = useState<RecurPreset>('weekly');
  const [recurEndType, setRecurEndType] = useState<RecurEndType>('never');
  const [recurEndCount, setRecurEndCount] = useState<string>('10');
  const [recurEndUntil, setRecurEndUntil] = useState<string>('');
  // custom 옵션은 추가 폼의 별도 모달에서 처리 — 상세에선 preset 만 (추후 보강 가능)
  const [recurCustomEvery] = useState<string>('1');
  const [recurCustomUnit] = useState<RecurCustomUnit>('week');
  // detailTask 로드되면 기존 recurrence_rule 파싱 → 모든 recurrence state 복원 (격주 등 preset 유지)
  React.useEffect(() => {
    const parsed = parseRRule(detailTask?.recurrence_rule);
    setRecurEnabled(parsed.enabled);
    setRecurPreset(parsed.preset);
    setRecurEndType(parsed.endType);
    setRecurEndCount(String(parsed.endCount));
    setRecurEndUntil(parsed.endUntil || '');
  }, [detailTask?.id, detailTask?.recurrence_rule]);

  // 현재 폼 상태 → RRULE 문자열 (없으면 null) — 추가 폼의 buildCurrentRRule 와 동일 로직
  // overrides: setState 비동기 우회 — 새 값을 직접 전달
  const buildRecurRule = (
    dueDate: string | null,
    overrides?: { preset?: RecurPreset; endType?: RecurEndType; endCount?: string; endUntil?: string }
  ): string | null => {
    if (!recurEnabled || !dueDate) return null;
    const finalPreset = overrides?.preset ?? recurPreset;
    const finalEndType = overrides?.endType ?? recurEndType;
    const finalEndCount = overrides?.endCount ?? recurEndCount;
    const finalEndUntil = overrides?.endUntil ?? recurEndUntil;
    const end = {
      type: finalEndType,
      count: finalEndType === 'count' ? Number(finalEndCount) || 1 : undefined,
      until: finalEndType === 'until' ? finalEndUntil : undefined,
    };
    if (finalPreset === 'custom') return buildCustomRRule(Number(recurCustomEvery) || 1, recurCustomUnit, end);
    return buildPresetRRule(finalPreset, dueDate, end);
  };
  const [statusOpen, setStatusOpen] = useState(false);
  const [openReviewers, setOpenReviewers] = useState(false);
  const [openHistory, setOpenHistory] = useState(false);
  const [openDaily, setOpenDaily] = useState(false);

  const [newComment, setNewComment] = useState('');
  const [commentFiles, setCommentFiles] = useState<File[]>([]);
  const [commentPickerOpen, setCommentPickerOpen] = useState(false);
  const [commentExistingFileIds, setCommentExistingFileIds] = useState<number[]>([]);
  const [commentExistingPostIds, setCommentExistingPostIds] = useState<number[]>([]);
  const [commentSending, setCommentSending] = useState(false);
  // 공유 모달 — 통합 ShareModal
  const [shareOpen, setShareOpen] = useState(false);
  // N+63 — 복사: POST /api/tasks/:id/copy → 응답으로 새 task → parent 가 ?task=newId 로 전환
  const [duplicating, setDuplicating] = useState(false);
  const handleDuplicate = useCallback(async () => {
    if (duplicating || !taskId) return;
    setDuplicating(true);
    try {
      const r = await apiFetch(`/api/tasks/${taskId}/copy`, { method: 'POST' });
      const j = await r.json();
      if (j.success && j.data?.id && onDuplicated) {
        onDuplicated(Number(j.data.id));
      }
    } catch { /* silent — 사용자가 다시 시도 */ }
    finally { setDuplicating(false); }
  }, [taskId, duplicating, onDuplicated]);
  // 댓글 편집/삭제 — 본인 댓글만 (메시지 정책과 동일)
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editingCommentDraft, setEditingCommentDraft] = useState('');
  const [commentMenuFor, setCommentMenuFor] = useState<number | null>(null);

  useEffect(() => {
    if (commentMenuFor === null) return;
    const onClick = () => setCommentMenuFor(null);
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [commentMenuFor]);

  const submitEditComment = useCallback(async () => {
    if (!detailTask || editingCommentId === null) return;
    const trimmed = editingCommentDraft.trim();
    if (!trimmed) return;
    const r = await apiFetch(`/api/tasks/${detailTask.id}/comments/${editingCommentId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: trimmed }),
    });
    if (r.ok) {
      const j = await r.json();
      setDetailTask(prev => prev ? { ...prev, comments: (prev.comments || []).map(cm => cm.id === editingCommentId ? { ...cm, content: j.data?.content || trimmed } : cm) } : prev);
      setEditingCommentId(null);
      setEditingCommentDraft('');
    }
  }, [detailTask, editingCommentId, editingCommentDraft]);

  const deleteComment = useCallback(async (commentId: number) => {
    if (!detailTask) return;
    const r = await apiFetch(`/api/tasks/${detailTask.id}/comments/${commentId}`, { method: 'DELETE' });
    if (r.ok) {
      setDetailTask(prev => prev ? { ...prev, comments: (prev.comments || []).filter(cm => cm.id !== commentId) } : prev);
    }
  }, [detailTask]);

  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionNote, setRevisionNote] = useState('');
  const [addReviewerOpen, setAddReviewerOpen] = useState(false);
  const [pendingReviewerAdd, setPendingReviewerAdd] = useState<number | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);  // N+93 — 삭제 실패 이유 표시 (조용한 실패 제거)
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
    setCommentExistingFileIds([]); setCommentExistingPostIds([]); setCommentPickerOpen(false);
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
      // #93-ⓑ — status 전이는 Focus 세션을 시작/종료/전환시킨다(N+32). 좌측 위젯·인박스 즉시 동기화(깜빡임 없이).
      try { window.dispatchEvent(new CustomEvent('inbox:refresh')); } catch { /* noop */ }
      try { window.dispatchEvent(new CustomEvent('focus:refresh')); } catch { /* noop */ }
      setSaveStatusTemp('saved');
    } catch { setSaveStatusTemp('error'); }
  };

  // N+93 (#10) — 업무 단계 되돌리기 (직전 상태로). 권한·이력은 backend 가 판정.
  const [reverting, setReverting] = useState(false);
  const revertStatus = async () => {
    if (!detailTask || reverting) return;
    setReverting(true);
    try {
      const r = await apiFetch(`/api/tasks/${detailTask.id}/revert-status`, { method: 'POST' });
      const j = await r.json();
      if (j.success) {
        onPatch?.({ id: detailTask.id, status: j.data.status });
        await loadDetail(detailTask.id);
        setSaveStatusTemp('saved');
      } else {
        setSaveStatusTemp('error');  // nothing_to_revert / 권한 — 조용히(배지 점멸)
      }
    } catch { setSaveStatusTemp('error'); }
    finally { setReverting(false); }
  };

  // #93-ⓑ 전수 — 워크플로우 액션 후 인플레이스 갱신(전체 교체 금지).
  //   기존 setDetailTask(detailR.data) 전체 교체는 본문/액션카드까지 리렌더해 "사라졌다 나타나는" 깜빡임.
  //   (1) status·진행률 등 스칼라는 액션 응답에서 즉시 인플레이스 병합 → 액션카드 지연 점프 제거.
  //   (2) 리뷰어·이력·댓글·첨부는 background 보강하되 body/description(RichEditor 바인딩)은 prev 레퍼런스 유지
  //       → 값이 같아도 새 객체로 교체되며 생기던 에디터 리렌더/깜빡임 원천 차단(RichEditor value===ref 가드 정합).
  const refreshAfterAction = async (taskData?: Record<string, unknown>) => {
    if (!detailTask) return;
    const id = detailTask.id;
    // (1) 액션 응답의 status 등 스칼라 즉시 인플레이스 (네트워크 왕복 전에 액션카드 전환)
    if (taskData && typeof taskData.status === 'string') {
      const td = taskData;
      setDetailTask(prev => prev ? {
        ...prev,
        status: td.status as string,
        progress_percent: (td.progress_percent ?? prev.progress_percent) as number,
        actual_hours: (td.actual_hours ?? prev.actual_hours) as number | null,
        actual_source: (td.actual_source ?? prev.actual_source) as 'auto' | 'user' | null,
      } as TaskDetail : prev);
      onPatch?.({ id, status: td.status as string, progress_percent: td.progress_percent as number | undefined });
    }
    // (2) 리뷰어·이력·댓글·첨부 보강 — body/description 은 prev 유지(깜빡임 방지)
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
      if (detailR.success) {
        setDetailTask(prev => prev ? {
          ...prev,
          ...detailR.data,
          body: prev.body,                 // RichEditor 바인딩 — 레퍼런스 유지
          description: prev.description,    // RichEditor 바인딩 — 레퍼런스 유지
        } as TaskDetail : detailR.data);
      }
    } catch { /* ignore */ }
    onRefresh?.();
  };
  // #93-ⓑ — 워크플로(이력·리뷰어)만 갱신. detailTask 전체 교체 없음 → 본문·설명 RichEditor 리렌더 X (깜빡임 제거).
  //   status 같은 가벼운 필드 전이는 호출부가 setDetailTask 로 인플레이스 병합하고, 이력/리뷰어만 이걸로 보강.
  const refreshWorkflowOnly = async (id: number) => {
    try {
      const wfR = await apiFetch(`/api/tasks/${id}/workflow`).then(r => r.json());
      if (wfR.success) {
        setReviewers(wfR.data.reviewers || []);
        setHistory(wfR.data.history || []);
        setReviewPolicy(wfR.data.task?.review_policy || 'all');
      }
    } catch { /* ignore */ }
  };
  const callAction = async (path: string, method: 'POST'|'DELETE'|'PATCH' = 'POST', body?: unknown) => {
    if (!detailTask || actionBusy) return;
    setActionBusy(true);
    try {
      const opts: RequestInit = { method };
      if (body) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
      const r = await (await apiFetch(`/api/tasks/${detailTask.id}${path}`, opts)).json();
      if (r.success) {
        // approve 는 { task, new_status }, 나머지 status 전이는 task.toJSON() — 둘 다에서 task 객체 추출.
        const taskData = (r.data && typeof r.data === 'object' && 'task' in r.data) ? r.data.task : r.data;
        await refreshAfterAction(taskData);
        // N+35 — 즉시 인박스 카드 동기화 안전망 (socket broadcast 와 별개로 같은 탭의 TodoPage 즉시 reload).
        // socket 지연/끊김 케이스에서도 카드 갱신 보장. 사용자 호소: "확인필요 카드 실시간 갱신 안 됨"
        try { window.dispatchEvent(new CustomEvent('inbox:refresh')); } catch { /* noop */ }
        // status 전이(시작/취소/완료 등)는 Focus 위젯 상태에도 영향 → 좌측 위젯 즉시 동기화 (#93-ⓑ 정합).
        try { window.dispatchEvent(new CustomEvent('focus:refresh')); } catch { /* noop */ }
      }
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
    const id = detailTask.id;
    setActionBusy(true);
    try {
      await apiFetch(`/api/tasks/by-business/${bizId}/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in_progress' }),
      });
      // #93-ⓑ — "진행 시작" 깜빡임 제거: 전체 refetch(refreshAfterAction) 대신 status 만 인플레이스 병합.
      //   본문/설명 RichEditor·댓글 등 무관한 영역은 그대로 두고, 이력·리뷰어만 가볍게 보강.
      setDetailTask(prev => prev ? { ...prev, status: 'in_progress' } as TaskDetail : prev);
      onPatch?.({ id, status: 'in_progress' });
      refreshWorkflowOnly(id);
      // status 'in_progress' 진입 = Focus auto-start trigger (N+32 옵션 A). 좌측 위젯 즉시 동기화.
      try { window.dispatchEvent(new CustomEvent('inbox:refresh')); } catch { /* noop */ }
      try { window.dispatchEvent(new CustomEvent('focus:refresh')); } catch { /* noop */ }
      onRefresh?.();
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
    setDeleteErr(null);
    try {
      const r = await apiFetch(`/api/tasks/by-business/${bizId}/${detailTask.id}`, { method: 'DELETE' });
      const j = await r.json();
      if (!j.success) {
        // N+93 — 구체 이유 표시 (confirm 다이얼로그 안에 유지). 조용한 실패 제거.
        const code = String(j.message || '');
        const reason = /task has activity/.test(code)
          ? t('detail.delete.errActivity', '이 업무에는 댓글·이력·리뷰어가 있어 작성자가 삭제할 수 없습니다. 워크스페이스 관리자(owner/admin)에게 요청하세요.')
          : /only workspace owner|forbidden/.test(code)
          ? t('detail.delete.errPermission', '삭제 권한이 없습니다. 워크스페이스 관리자(owner/admin)만 삭제할 수 있습니다.')
          : t('detail.delete.errGeneric', '삭제하지 못했습니다. 잠시 후 다시 시도해주세요.');
        setDeleteErr(reason as string);
        return;
      }
      onRefresh?.();
      onClose();
    } catch {
      setDeleteErr(t('detail.delete.errGeneric', '삭제하지 못했습니다. 잠시 후 다시 시도해주세요.') as string);
    } finally {
      setDeleting(false);
    }
  };

  // ── Cue 재실행 ──
  const [cueRerunning, setCueRerunning] = useState(false);
  const [cueRerunError, setCueRerunError] = useState<string | null>(null);
  const rerunCue = async () => {
    if (!detailTask || cueRerunning) return;
    setCueRerunning(true);
    setCueRerunError(null);
    try {
      const r = await apiFetch(`/api/tasks/${detailTask.id}/cue/rerun`, { method: 'POST' });
      const j = await r.json();
      if (!j.success) {
        setCueRerunError(j.message || 'unknown_error');
        return;
      }
      setDetailTask(prev => prev ? { ...prev, ...j.data } as TaskDetail : prev);
      onPatch?.({ id: detailTask.id, body: j.data.body, status: j.data.status });
    } catch {
      setCueRerunError('network_error');
    } finally {
      setCueRerunning(false);
    }
  };

  const addComment = async () => {
    if (!detailTask || commentSending) return;
    const hasContent = newComment.trim().length > 0;
    const hasNew = commentFiles.length > 0;
    const hasExisting = commentExistingFileIds.length > 0;
    if (!hasContent && !hasNew && !hasExisting) return;
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
      // 1) 새 파일 업로드
      for (const f of commentFiles) {
        const fd = new FormData();
        fd.append('file', f, f.name);
        const ur = await apiFetch(`/api/tasks/${detailTask.id}/attachments?context=comment&commentId=${comment.id}`, { method: 'POST', body: fd });
        const uj = await ur.json();
        if (uj.success) attached.push({
          id: uj.data.id, stored_name: uj.data.stored_name,
          original_name: uj.data.original_name, file_size: uj.data.file_size, mime_type: uj.data.mime_type,
        });
      }
      // 2) 기존 워크스페이스 파일 link
      if (hasExisting) {
        const lr = await apiFetch(`/api/tasks/${detailTask.id}/attachments/link`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_ids: commentExistingFileIds, context: 'comment', comment_id: comment.id }),
        });
        const lj = await lr.json();
        if (lj.success && Array.isArray(lj.data)) {
          for (const a of lj.data) attached.push({
            id: a.id, stored_name: a.stored_name,
            original_name: a.original_name, file_size: a.file_size, mime_type: a.mime_type,
          });
        }
      }
      setDetailTask(prev => prev ? { ...prev, comments: [...(prev.comments || []), { ...comment, attachments: attached }] } : prev);
      setNewComment(''); setCommentFiles([]);
      setCommentExistingFileIds([]); setCommentExistingPostIds([]); setCommentPickerOpen(false);
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
          {saveStatus === 'saved' && <><CheckIcon size={11} style={{ verticalAlign: '-1px' }} /> {t('save.saved', '저장됨')}</>}
          {saveStatus === 'error' && <>! {t('save.error', '저장 실패')}</>}
        </SaveStatusPill>
        {detailTask && (
          <ShareIconBtn type="button" onClick={() => setShareOpen(true)}
            title={t('detail.share', { defaultValue: '공유' }) as string}
            aria-label={t('detail.share', { defaultValue: '공유' }) as string}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          </ShareIconBtn>
        )}
        {/* N+63 — 복사 (담당자/마감일/시작일/진행률/실제시간 리셋, 본문·설명·예측시간·카테고리·프로젝트 복사) */}
        {detailTask && onDuplicated && (
          <DuplicateIconBtn type="button" onClick={handleDuplicate} disabled={duplicating}
            title={t('detail.duplicate', { defaultValue: '복사 (담당자·날짜 리셋)' }) as string}
            aria-label={t('detail.duplicate', { defaultValue: '복사' }) as string}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </DuplicateIconBtn>
        )}
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
          // 사이클 N+5 — PERMISSION_MATRIX §5.7 책임선 분리:
          //   title/category    → 작성자/담당자/owner/admin
          //   description (의뢰)→ 작성자/owner/admin (담당자 빠짐)
          //   body (결과물)     → 담당자/admin (owner 빠짐, admin 만 감사 백도어)
          const iAmCreator = detailTask.created_by === myId;
          const myWsRole = (user?.workspaces || []).find(w => w.business_id === bizId)?.role
            || (user?.business_id === bizId ? user?.business_role : null);
          const isPlatformAdmin = user?.platform_role === 'platform_admin';
          const iAmWsOwner = myWsRole === 'owner' || isPlatformAdmin;
          // 단계 직접 변경(드롭다운)은 owner/admin 만 — 일반 멤버는 워크플로 버튼(ack/제출/승인 등)으로만 전이.
          // 단계를 마음대로 점프하면 컨펌·검토 우회됨 (운영 피드백 #10).
          const canDirectStatus = myWsRole === 'owner' || myWsRole === 'admin' || isPlatformAdmin;
          const tz = user?.workspace_timezone || 'Asia/Seoul';
          const canEditTitle = iAmCreator || iAmAssignee || iAmWsOwner;
          const canEditDescription = iAmCreator || iAmWsOwner;
          const canEditBody = iAmAssignee || isPlatformAdmin;
          const canEditRecurrence = iAmCreator || iAmWsOwner;  // 백엔드 FIELD_RULES와 일치
          // 마일스톤(주요 업무) — 백엔드 FIELD_RULES.is_milestone(담당/작성/owner/admin)와 일치
          const canMilestone = iAmCreator || iAmAssignee || canDirectStatus;
          // 프로젝트 이관 = '내 업무 정리' → 담당자·작성자·owner·admin 모두 허용 (운영 #42, 2026-06-16 정책 완화).
          // 백엔드 FIELD_RULES.project_id 와 일치.
          const canEditProject = iAmAssignee || iAmCreator || iAmWsOwner || myWsRole === 'admin';
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
          const completeFinal = false; // done_feedback 단계 폐지 — 컨펌 충족 시 자동 completed
          const assigneeHasAction = ackAvailable || startAvailable || submitAvailable || cancelReviewAvailable || completeSimple || completeFinal || (detailTask.status === 'reviewing' && reviewers.length > 0 && reviewPolicy === 'all');
          const reviewerCanAct = iAmReviewer && (detailTask.status === 'reviewing' || detailTask.status === 'revision_requested');
          const approvedCount = reviewers.filter(rv => rv.state === 'approved').length;
          const canAddReviewer = iAmAssignee || iAmRequesterOrOwner;
          const memberOptions = members.filter(m => m.user_id !== detailTask.assignee_id && !reviewers.some(rv => rv.user_id === m.user_id));
          // D2-b (#66) — 외부 파트너 후보 (멤버와 중복 제거). 담당자/컨펌자 picker 에 배지로 구분 노출.
          const externalCandidates = externals.filter(e => !members.some(m => m.user_id === e.user_id));
          const externalById = new Map(externalCandidates.map(e => [e.user_id, e]));
          const externalReviewerOptions = externalCandidates.filter(e => e.user_id !== detailTask.assignee_id && !reviewers.some(rv => rv.user_id === e.user_id));
          const meSuffix = (uid: number) => (uid === myId ? (t('detail.meSuffix', ' (나)') as string) : '');
          // 담당자 셀렉트 옵션 — 멤버(배지 없음) + 외부 파트너(유형 배지 icon)
          const assigneeOptions = [
            ...members.map(m => ({ value: String(m.user_id), label: m.name + meSuffix(m.user_id) })),
            ...externalCandidates.map(e => ({ value: String(e.user_id), label: e.name, icon: <PartnerKindBadge kind={e.kind} size="xs" /> })),
          ];
          const selectedAssigneeOption = detailTask.assignee_id == null ? null : (() => {
            const uid = detailTask.assignee_id;
            const ext = externalById.get(uid);
            if (ext) return { value: String(uid), label: ext.name, icon: <PartnerKindBadge kind={ext.kind} size="xs" /> };
            const m = members.find(mm => mm.user_id === uid);
            return { value: String(uid), label: (m?.name || detailTask.assignee?.name || '-') + meSuffix(uid) };
          })();

          return (<>
            {/* 업무 흐름 sticky 바 — N+32 옵션 B (단순화). 담당자 본인 + status='in_progress' 일 때만 일시정지/재개. */}
            <TaskFocusBar taskId={detailTask.id} businessId={bizId} assigneeId={detailTask.assignee_id} status={detailTask.status} />
            {/* WORK_FLOW §6-B — 이월 연속성 배너: 지난 주부터 넘어온 활성 업무임을 알리고 과거 이력이 살아있음을 인지시킴. */}
            {(() => {
              const active = ['in_progress','reviewing','revision_requested','waiting'].includes(detailTask.status);
              const created = (detailTask.created_at || '').slice(0,10);
              const mon = (() => { const d = new Date(); const off = (d.getDay()+6)%7; d.setDate(d.getDate()-off); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
              if (!active || !created || created >= mon) return null;
              const spent = Number(detailTask.actual_hours || 0);
              const spentStr = (Math.round(spent*10)/10).toString();
              return (
                <CarriedBanner>
                  <CarriedTag>{t('detail.carried.tag','이월')}</CarriedTag>
                  <span>{spent > 0
                    ? t('detail.carried.bodySpent', { h: spentStr, defaultValue: '지난주부터 진행 중 · 누적 {{h}}h 투입 — 아래에 이력·대화·메모가 모두 남아 있어요' })
                    : t('detail.carried.body', '지난주부터 진행 중 — 아래에 이력·대화·메모가 모두 남아 있어요')}</span>
                </CarriedBanner>
              );
            })()}
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
                <Title
                  role={canEditTitle ? 'button' : undefined}
                  tabIndex={canEditTitle ? 0 : undefined}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={canEditTitle
                    ? (e) => { e.stopPropagation(); setTitleDraft(detailTask.title); setEditingTitle(true); }
                    : undefined}
                  title={canEditTitle
                    ? (t('detail.clickToEdit', '클릭하여 수정') as string)
                    : (t('detail.readOnlyHint', '편집 권한이 없습니다 (참고용)') as string)}>
                  <TitleText>{detailTask.title}</TitleText>
                  {canEditTitle && <TitleEditIcon aria-hidden>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </TitleEditIcon>}
                </Title>
              )}
              <Meta>
                <StatusBadgeWrap>
                  {/* 단계 badge — owner/admin 만 직접 변경(드롭다운), 그 외는 읽기전용. 전이는 하단 워크플로 버튼으로. */}
                  {canDirectStatus ? (
                    <StatusBadge as="button" $bg={sc.bg} $fg={sc.fg}
                      onClick={e => { e.stopPropagation(); setStatusOpen(v => !v); }}
                      title={t('list.statusHint', 'Click to change status') as string}>
                      {statusLabel} ▾
                    </StatusBadge>
                  ) : (
                    <StatusBadge as="span" $bg={sc.bg} $fg={sc.fg} title={statusLabel}>{statusLabel}</StatusBadge>
                  )}
                  {detailTask.review_round != null && detailTask.review_round > 0 &&
                    (detailTask.status === 'reviewing' || detailTask.status === 'revision_requested') &&
                    <RoundBadge title={t('detail.reviewers.roundTip', 'Review round') as string}>R{detailTask.review_round}</RoundBadge>}
                  {statusOpen && (
                    <StatusDropdown data-dropdown="status-detail">
                      {/* reviewers 는 별도 로드된 state — detailTask.reviewers(stale/누락 가능) 대신 사용해야
                          리스트 드롭다운과 동일하게 '확인요청중(reviewing)' 등 컨펌 단계가 노출됨. */}
                      {statusOptionsFor({ ...detailTask, reviewers }).map(s => {
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
                  // 타인 담당 (관찰자/컨펌자 관점) — N+34: 작성자 명시 추가 (사용자 호소: "작성자 꼭 표시")
                  const creatorName = detailTask.creator?.name || detailTask.requester?.name || '';
                  if (asgName) {
                    return <DrawerNameChip $type="observer" title={t('detail.chip.assignee', '담당자') as string}>
                      {creatorName && creatorName !== asgName
                        ? `${t('detail.chip.creatorPrefix', '작성')} · ${creatorName} → ${t('detail.chip.assigneePrefix', '담당')} · ${asgName}`
                        : `${t('detail.chip.assigneePrefix', '담당')} · ${asgName}`}
                    </DrawerNameChip>;
                  }
                  // 담당자 미지정 — 작성자만 표시
                  if (creatorName) {
                    return <DrawerNameChip $type="observer" title={t('detail.chip.creator', '작성자') as string}>
                      {t('detail.chip.creatorPrefix', '작성')} · {creatorName}
                    </DrawerNameChip>;
                  }
                  return null;
                })()}
                {/* 언제 등록한 업무인지 — 작성일(요청이면 요청일). 운영 피드백. */}
                {detailTask.created_at && (
                  <MetaDate title={formatDate(detailTask.created_at, tz)}>
                    {((detailTask.source === 'internal_request' || detailTask.source === 'qtalk_extract')
                      ? t('detail.meta.requestedOn', { defaultValue: '요청' })
                      : t('detail.meta.createdOn', { defaultValue: '작성' })) as string}
                    {' '}{formatDate(detailTask.created_at, tz)}
                  </MetaDate>
                )}
              </Meta>
              <MetaGrid>
                <MetaCell>
                  <MetaLabel>{t('detail.meta.project', '프로젝트')}
                    {!canEditProject && <ReadOnlyHint>{t('detail.readOnly', '읽기 전용')}</ReadOnlyHint>}
                  </MetaLabel>
                  <PlanQSelect size="sm" isClearable
                    isDisabled={!canEditProject}
                    placeholder={t('detail.meta.projectPh', '프로젝트 선택') as string}
                    value={detailTask.project_id == null ? null : {
                      value: String(detailTask.project_id),
                      label: projects.find(p => p.id === detailTask.project_id)?.name
                        || detailTask.Project?.name
                        || '-',
                    }}
                    onChange={(v) => {
                      if (!canEditProject) return;
                      const pid = (v as { value?: string })?.value ? Number((v as { value: string }).value) : null;
                      setDetailTask(prev => {
                        if (!prev) return prev;
                        const p = projects.find(pp => pp.id === pid);
                        return {
                          ...prev,
                          project_id: pid,
                          Project: pid != null ? { id: pid, name: p?.name || prev.Project?.name || '-' } : null,
                        } as TaskDetail;
                      });
                      saveField('project_id', pid);
                    }}
                    options={projects.map(p => ({ value: String(p.id), label: p.name }))} />
                </MetaCell>
                <MetaCell>
                  <MetaLabel>{t('detail.meta.assignee', '담당자')}</MetaLabel>
                  <PlanQSelect size="sm" isClearable
                    placeholder={t('detail.meta.assigneePh', '담당자 선택') as string}
                    value={selectedAssigneeOption}
                    onChange={(v) => {
                      const uid = (v as { value?: string })?.value ? Number((v as { value: string }).value) : null;
                      setDetailTask(prev => {
                        if (!prev) return prev;
                        const m = members.find(mm => mm.user_id === uid);
                        const ext = uid != null ? externalById.get(uid) : undefined;
                        return {
                          ...prev,
                          assignee_id: uid,
                          assignee: uid != null ? { id: uid, name: ext?.name || m?.name || prev.assignee?.name || '-' } : null,
                        } as TaskDetail;
                      });
                      saveField('assignee_id', uid);
                    }}
                    options={assigneeOptions} />
                  {/* 정체성 컨텍스트 — 담당자 소속: 직원=부서·팀 / 외부 파트너=유형+회사 (통합 primitive) */}
                  {(() => {
                    if (detailTask.assignee_id == null) return null;
                    const am = members.find(mm => mm.user_id === detailTask.assignee_id);
                    if (am) return <IdentityContext person={{ type: 'member', department: am.department, team: am.team }} lang={i18n.language} />;
                    const ext = externalById.get(detailTask.assignee_id);
                    if (ext) return <IdentityContext person={{ type: 'client', company_name: ext.company_name, kind: ext.kind }} lang={i18n.language} />;
                    return null;
                  })()}
                </MetaCell>
                <MetaCell>
                  <MetaLabel>{t('detail.meta.period', '기간')}</MetaLabel>
                  <DateRangeCell start={detailTask.start_date} due={detailTask.due_date}
                    onSave={(s, d) => {
                      saveField('start_date', s);
                      saveField('due_date', d);
                    }} />
                </MetaCell>
                {detailTask.project_id != null && (
                  <MetaCell>
                    <MetaLabel>{t('detail.meta.milestone', '주요 업무')}</MetaLabel>
                    <MilestoneToggle type="button" role="switch" aria-checked={!!detailTask.is_milestone}
                      $on={!!detailTask.is_milestone} disabled={!canMilestone}
                      title={t('detail.meta.milestoneHint', '일정 타임라인에 마일스톤(◆)으로 강조됩니다') as string}
                      onClick={() => {
                        if (!canMilestone) return;
                        const next = !detailTask.is_milestone;
                        setDetailTask(prev => prev ? { ...prev, is_milestone: next } as TaskDetail : prev);
                        saveField('is_milestone', next);  // saveField 내부에서 onPatch 호출
                      }}>
                      <MsDiamond $on={!!detailTask.is_milestone} />
                      <MsToggleLbl $on={!!detailTask.is_milestone}>{detailTask.is_milestone ? t('detail.meta.milestone', '주요 업무') : '—'}</MsToggleLbl>
                    </MilestoneToggle>
                  </MetaCell>
                )}
                {(() => {
                  const isAssignee = detailTask.assignee_id === myId;
                  const eHours = Number(detailTask.estimated_hours) || 0;
                  return (<>
                    <MetaCell>
                      <MetaLabel>{t('detail.meta.est', '예측')}</MetaLabel>
                      <MetaValueRow>
                        <MetaNumInput key={`e-${detailTask.id}-${eHours}-${detailTask.latest_estimation_source||'none'}`}
                          type="number" step="0.5" min="0"
                          $ai={detailTask.latest_estimation_source === 'ai' && eHours > 0}
                          defaultValue={detailTask.estimated_hours ?? ''} placeholder="-"
                          disabled={!isAssignee}
                          title={
                            detailTask.latest_estimation_source === 'ai' && eHours > 0
                              ? (t('detail.meta.aiEstHint', { defaultValue: 'AI 자동 예측 — 직접 입력하면 확정됩니다' }) as string)
                              : (isAssignee ? undefined : t('detail.meta.assigneeOnly', '담당자만 수정 가능 (참고용)') as string)
                          }
                          onBlur={e => { const v = e.target.value === '' ? null : Number(e.target.value); if ((v === null || !isNaN(v)) && isAssignee) saveField('estimated_hours', v); }} />
                        <MetaUnit>h</MetaUnit>
                        {isAssignee && (
                          <AiBtn type="button" disabled={aiEstLoading}
                            onClick={async () => {
                              if (!detailTask) return;
                              setAiEstLoading(true);
                              try {
                                const r = await apiFetch(`/api/tasks/${detailTask.id}/estimate/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
                                const j = await r.json();
                                if (!r.ok || !j.success) return;
                                const v = Number(j.data.value);
                                if (!Number.isFinite(v)) return;
                                setDetailTask(prev => prev ? { ...prev, estimated_hours: v } as TaskDetail : prev);
                                onPatch?.({ id: detailTask.id, estimated_hours: v });
                                saveField('estimated_hours', v);
                              } catch { /* ignore */ }
                              finally { setAiEstLoading(false); }
                            }}
                            title={t('detail.meta.aiEstimate', 'AI 예측시간 추천') as string}
                            aria-label={t('detail.meta.aiEstimate', 'AI 예측시간 추천') as string}>
                            {aiEstLoading
                              ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><circle cx="12" cy="12" r="9" strokeDasharray="40 16"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/></circle></svg>
                              : <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6L12 2z"/></svg>}
                            <span>{eHours > 0 ? t('detail.meta.aiEstAgain', 'AI 다시') : t('detail.meta.aiEstShort', 'AI 추천')}</span>
                          </AiBtn>
                        )}
                      </MetaValueRow>
                    </MetaCell>
                    <MetaCell>
                      <MetaLabelRow>
                        <MetaLabel>{t('detail.meta.act', '실제')}</MetaLabel>
                        {detailTask.status === 'in_progress' && (
                          <InProgressDot title={t('detail.meta.inProgressDot', { defaultValue: '진행 중' }) as string}
                            aria-label={t('detail.meta.inProgressDot', { defaultValue: '진행 중' }) as string}>
                            <span /> {t('detail.meta.inProgressDot', { defaultValue: '진행 중' })}
                          </InProgressDot>
                        )}
                      </MetaLabelRow>
                      <MetaValueRow>
                        <MetaNumInput key={`a-${detailTask.id}-${detailTask.actual_hours}-${detailTask.actual_source||'auto'}`}
                          type="number" step="0.5" min="0"
                          $ai={(detailTask.actual_source ?? 'auto') === 'auto' && Number(detailTask.actual_hours) > 0}
                          defaultValue={detailTask.actual_hours ?? ''} placeholder="-"
                          disabled={!isAssignee}
                          title={
                            (detailTask.actual_source ?? 'auto') === 'auto' && Number(detailTask.actual_hours) > 0
                              ? (t('detail.meta.actHint', { defaultValue: '진행 시작·완료 시 자동 누적 — 직접 입력하면 확정됩니다' }) as string)
                              : (isAssignee ? undefined : t('detail.meta.assigneeOnly', '담당자만 수정 가능 (참고용)') as string)
                          }
                          onBlur={e => { const v = e.target.value === '' ? null : Number(e.target.value); if ((v === null || !isNaN(v)) && isAssignee) saveField('actual_hours', v); }} />
                        <MetaUnit>h</MetaUnit>
                      </MetaValueRow>
                    </MetaCell>
                    <MetaCell>
                      <MetaLabel>{t('detail.meta.progress', '진행')}</MetaLabel>
                      <MetaValueRow>
                        <MetaRangeInput type="range" min="0" max="100" step="5" value={detailTask.progress_percent || 0}
                          disabled={!isAssignee}
                          title={isAssignee ? undefined : t('detail.meta.assigneeOnly', '담당자만 수정 가능 (참고용)') as string}
                          style={{ '--pq-fill': `${detailTask.progress_percent || 0}%` } as React.CSSProperties}
                          onChange={e => { if (!isAssignee) return; const v = Number(e.target.value); setDetailTask(prev => prev ? { ...prev, progress_percent: v } : prev); }}
                          onMouseUp={e => { if (isAssignee) saveField('progress_percent', Number((e.target as HTMLInputElement).value)); }}
                          onTouchEnd={e => { if (isAssignee) saveField('progress_percent', Number((e.target as HTMLInputElement).value)); }} />
                        <MetaProgressPct>{detailTask.progress_percent || 0}%</MetaProgressPct>
                      </MetaValueRow>
                    </MetaCell>
                  </>);
                })()}
              </MetaGrid>
              {/* 시간 자동 누적 안내 — tooltip 만으론 모바일/터치 환경에서 발견 불가. 상시 inline 노출. */}
              <TimeAutoHint>
                <TimeAutoHintIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </TimeAutoHintIcon>
                {t('detail.meta.timeHint', { defaultValue: '진행 시작·완료 시 실제 시간이 자동 누적됩니다 (직접 입력하면 확정)' })}
              </TimeAutoHint>
              {/* 100% 도달 + reviewer 있는 task — 자동 completed 안 됨. "확인 요청 보내기" 명시 클릭 안내. */}
              {(detailTask.progress_percent || 0) === 100
                && reviewers.length > 0
                && detailTask.status !== 'completed'
                && detailTask.status !== 'reviewing' && (
                <ReviewReminderHint>
                  <ReviewReminderIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12"/>
                  </ReviewReminderIcon>
                  {t('detail.meta.reviewReminder', {
                    defaultValue: '진행 100% 도달 — 컨펌자({{count}}명)에게 "확인 요청 보내기" 버튼을 눌러 완료 흐름을 시작하세요',
                    count: reviewers.length,
                  })}
                </ReviewReminderHint>
              )}

              {/* 정기업무 인스턴스 표시 — cron 자동 생성된 자식 task. 편집 UI 숨김 */}
              {detailTask.recurrence_parent_id && !detailTask.recurrence_rule && (
                <MetaRecurRow $disabled>
                  <MetaRecurToggle as="div">
                    <span aria-hidden="true" style={{ fontSize: 12 }}>↻</span>
                    <span>{t('recur.instance', { defaultValue: '정기업무에서 자동 생성된 1회분' })}</span>
                  </MetaRecurToggle>
                </MetaRecurRow>
              )}
              {/* 반복하기 — 정기업무 (추가 폼과 동일 옵션). 권한: 작성자/owner/admin.
                  인스턴스(자식) 인 경우 편집 UI 숨김 — parent 에서만 편집 (시리즈 일관성) */}
              {!detailTask.recurrence_parent_id && (
              <MetaRecurRow $disabled={!canEditRecurrence}>
                <MetaRecurToggle>
                  <input type="checkbox" checked={recurEnabled} disabled={!canEditRecurrence || !detailTask.due_date}
                    onChange={(e) => {
                      if (!canEditRecurrence) return;
                      const enabled = e.target.checked;
                      setRecurEnabled(enabled);
                      if (!enabled) {
                        // 끄면 즉시 백엔드에 null 저장
                        saveField('recurrence_rule', null);
                        setDetailTask(prev => prev ? { ...prev, recurrence_rule: null } : prev);
                      } else {
                        // 켤 때는 즉시 빌드해서 저장
                        const rule = buildRecurRule(detailTask.due_date);
                        if (rule) {
                          saveField('recurrence_rule', rule);
                          setDetailTask(prev => prev ? { ...prev, recurrence_rule: rule } : prev);
                        }
                      }
                    }} />
                  <span>{t('recur.toggle', '반복하기')}</span>
                  {!canEditRecurrence && <ReadOnlyHint>{t('detail.readOnly', '읽기 전용')}</ReadOnlyHint>}
                  {canEditRecurrence && !detailTask.due_date && <MetaRecurHint>{t('recur.needDueDate', '반복하려면 마감일이 필요해요')}</MetaRecurHint>}
                </MetaRecurToggle>
                {recurEnabled && detailTask.due_date && (() => {
                  // overrides: setState 비동기 우회 — 새 값을 직접 전달
                  const saveRule = (overrides?: { preset?: RecurPreset; endType?: RecurEndType; endCount?: string; endUntil?: string }) => {
                    const rule = buildRecurRule(detailTask.due_date, overrides);
                    if (rule) {
                      saveField('recurrence_rule', rule);
                      setDetailTask(prev => prev ? { ...prev, recurrence_rule: rule } : prev);
                    }
                  };
                  const due = new Date(detailTask.due_date + 'T00:00:00Z');
                  const dayLabel = t(`recur.weekday.${['SU','MO','TU','WE','TH','FR','SA'][due.getUTCDay()]}`, '');
                  const presetLabels: Record<RecurPreset, string> = {
                    daily: t('recur.presetDaily', '매일') as string,
                    weekly: t('recur.presetWeekly', { day: dayLabel, defaultValue: `매주 ${dayLabel}` }) as string,
                    biweekly: t('recur.presetBiweekly', { day: dayLabel, defaultValue: `격주 ${dayLabel}` }) as string,
                    monthly: t('recur.presetMonthly', { day: String(due.getUTCDate()), defaultValue: `매월 ${due.getUTCDate()}일` }) as string,
                    yearly: t('recur.presetYearly', { month: String(due.getUTCMonth()+1), day: String(due.getUTCDate()), defaultValue: `매년 ${due.getUTCMonth()+1}월 ${due.getUTCDate()}일` }) as string,
                    custom: t('recur.presetCustom', '사용자 지정...') as string,
                  };
                  return (
                    <MetaRecurOptions>
                      <PlanQSelect size="sm"
                        isDisabled={!canEditRecurrence}
                        value={{ value: recurPreset, label: presetLabels[recurPreset] }}
                        onChange={(v) => {
                          if (!canEditRecurrence) return;
                          const p = (v as { value?: string })?.value as RecurPreset | undefined;
                          if (!p || p === 'custom') return; // custom 은 별도 모달 (추가 폼 흐름) — 상세에선 일단 preset 만
                          setRecurPreset(p);
                          // setState 비동기 우회 — 새 값을 직접 전달
                          saveRule({ preset: p });
                        }}
                        options={[
                          { value: 'daily', label: presetLabels.daily },
                          { value: 'weekly', label: presetLabels.weekly },
                          { value: 'biweekly', label: presetLabels.biweekly },
                          { value: 'monthly', label: presetLabels.monthly },
                          { value: 'yearly', label: presetLabels.yearly },
                        ]} />
                      <PlanQSelect size="sm"
                        isDisabled={!canEditRecurrence}
                        value={{
                          value: recurEndType,
                          label: recurEndType === 'never' ? t('recur.endTypeNever', '계속 반복') as string
                            : recurEndType === 'count' ? t('recur.endTypeCount', '횟수 후 종료') as string
                            : t('recur.endTypeUntil', '특정 날짜까지') as string,
                        }}
                        onChange={(v) => {
                          if (!canEditRecurrence) return;
                          const next = (v as { value?: string })?.value as RecurEndType | undefined;
                          if (!next) return;
                          setRecurEndType(next);
                          saveRule({ endType: next });
                        }}
                        options={[
                          { value: 'never', label: t('recur.endTypeNever', '계속 반복') as string },
                          { value: 'count', label: t('recur.endTypeCount', '횟수 후 종료') as string },
                          { value: 'until', label: t('recur.endTypeUntil', '특정 날짜까지') as string },
                        ]} />
                      {recurEndType === 'count' && (
                        <MetaNumInput type="number" min="1" max="999"
                          disabled={!canEditRecurrence}
                          value={recurEndCount} onChange={e => canEditRecurrence && setRecurEndCount(e.target.value)}
                          onBlur={() => canEditRecurrence && saveRule()}
                          style={{ width: 70 }} />
                      )}
                      {recurEndType === 'until' && (
                        <SingleDateField
                          disabled={!canEditRecurrence}
                          value={recurEndUntil}
                          onChange={(d) => { if (canEditRecurrence) { setRecurEndUntil(d); saveRule({ endUntil: d }); } }}
                          width={140}
                        />
                      )}
                    </MetaRecurOptions>
                  );
                })()}
              </MetaRecurRow>
              )}
            </Section>

            {/* 단계 되돌리기 — 하단 액션 영역 앞. 권한·이력은 backend 가 판정. (운영 피드백: 위 제목 옆 X → 액션 앞) */}
            {detailTask.status !== 'not_started' && (
              <RevertRow>
                <RevertBtn type="button" onClick={() => revertStatus()} disabled={reverting}
                  title={t('detail.revert.tip', '직전 단계로 되돌리기') as string} aria-label={t('detail.revert.tip', '직전 단계로 되돌리기') as string}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>
                  {t('detail.revert.label', '되돌리기')}
                </RevertBtn>
              </RevertRow>
            )}

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
              <SectionTitle>
                {/* N+34 — description 라벨 동적: created_by === assignee_id 이면 "내가 적은 업무 메모"
                    (자기 업무), 다르면 "요청 내용" (요청 받은 업무). 사용자 인지 부담 완화. */}
                {detailTask.created_by === detailTask.assignee_id
                  ? t('detail.descriptionSelf', '내가 적은 업무 메모')
                  : detailTask.created_by !== myId && detailTask.assignee_id === myId
                  ? t('detail.descriptionRequest', '요청 내용')
                  : t('detail.description', '업무 설명')}
                {!canEditDescription && <ReadOnlyHint>{t('detail.readOnly', '읽기 전용')}</ReadOnlyHint>}
              </SectionTitle>
              <DescEditorWrap>
                <RichEditor
                  value={detailTask.description || ''}
                  onChange={(html) => debouncedSave('description', html, 2000)}
                  onBlur={(html) => flushDebounced('description', html)}
                  placeholder={t('detail.descPlaceholder', '업무 설명 — 이미지 붙여넣기·드래그 지원') as string}
                  uploadUrl={`/api/files/${bizId}`}
                  minHeight={120}
                  readOnly={!canEditDescription}
                />
              </DescEditorWrap>
              {/* description 영역 첨부 (의뢰자 자료) — 결과물(body) 영역 첨부와 분리. 권한 = description 편집 권한. */}
              <DescriptionAttachments taskId={detailTask.id} businessId={bizId} canEdit={canEditDescription} myId={myId} />
              {/* 관련 업무 링크 — description 컨텍스트의 일부. 양쪽이 봐야 할 정보라 책임선 무관 workspace 멤버 누구나 편집. */}
              {bizId && (
                <RelatedTasksSection taskId={detailTask.id} businessId={bizId} canEdit={iAmAssignee || iAmCreator || iAmWsOwner || isPlatformAdmin} />
              )}
            </Section>

            <Section>
              <SectionTitle>{t('detail.comments', 'Comments')} ({detailTask.comments?.length || 0})</SectionTitle>
              {(detailTask.comments || []).map(c => (
                <CommentItem key={c.id}>
                  <CommentHead>
                    <strong>{c.author?.name}</strong>
                    <span>{c.createdAt?.slice(5, 16).replace('T', ' ')}</span>
                    {c.author?.id === myId && (
                      <CommentMoreBtn type="button"
                        title={t('detail.commentMenu', { defaultValue: '편집/삭제' }) as string}
                        aria-label={t('detail.commentMenu', { defaultValue: '편집/삭제' }) as string}
                        onClick={(e) => { e.stopPropagation(); setCommentMenuFor(commentMenuFor === c.id ? null : c.id); }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="6" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="18" r="1.5"/></svg>
                      </CommentMoreBtn>
                    )}
                    {commentMenuFor === c.id && (
                      <CommentMenu onClick={(e) => e.stopPropagation()}>
                        <CommentMenuBtn type="button" onClick={() => { setEditingCommentId(c.id); setEditingCommentDraft(c.content || ''); setCommentMenuFor(null); }}>
                          {t('detail.commentEdit', { defaultValue: '편집' }) as string}
                        </CommentMenuBtn>
                        <CommentMenuBtn type="button" $danger onClick={() => { deleteComment(c.id); setCommentMenuFor(null); }}>
                          {t('detail.commentDelete', { defaultValue: '삭제' }) as string}
                        </CommentMenuBtn>
                      </CommentMenu>
                    )}
                  </CommentHead>
                  {editingCommentId === c.id ? (
                    <CommentEditWrap>
                      <CommentEditArea
                        autoFocus value={editingCommentDraft}
                        onChange={(e) => setEditingCommentDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submitEditComment(); }
                          if (e.key === 'Escape') { setEditingCommentId(null); setEditingCommentDraft(''); }
                        }}
                        rows={3}
                      />
                      <CommentEditActions>
                        <CommentEditCancel type="button" onClick={() => { setEditingCommentId(null); setEditingCommentDraft(''); }}>
                          {t('common.cancel', '취소')}
                        </CommentEditCancel>
                        <CommentEditSave type="button" onClick={submitEditComment} disabled={!editingCommentDraft.trim()}>
                          {t('common.save', { defaultValue: '저장' }) as string}
                        </CommentEditSave>
                      </CommentEditActions>
                    </CommentEditWrap>
                  ) : (
                    c.content && c.content !== '(첨부파일)' && <CommentBody>{c.content}</CommentBody>
                  )}
                  {(c.attachments || []).length > 0 && (() => {
                    // 한 댓글 안의 이미지 첨부만 갤러리로 묶음 — 다른 댓글 이미지와는 별개
                    const cmtImgs = (c.attachments || [])
                      .filter(a => a.mime_type?.startsWith('image/') && a.stored_name)
                      .map(a => ({ id: a.id, src: `/api/tasks/public/attach/${a.stored_name}`, alt: a.original_name }));
                    const cmtItems = cmtImgs.map(x => ({ src: x.src, alt: x.alt }));
                    return (
                  <CmtAtts>
                    {(c.attachments || []).map(a => {
                      const isImg = a.mime_type?.startsWith('image/');
                      const preview = (isImg && a.stored_name) ? `/api/tasks/public/attach/${a.stored_name}` : null;
                      const dl = `/api/tasks/attachments/${a.id}/download`;
                      // 이미지는 ImageLightbox 로 — 새 탭 대신 같은 페이지 갤러리.
                      // 비이미지는 fetch 로 blob 받아 다운로드 (auth header 포함).
                      return isImg && preview ? (
                        <CmtAttImgBtn key={a.id} type="button" onClick={(e) => {
                          e.stopPropagation();
                          const idx = cmtImgs.findIndex(x => x.id === a.id);
                          openImageLightbox(cmtItems, idx < 0 ? 0 : idx);
                        }} aria-label={a.original_name}>
                          <CmtAttImg src={preview} alt={a.original_name}/>
                        </CmtAttImgBtn>
                      ) : (
                        <CmtAttFile key={a.id} as="button" type="button" onClick={async (e) => {
                          e.preventDefault();
                          try {
                            const r = await apiFetch(dl);
                            if (!r.ok) return;
                            const blob = await r.blob();
                            const url = URL.createObjectURL(blob);
                            const link = document.createElement('a');
                            link.href = url; link.download = a.original_name;
                            document.body.appendChild(link); link.click();
                            document.body.removeChild(link);
                            setTimeout(() => URL.revokeObjectURL(url), 1000);
                          } catch { /* silent */ }
                        }}>
                          <CmtAttIcon>{a.original_name.split('.').pop()?.slice(0, 3).toUpperCase() || 'FILE'}</CmtAttIcon>
                          <CmtAttName>{a.original_name}</CmtAttName>
                        </CmtAttFile>
                      );
                    })}
                  </CmtAtts>
                    );
                  })()}
                </CommentItem>
              ))}
              <CommentComposer>
                <CommentInput value={newComment} placeholder={t('detail.writeComment', 'Write a comment...')}
                  onChange={e => setNewComment(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addComment(); } }} />
                {/* 인라인 첨부 picker — popup-on-popup 금지. 같은 영역에서 펼침. */}
                {commentPickerOpen && (
                  <CmtPickerInline>
                    <AttachmentField
                      businessId={bizId}
                      uploads={commentFiles}
                      onUploadsChange={setCommentFiles}
                      existingFileIds={commentExistingFileIds}
                      onExistingFileIdsChange={setCommentExistingFileIds}
                      includePosts
                      existingPostIds={commentExistingPostIds}
                      onExistingPostIdsChange={setCommentExistingPostIds}
                    />
                  </CmtPickerInline>
                )}
                {!commentPickerOpen && commentFiles.length > 0 && <CmtStagedRow>
                  {commentFiles.map((f, i) => (
                    <CmtStaged key={i}>
                      {f.name}
                      <CmtStagedX type="button" onClick={() => setCommentFiles(prev => prev.filter((_, j) => j !== i))}>×</CmtStagedX>
                    </CmtStaged>
                  ))}
                </CmtStagedRow>}
                <CmtComposerRow>
                  <CmtAttachBtn type="button" title={t('detail.attachFile', '파일·문서 첨부') as string}
                    $active={commentPickerOpen}
                    onClick={() => setCommentPickerOpen(v => !v)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                  </CmtAttachBtn>
                  <CommentSend onClick={addComment}
                    disabled={commentSending || (!newComment.trim() && commentFiles.length === 0 && commentExistingFileIds.length === 0)}>
                    {commentSending ? t('detail.sending', '전송 중...') : t('detail.send', 'Send')}
                  </CommentSend>
                </CmtComposerRow>
              </CommentComposer>
            </Section>

            {detailTask.cue_kind && detailTask.cue_meta && (
              <Section>
                <CueHead>
                  <CueBadge>
                    <CueStar aria-hidden>★</CueStar>
                    {t('detail.cue.badge', 'Generated by Cue')}
                  </CueBadge>
                  <CueKindTag>{t(`detail.cue.kindLabel.${detailTask.cue_kind}`, detailTask.cue_kind) as string}</CueKindTag>
                  <CueRerunBtn type="button" onClick={rerunCue} disabled={cueRerunning} title={t('detail.cue.rerun', 'Rerun') as string}>
                    {cueRerunning ? (
                      <>{t('detail.cue.rerunning', 'Running...')}</>
                    ) : (
                      <>↻ {t('detail.cue.rerun', 'Rerun')}</>
                    )}
                  </CueRerunBtn>
                </CueHead>
                {detailTask.cue_meta.last_event ? (
                  <CueEventLine>
                    <CueEventDot $action={detailTask.cue_meta.last_event.action} />
                    <span>
                      {t(
                        `detail.cue.lastEvent.${detailTask.cue_meta.last_event.action.replace('cue.task_', '')}`,
                        detailTask.cue_meta.last_event.action,
                      )}
                    </span>
                    <CueEventTime>
                      {t('detail.cue.executedAt', { at: formatCueTime(detailTask.cue_meta.last_event.at) })}
                    </CueEventTime>
                  </CueEventLine>
                ) : (
                  <CueEventLine>
                    <CueEventDot $action={null} />
                    <span>{t('detail.cue.noEvent', 'Not run yet')}</span>
                  </CueEventLine>
                )}
                {detailTask.cue_meta.sources.length > 0 && (
                  <CueSourcesRow>
                    <CueSourcesLabel>{t('detail.cue.sources', 'Sources')}</CueSourcesLabel>
                    {detailTask.cue_meta.sources.map(s => {
                      const tip = t(`detail.cue.sourceType.${s.type}`, s.type) as string;
                      const label = `${tip} · ${s.label}`;
                      if (s.type === 'conversation') {
                        return (
                          <CueSourceChip as="a" key={`${s.type}-${s.id}`} href={`/talk/${s.id}`} title={tip}>
                            {label}
                          </CueSourceChip>
                        );
                      }
                      return (
                        <CueSourceChip key={`${s.type}-${s.id}`} title={tip}>
                          {label}
                        </CueSourceChip>
                      );
                    })}
                  </CueSourcesRow>
                )}
                {cueRerunError && (
                  <CueErrorLine>
                    {t('detail.cue.rerunError', { reason: cueRerunError })}
                  </CueErrorLine>
                )}
              </Section>
            )}

            <Section>
              <SectionTitle>
                {t('detail.body', '결과물')}
                {!canEditBody && <ReadOnlyHint>{t('detail.readOnly', '읽기 전용')}</ReadOnlyHint>}
              </SectionTitle>
              <RichEditor value={detailTask.body || ''}
                onChange={(html) => debouncedSave('body', html, 2000)}
                onBlur={(html) => flushDebounced('body', html)}
                placeholder={t('detail.bodyPlaceholder', '업무 결과물을 작성하세요.  / 입력 시 블록 추가')}
                uploadUrl={`/api/tasks/${detailTask.id}/attachments?context=description`}
                minHeight={260}
                readOnly={!canEditBody} />
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
                        {rv.is_client && <PartnerKindBadge kind={externalById.get(rv.user_id)?.kind} size="xs"
                          label={externalById.get(rv.user_id) ? undefined : (t('detail.reviewers.external', '외부') as string)} />}
                        <ReviewerState $state={rv.state}>{t(`detail.reviewers.state.${rv.state}`, rv.state)}</ReviewerState>
                        {canAddReviewer && <ReviewerRemove onClick={() => removeReviewer(rv.user_id)} disabled={actionBusy} title={t('detail.reviewers.remove', 'Remove') as string}>×</ReviewerRemove>}
                      </ReviewerRowE>
                    ))}
                  </ReviewerList>
                )}
                {canAddReviewer && (addReviewerOpen ? (
                  <AddReviewerBox>
                    {memberOptions.length === 0 && externalReviewerOptions.length === 0 ? <MutedText>{t('detail.reviewers.noCandidates', 'No members to add')}</MutedText> : (
                      <AddReviewerList>
                        {memberOptions.map(m => (
                          <AddReviewerItem key={`m-${m.user_id}`} onClick={() => addReviewer(m.user_id)} disabled={actionBusy}>{m.name}</AddReviewerItem>
                        ))}
                        {externalReviewerOptions.map(e => (
                          <AddReviewerItem key={`e-${e.user_id}`} onClick={() => addReviewer(e.user_id)} disabled={actionBusy}>
                            <ReviewerOptInner><PartnerKindBadge kind={e.kind} size="xs" />{e.name}</ReviewerOptInner>
                          </AddReviewerItem>
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
                    {/* 합계 행 — 하루 단위 외에 totals 도 추후 추가 가능 */}
                  </DailyGrid>
                )}
              </ColBody>}
            </Collapsible>

            {/* 히스토리 — 가장 아래. 비어있어도 노출 (사용자: 단계이동·변경 이력은 항상 추적되어야) */}
            <Collapsible>
              <ColHeader onClick={() => setOpenHistory(v => !v)}>
                <ColArrow $open={openHistory}>▸</ColArrow>
                <span>{t('detail.history.title', 'History')} ({history.length})</span>
              </ColHeader>
              {openHistory && <ColBody>
                {history.length === 0 ? (
                  <Empty>{t('detail.history.empty', '아직 변경 이력이 없습니다')}</Empty>
                ) : (
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
                )}
              </ColBody>}
            </Collapsible>

            {(() => {
              const isAdmin = hasRole('platform_admin', 'business_owner');
              const isMine = detailTask.created_by === myId
                || detailTask.assignee_id === myId
                || detailTask.request_by_user_id === myId;
              if (!isAdmin && !isMine) return null;
              // N+63 — inline DangerConfirm 제거. drawer 끝에 펼쳐져 사용자가 스크롤 위치에 따라 안 보이는 회귀.
              // ConfirmDialog (modal, zIndex 2100) 로 교체 — drawer 위 가운데 항상 노출.
              return (
                <DangerSection>
                  <DangerActionRow>
                    <ActionDanger onClick={() => setDeleteConfirmOpen(true)} disabled={deleting}>
                      {t('detail.delete.button', '업무 삭제')}
                    </ActionDanger>
                  </DangerActionRow>
                </DangerSection>
              );
            })()}
          </>);
        })()}
      </Scroll>
    </Drawer>
    {detailTask && (
      <ShareModal
        open={shareOpen}
        entityType="task"
        entityId={detailTask.id}
        entityTitle={detailTask.title}
        onClose={() => setShareOpen(false)}
      />
    )}
    {/* N+63 — 삭제 confirm modal (drawer 위, zIndex 2100). 옛 inline DangerConfirm 은 drawer 끝에 펼쳐져
        사용자 스크롤 위치에 따라 안 보이는 회귀. 가운데 modal 로 항상 노출 보장. */}
    <ConfirmDialog
      isOpen={deleteConfirmOpen}
      onClose={() => { if (!deleting) { setDeleteConfirmOpen(false); setDeleteErr(null); } }}
      onConfirm={handleDelete}
      title={t('detail.delete.confirmTitle', '정말 삭제하시겠습니까?') as string}
      message={deleteErr || (t('detail.delete.confirmBody', '삭제된 업무는 복구할 수 없습니다. 댓글·첨부·이력도 함께 사라집니다.') as string)}
      confirmText={(deleting ? t('detail.delete.deleting', '삭제 중...') : t('detail.delete.confirm', '삭제')) as string}
      cancelText={t('common.cancel', '취소') as string}
      variant="danger"
    />
    {imageLightbox}
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
  @media (max-width: 1024px){ top:56px; }
`;
const ResizeHandle = styled.div`
  position:absolute;top:0;left:-4px;width:8px;height:100%;cursor:col-resize;z-index:45;
  &:hover{background:rgba(20,184,166,0.25);}&:active{background:rgba(20,184,166,0.45);}
  @media (max-width: 1024px) { display: none; }
`;
const DrawerHeader = styled.div`height:60px;padding:14px 20px;border-bottom:1px solid #E2E8F0;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;`;
// WORK_FLOW §6-B — 이월 연속성 배너 (차분한 slate, 비강조)
const CarriedBanner = styled.div`display:flex;align-items:center;gap:8px;margin:12px 20px 0;padding:8px 12px;background:#F1F5F9;border:1px solid #E2E8F0;border-radius:10px;font-size:12px;font-weight:600;color:#475569;line-height:1.4;`;
const CarriedTag = styled.span`flex-shrink:0;padding:1px 8px;font-size:10px;font-weight:700;color:#FFFFFF;background:#64748B;border-radius:10px;letter-spacing:-0.2px;`;
const BackBtn = styled.button`display:flex;align-items:center;gap:4px;background:transparent;border:none;color:#0F766E;font-size:12px;font-weight:600;cursor:pointer;padding:0;outline:none;&:hover{color:#134E4A;}&:focus{outline:none;}&:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;border-radius:4px;}`;
const CloseBtn = styled.button`width:28px;height:28px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;border-radius:6px;color:#64748B;cursor:pointer;outline:none;&:hover{background:#F1F5F9;color:#0F172A;}&:focus{outline:none;}&:focus-visible{outline:2px solid #14B8A6;outline-offset:-2px;}`;
const ShareIconBtn = styled.button`width:28px;height:28px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;border-radius:6px;color:#0F766E;cursor:pointer;outline:none;transition:background 0.15s;&:hover{background:#F0FDFA;color:#134E4A;}&:focus-visible{outline:2px solid #14B8A6;outline-offset:-2px;}`;
const DuplicateIconBtn = styled.button`width:28px;height:28px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;border-radius:6px;color:#64748B;cursor:pointer;outline:none;transition:background 0.15s;&:hover:not(:disabled){background:#F1F5F9;color:#0F172A;}&:focus-visible{outline:2px solid #14B8A6;outline-offset:-2px;}&:disabled{opacity:0.5;cursor:not-allowed;}`;
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
const SectionTitle = styled.h4`font-size:12px;font-weight:700;color:#0F172A;margin:0 0 8px;display:flex;align-items:center;gap:8px;`;
const ReadOnlyHint = styled.span`font-size:11px;font-weight:500;color:#94A3B8;background:#F1F5F9;border-radius:10px;padding:2px 8px;`;
const Title = styled.h3`font-size:19px;font-weight:700;color:#0F172A;margin:0 0 8px;line-height:1.35;cursor:pointer;border-radius:6px;padding:4px 6px;margin-left:-6px;transition:background 0.12s;display:flex;align-items:center;gap:8px;&:hover{background:#F1F5F9;}&:hover > span:last-child{opacity:1;}&:focus{outline:none;}&:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;}`;
const TitleText = styled.span`flex:1;min-width:0;`;
const TitleEditIcon = styled.span`display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:6px;color:#94A3B8;opacity:0;transition:opacity 0.15s, background 0.12s;flex-shrink:0;`;
const TitleInput = styled.input`font-size:19px;font-weight:700;color:#0F172A;line-height:1.35;width:100%;padding:4px 8px;margin-left:-6px;margin-bottom:8px;border:1px solid #14B8A6;border-radius:6px;background:#FFF;font-family:inherit;&:focus{outline:none;box-shadow:0 0 0 2px rgba(20,184,166,0.15);}`;
const Meta = styled.div`display:flex;align-items:center;gap:6px;font-size:11px;color:#64748B;flex-wrap:wrap;`;
const MetaDate = styled.span`font-size:11px;color:#94A3B8;white-space:nowrap;`;
const RevertRow = styled.div`display:flex;justify-content:flex-end;padding:4px 0 2px;`;
const StatusBadgeWrap = styled.span`position:relative;display:inline-flex;align-items:center;gap:4px;`;
const StatusBadge = styled.span<{ $bg: string; $fg: string }>`display:inline-flex;align-items:center;gap:2px;padding:3px 10px;font-size:11px;font-weight:700;background:${p => p.$bg};color:${p => p.$fg};border:none;border-radius:10px;cursor:pointer;user-select:none;&:hover{filter:brightness(0.95);}`;
const RoundBadge = styled.span`display:inline-flex;align-items:center;padding:2px 6px;font-size:10px;font-weight:800;color:#92400E;background:#FEF3C7;border-radius:6px;letter-spacing:0.3px;`;
// N+93 (#10) — 되돌리기 버튼
const RevertBtn = styled.button`
  display:inline-flex; align-items:center; gap:4px; padding:3px 9px;
  font-size:11px; font-weight:600; color:#64748B;
  background:#FFFFFF; border:1px solid #E2E8F0; border-radius:8px; cursor:pointer;
  transition:all 0.15s;
  &:hover:not(:disabled){ border-color:#CBD5E1; color:#0F172A; background:#F8FAFC; }
  &:disabled{ opacity:0.5; cursor:default; }
`;
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
// 추가 폼 (QTaskPage 의 AddOptRow / AddOptField / AddOptLabel) 과 동일한 패턴.
// flex + wrap + 자연 폭. 라벨 위 + 값 아래 (vertical cell).
const MetaGrid = styled.div`
  display: flex; flex-wrap: wrap; align-items: flex-start;
  gap: 8px;
  margin-top: 12px; padding-top: 12px;
  border-top: 1px solid #F1F5F9;
`;
const MetaCell = styled.div`
  flex: 1 1 140px; min-width: 0;
  display: flex; flex-direction: column; gap: 3px;
`;
const MetaLabel = styled.label`font-size: 11px; color: #64748B; font-weight: 600;`;
// 마일스톤(주요 업무) 토글 — 다이아몬드 + 라벨. 일정 타임라인 ◆ 와 시각 연동.
const MilestoneToggle = styled.button<{ $on: boolean }>`
  display: inline-flex; align-items: center; gap: 7px; min-height: 28px; align-self: flex-start;
  padding: 4px 11px 4px 9px; border-radius: 999px; cursor: pointer; font-family: inherit;
  border: 1px solid ${(p) => (p.$on ? '#F59E0B' : '#E2E8F0')};
  background: ${(p) => (p.$on ? '#FFFBEB' : '#fff')};
  &:disabled { cursor: default; opacity: .6; }
  &:not(:disabled):hover { border-color: ${(p) => (p.$on ? '#F59E0B' : '#CBD5E1')}; }
`;
const MsDiamond = styled.span<{ $on: boolean }>`
  width: 11px; height: 11px; transform: rotate(45deg); border-radius: 2px; flex-shrink: 0;
  border: 2px solid ${(p) => (p.$on ? '#F59E0B' : '#CBD5E1')};
  background: ${(p) => (p.$on ? '#F59E0B' : 'transparent')};
`;
const MsToggleLbl = styled.span<{ $on?: boolean }>`font-size: 12px; font-weight: 700; color: ${(p) => (p.$on ? '#92400E' : '#94A3B8')};`;
const MetaLabelRow = styled.div`display: flex; align-items: center; gap: 6px; min-height: 14px;`;
// 모든 셀 값 영역 height 통일 (28px) — progress range(8px) 와 hour input(28px) 시각 정렬 일치
const MetaValueRow = styled.div`display: flex; align-items: center; gap: 6px; min-width: 0; min-height: 28px;`;
// 시간 자동 누적 상시 안내 — MetaGrid 아래. caption 톤, 1줄.
const TimeAutoHint = styled.div`
  display: flex; align-items: center; gap: 6px;
  margin-top: 8px; padding: 6px 10px;
  background: #F8FAFC; border: 1px solid #F1F5F9; border-radius: 6px;
  font-size: 11px; color: #64748B; line-height: 1.4;
`;
const TimeAutoHintIcon = styled.svg`width: 12px; height: 12px; flex-shrink: 0; color: #94A3B8;`;
// 100% 도달 + reviewer 있을 때 동적 안내 — Primary 톤 (강조이지만 경고 아님)
const ReviewReminderHint = styled.div`
  display: flex; align-items: flex-start; gap: 6px;
  margin-top: 6px; padding: 8px 10px;
  background: #F0FDFA; border: 1px solid #5EEAD4; border-radius: 6px;
  font-size: 12px; color: #0F766E; font-weight: 500; line-height: 1.4;
`;
const ReviewReminderIcon = styled.svg`width: 14px; height: 14px; flex-shrink: 0; color: #14B8A6; margin-top: 1px;`;
const MetaRecurRow = styled.div<{ $disabled?: boolean }>`
  display: flex; flex-direction: column; gap: 6px;
  padding: 8px 10px;
  background: ${p => p.$disabled ? '#F8FAFC' : '#FFFFFF'};
  border: 1px solid ${p => p.$disabled ? '#F1F5F9' : '#E2E8F0'};
  border-radius: 6px;
  margin-top: 10px;
  opacity: ${p => p.$disabled ? 0.7 : 1};
`;
const MetaRecurToggle = styled.label`
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 13px; color: #0F172A; cursor: pointer;
  input { cursor: pointer; }
  input:disabled { cursor: not-allowed; }
`;
const MetaRecurHint = styled.span`font-size: 12px; color: #94A3B8; margin-left: 6px;`;
const MetaRecurOptions = styled.div`
  display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
  padding-top: 4px; border-top: 1px dashed #E2E8F0;
`;
const MetaNumInput = styled.input.attrs({ type: 'number', step: '0.5', min: '0' })<{ $ai?: boolean }>`
  width: 64px; min-width: 0;
  height: 28px; padding: 3px 8px;
  font-size: 13px;
  color: ${p => p.$ai ? '#94A3B8' : '#0F172A'};
  font-style: ${p => p.$ai ? 'italic' : 'normal'};
  border: 1px solid #E2E8F0; border-radius: 6px;
  font-family: inherit;
  &:focus {
    outline: none; border-color: #14B8A6;
    color: #0F172A; font-style: normal;  /* 편집 진입 시 즉시 검정 톤 — "확정" 시그널 */
  }
  &:disabled {
    color: #94A3B8; background: #F1F5F9;
    border: 1px dashed #E2E8F0; cursor: not-allowed; font-weight: 500; font-style: normal;
  }
  &:disabled::-webkit-outer-spin-button, &:disabled::-webkit-inner-spin-button { display: none; }
`;
const MetaUnit = styled.span`font-size: 11px; color: #94A3B8; flex-shrink: 0;`;
// 진행 중 dot — 작업 중 (status=in_progress) 일 때 actual_hours 옆 라이브 표시 (Apple Watch 스톱워치 패턴)
const InProgressDot = styled.span`
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 10px; font-weight: 600; color: #DC2626; flex-shrink: 0;
  > span {
    width: 6px; height: 6px; border-radius: 50%;
    background: #DC2626;
    animation: pulse 1.4s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(0.8); }
  }
`;
const AiBtn = styled.button`
  height: 28px; padding: 0 10px;
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  background: linear-gradient(135deg, #14B8A6 0%, #2DD4BF 100%);
  color: #FFFFFF;
  border: none; border-radius: 6px;
  cursor: pointer;
  flex-shrink: 0;
  font-size: 11px; font-weight: 600;
  transition: transform 0.15s, box-shadow 0.15s, opacity 0.15s;
  box-shadow: 0 2px 6px rgba(20,184,166,0.28);
  &:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 10px rgba(20,184,166,0.4); }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
`;
const MetaProgressPct = styled.span`font-size:11px;color:#475569;font-weight:600;min-width:32px;text-align:right;flex-shrink:0;white-space:nowrap;`;
const MetaRangeInput = styled.input`
  flex:1 1 0;min-width:0;appearance:none;-webkit-appearance:none;height:8px;border-radius:4px;
  background:linear-gradient(to right,#14B8A6 0%,#14B8A6 var(--pq-fill,0%),#F1F5F9 var(--pq-fill,0%),#F1F5F9 100%);
  outline:none;cursor:pointer;margin:0;padding:0;
  &::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;border-radius:50%;background:#FFF;border:2px solid #14B8A6;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,0.1);}
  &::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#FFF;border:2px solid #14B8A6;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,0.1);}
  &::-moz-range-track{background:transparent;}
  &:disabled{
    cursor:not-allowed;opacity:0.5;
    background:linear-gradient(to right,#94A3B8 0%,#94A3B8 var(--pq-fill,0%),#E2E8F0 var(--pq-fill,0%),#E2E8F0 100%);
  }
  &:disabled::-webkit-slider-thumb{border-color:#94A3B8;cursor:not-allowed;}
  &:disabled::-moz-range-thumb{border-color:#94A3B8;cursor:not-allowed;}
`;
const DateTrigger = styled.button<{ $empty?: boolean }>`
  width:100%;padding:4px 6px;font-size:12px;font-weight:600;background:transparent;border:1px solid transparent;border-radius:6px;cursor:pointer;
  white-space:nowrap;font-family:inherit;text-align:left;
  color:${p => p.$empty ? '#CBD5E1' : '#64748B'};
  &:hover{border-color:#14B8A6;color:#0F766E;}
`;
const DescEditorWrap = styled.div`background:#FFF;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;&:focus-within{border-color:#14B8A6;}`;

// Actions
const ActionCard = styled.div`background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:8px;& + &{margin-top:8px;}
  transition:opacity 0.18s ease-out;
  & > button{transition:background 0.15s, color 0.15s, border-color 0.15s;}
`;
const ActionCardTitle = styled.div`font-size:10px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.3px;`;
// 사이클 N+19 — 옛 3개 styled 를 공용 ActionButton 으로 alias.
// 사용처 17곳 코드 변경 없이 디자인 시스템 통일 (sm 36px / Primary teal / Secondary gray / Danger red).
type _ABProps = Omit<React.ComponentProps<typeof ActionButton>, 'tone' | 'size'>;
const ActionPrimary: React.FC<_ABProps> = (p) => <ActionButton tone="primary" size="sm" {...p} />;
const ActionSecondary: React.FC<_ABProps> = (p) => <ActionButton tone="secondary" size="sm" {...p} />;
const ActionDanger: React.FC<_ABProps> = (p) => <ActionButton tone="danger" size="sm" {...p} />;
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
const CommentItem = styled.div`
  position:relative;padding:8px 10px;background:#F8FAFC;border-radius:8px;
  & + &{margin-top:6px;}
  &:hover .comment-more-btn{opacity:1;}
`;
const CommentHead = styled.div`
  position:relative;display:flex;gap:8px;align-items:baseline;font-size:11px;color:#64748B;margin-bottom:3px;
  & strong{color:#0F172A;font-weight:600;}
`;
const CommentBody = styled.div`font-size:12px;color:#1E293B;line-height:1.4;white-space:pre-wrap;`;
const CommentMoreBtn = styled.button.attrs({ className: 'comment-more-btn' })`
  margin-left:auto;width:22px;height:22px;background:transparent;border:none;border-radius:4px;
  display:inline-flex;align-items:center;justify-content:center;color:#94A3B8;cursor:pointer;
  opacity:0;transition:opacity 0.15s,background 0.15s;
  &:hover{background:#FFFFFF;color:#0F172A;}
  &:focus-visible{opacity:1;outline:1px solid #14B8A6;}
`;
const CommentMenu = styled.div`
  position:absolute;right:0;top:18px;z-index:20;min-width:120px;padding:4px;
  background:#FFFFFF;border:1px solid #E2E8F0;border-radius:8px;
  box-shadow:0 4px 12px rgba(0,0,0,0.06);
`;
const CommentMenuBtn = styled.button<{$danger?:boolean}>`
  width:100%;padding:6px 10px;text-align:left;font-size:12px;font-weight:500;
  color:${p=>p.$danger?'#DC2626':'#334155'};background:transparent;border:none;border-radius:6px;cursor:pointer;
  &:hover{background:${p=>p.$danger?'#FEF2F2':'#F8FAFC'};}
`;
const CommentEditWrap = styled.div`display:flex;flex-direction:column;gap:6px;`;
const CommentEditArea = styled.textarea`
  width:100%;padding:6px 8px;font-size:12px;color:#0F172A;line-height:1.5;
  border:1px solid #14B8A6;border-radius:6px;background:#fff;font-family:inherit;resize:vertical;
  &:focus{outline:none;box-shadow:0 0 0 3px rgba(20,184,166,0.15);}
`;
const CommentEditActions = styled.div`display:flex;justify-content:flex-end;gap:6px;`;
const CommentEditCancel = styled.button`
  height:26px;padding:0 10px;font-size:11px;font-weight:600;color:#475569;
  background:#fff;border:1px solid #E2E8F0;border-radius:6px;cursor:pointer;
  &:hover{background:#F8FAFC;}
`;
const CommentEditSave = styled.button`
  height:26px;padding:0 12px;font-size:11px;font-weight:700;color:#fff;
  background:#14B8A6;border:none;border-radius:6px;cursor:pointer;
  &:hover:not(:disabled){background:#0D9488;}
  &:disabled{background:#CBD5E1;cursor:not-allowed;}
`;
const CommentComposer = styled.div`display:flex;flex-direction:column;gap:6px;margin-top:8px;`;
const CmtComposerRow = styled.div`display:flex;justify-content:flex-end;gap:6px;align-items:center;`;
const CommentInput = styled.textarea`width:100%;padding:6px 10px;border:1px solid #E2E8F0;border-radius:8px;font-size:12px;color:#0F172A;font-family:inherit;resize:vertical;min-height:40px;max-height:120px;&:focus{outline:none;border-color:#14B8A6;}&::placeholder{color:#94A3B8;}`;
const CommentSend = styled.button`padding:6px 14px;background:#14B8A6;color:#FFF;border:none;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;&:disabled{background:#CBD5E1;cursor:not-allowed;}&:hover:not(:disabled){background:#0D9488;}`;
const CmtAttachBtn = styled.button<{ $active?: boolean }>`width:32px;height:28px;display:flex;align-items:center;justify-content:center;background:${p=>p.$active?'#F0FDFA':'transparent'};border:1px solid ${p=>p.$active?'#14B8A6':'#E2E8F0'};color:${p=>p.$active?'#0D9488':'#64748B'};border-radius:6px;cursor:pointer;&:hover{border-color:#14B8A6;background:#F0FDFA;color:#0D9488;}`;
const CmtPickerInline = styled.div`background:#FAFBFC;border:1px solid #E2E8F0;border-radius:8px;padding:10px;margin-top:6px;`;
const CmtStagedRow = styled.div`display:flex;flex-wrap:wrap;gap:4px;`;
const CmtStaged = styled.span`display:inline-flex;align-items:center;gap:4px;padding:2px 6px 2px 8px;background:#F0FDFA;color:#0F766E;border:1px solid #99F6E4;border-radius:12px;font-size:11px;`;
const CmtStagedX = styled.button`width:16px;height:16px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;color:#0F766E;cursor:pointer;font-size:14px;line-height:1;&:hover{color:#DC2626;}`;
const CmtAtts = styled.div`display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;`;
const CmtAttImgBtn = styled.button`
  all: unset; display: inline-block; cursor: zoom-in; border-radius: 6px;
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
const CmtAttImg = styled.img`max-width:160px;max-height:120px;object-fit:cover;border-radius:6px;border:1px solid #E2E8F0;display:block;`;
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
const ReviewerOptInner = styled.span`display:inline-flex;align-items:center;gap:8px;`;
const WarnDialog = styled.div`margin-top:8px;padding:10px;background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;display:flex;flex-direction:column;gap:6px;`;
const WarnTitle = styled.div`font-size:12px;font-weight:700;color:#991B1B;`;
const WarnBody = styled.div`font-size:11px;color:#7F1D1D;line-height:1.5;`;
const WarnRow = styled.div`display:flex;gap:6px;justify-content:flex-end;`;

// 업무 삭제 (위험 영역)
const DangerSection = styled.div`margin-top:16px;padding:16px 14px 20px;border-top:1px dashed #E2E8F0;display:flex;flex-direction:column;gap:8px;`;
// N+63 — DangerConfirm / DangerTitle / DangerBody / DangerRow 제거 (ConfirmDialog modal 로 대체)
const DangerActionRow = styled.div`display:flex;justify-content:flex-end;`;

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

// ─── Cue 섹션 ───
// 동일 Drawer 의 댓글·히스토리 시각 표기 (`createdAt?.slice(5, 16).replace('T', ' ')`)와 일관 유지.
// 일괄 useTimeFormat 도입은 Drawer 전체 시각 표시를 함께 리팩토링하는 별도 사이클에서 처리.
function formatCueTime(iso: string): string {
  if (!iso) return '';
  return iso.slice(5, 16).replace('T', ' ');
}
const CueHead = styled.div`display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;`;
const CueBadge = styled.span`display:inline-flex;align-items:center;gap:4px;padding:3px 10px;font-size:11px;font-weight:700;background:linear-gradient(135deg,#FFF1F2 0%,#FFE4E6 100%);color:#9F1239;border:1px solid #FECDD3;border-radius:999px;`;
const CueStar = styled.span`color:#F43F5E;font-size:11px;line-height:1;`;
const CueKindTag = styled.span`padding:2px 8px;font-size:10px;font-weight:700;color:#0F766E;background:#F0FDFA;border:1px solid #CCFBF1;border-radius:6px;text-transform:uppercase;letter-spacing:0.3px;`;
const CueRerunBtn = styled.button`margin-left:auto;padding:4px 10px;font-size:11px;font-weight:600;color:#0F766E;background:#FFF;border:1px solid #CBD5E1;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;gap:3px;&:hover:not(:disabled){border-color:#0F766E;background:#F0FDFA;}&:disabled{color:#94A3B8;cursor:not-allowed;}`;
const CueEventLine = styled.div`display:flex;align-items:center;gap:6px;font-size:11px;color:#64748B;`;
const CueEventDot = styled.span<{ $action: string | null }>`
  width:6px;height:6px;border-radius:50%;flex-shrink:0;
  background:${p =>
    p.$action === 'cue.task_executed' ? '#10B981' :
    p.$action === 'cue.task_failed' ? '#EF4444' :
    p.$action === 'cue.task_skipped' ? '#F59E0B' :
    '#CBD5E1'};
`;
const CueEventTime = styled.span`color:#94A3B8;font-variant-numeric:tabular-nums;`;
const CueSourcesRow = styled.div`display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:8px;`;
const CueSourcesLabel = styled.span`font-size:10px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:0.3px;`;
const CueSourceChip = styled.span`display:inline-flex;align-items:center;padding:3px 8px;font-size:11px;font-weight:600;color:#0F766E;background:#F0FDFA;border:1px solid #CCFBF1;border-radius:6px;text-decoration:none;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  &[href]{cursor:pointer;}
  &[href]:hover{border-color:#14B8A6;background:#CCFBF1;}
`;
const CueErrorLine = styled.div`margin-top:8px;font-size:11px;color:#991B1B;background:#FEE2E2;border:1px solid #FECACA;border-radius:6px;padding:6px 10px;`;
