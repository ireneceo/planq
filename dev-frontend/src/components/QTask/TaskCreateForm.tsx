// TaskCreateForm — 업무 추가 폼의 **단일 원천**.
//
// Irene 2026-09-12: *"업무추가 팝업이 왜 새거야? 기존 업무추가 항목들하고 기능하고 다르고?"*
//   *"뭘 개발해도 새로운거 새로운 디자인. 기능형태 ui/ux 마음대로 생성하지마. 동기화도 다 되어야 해."*
//
// 같은 "업무 추가" 가 여는 자리마다 다르면 사용자는 그것을 고장으로 읽는다. 실제로 베낀 copy 들이
// 이미 갈라져 있었다 — QTaskPage 안에서조차 두 벌(표 아래 인라인 / 우측 드로어)이었고,
//   · 인라인에만 **태그**가 있었다 (드로어에서는 태그를 달 수 없었다)
//   · 드로어는 요청 탭에서도 **예측시간·AI 추천·반복**을 보여줬다 (PERMISSION_MATRIX §5.7 위반 —
//     estimated_hours 는 담당자만. 인라인 쪽에만 그 가드가 있었다)
//   · Q sale 상담 목록은 **제목+설명 2칸**짜리 별개 모달이라 프로젝트·담당자·마감이 아예 없었다
// 그래서 폼을 이 한 파일로 모으고, 부르는 쪽은 **껍데기(drawer/inline)와 맥락만** 넘긴다.
//
// 계약
//   · 값·검증·제출(업로드·첨부 link·태그·반복)은 전부 여기 있다. 부르는 쪽은 onCreated 로 결과만 받는다.
//   · 멤버·프로젝트·태그 사전은 **주면 그것을 쓰고 없으면 스스로 읽는다** — 이미 들고 있는 화면
//     (QTaskPage)은 중복 호출이 없고, 안 들고 있는 화면(Q sale)은 아무것도 준비할 필요가 없다.
//   · 임시저장(draftKind)이 있으면 제목·설명은 **저장본이 정본**이다. 쓰다 닫아도 남고,
//     비우는 것은 제출 성공·명시 취소뿐이다(입력 초안 계약, docs/DRAFT_PERSISTENCE_DESIGN.md).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import CreateDrawer from '../Common/CreateDrawer';
import CalendarPicker from '../Common/CalendarPicker';
import PlanQSelect from '../Common/PlanQSelect';
import RichEditor from '../Common/RichEditor';
import AttachmentField from '../Common/AttachmentField';
import PartnerKindBadge from '../Common/PartnerKindBadge';
import RecurrencePicker from '../Common/RecurrencePicker';
import TagPicker from './TagPicker';
import { useTaskTagDict } from './useTaskTagDict';
import type { TaskTagLite } from './TagChips';
import { isEnterAction } from '../../utils/imeKey';
import { useDraftKey, useDraftText } from '../../hooks/useDraftText';
import type { DraftKind } from '../../hooks/draftKinds';

export interface TaskFormMember { user_id: number; name: string }
export interface TaskFormProject { id: number; name: string }

/** 바깥에서 채워 넣는 첫 값 (공유 타깃·음성 캡처 등). 바뀔 때마다 initialNonce 를 올린다. */
export interface TaskCreateInitial {
  title?: string;
  /** HTML — 평문이면 부르는 쪽에서 plainToHtml 로 바꿔 넘긴다(개행이 사라진다) */
  description?: string;
  assigneeId?: number | null;
  projectId?: number | null;
  startDate?: string;
  dueDate?: string;
  fileIds?: number[];
}

export interface TaskCreatedTask { id: number; [k: string]: unknown }

export interface TaskCreateFormProps {
  businessId: number;
  /** 'drawer' = 우측 CreateDrawer(표준 생성 껍데기) · 'inline' = 목록 하단 새 행 */
  layout?: 'drawer' | 'inline';
  /** 'request' = 업무 **요청**(담당자 필수 · 예측시간·AI·반복 숨김 — PERMISSION_MATRIX §5.7) */
  mode?: 'task' | 'request';
  /** 내 업무(오늘·이번 주·전체) — 담당자는 무조건 나 */
  assigneeFixedToMe?: boolean;
  /** 프로젝트가 이미 정해진 화면(Q project 업무 탭) — 프로젝트 칸을 숨기고 이 값으로 고정한다 */
  fixedProjectId?: number | null;
  /** 업무 그룹(워크스트림) 후보. 주면 칸이 생긴다 — 프로젝트 안에서만 뜻이 있다 */
  workstreams?: Array<{ id: number; title: string; status?: string }>;
  /** 그 탭 목록 안에 남게 하는 생성 기본값(단일 원천은 부르는 쪽) */
  createDefaults?: { due_date?: string | null; planned_week_start?: string | null } | null;
  initial?: TaskCreateInitial | null;
  initialNonce?: number;
  /** 쓰다 닫아도 남아야 하는 입력이면 kind + 대상 id */
  draftKind?: DraftKind;
  draftId?: string | null;
  members?: TaskFormMember[];
  projects?: TaskFormProject[];
  tagDict?: TaskTagLite[];
  onTagDictAdd?: (tag: TaskTagLite) => void;
  autoFocus?: boolean;
  drawerTitle?: React.ReactNode;
  submitLabel?: React.ReactNode;
  /** 고객이 이미 정해진 화면(Q sale 고객 패널·전체 프로필) — 만든 업무를 그 고객에 붙인다(tasks.client_id).
   *  칸을 만들지 않는다: 그 화면은 이미 "이 고객" 맥락 안이라 고르게 하면 틀릴 수만 있다. */
  fixedClientId?: number | null;
  onClose: () => void;
  onCreated?: (task: TaskCreatedTask) => void;
}

const TaskCreateForm: React.FC<TaskCreateFormProps> = ({
  businessId, layout = 'drawer', mode = 'task', assigneeFixedToMe = false,
  fixedProjectId = null, fixedClientId = null, workstreams,
  createDefaults = null, initial = null, initialNonce = 0,
  draftKind, draftId = null,
  members: membersProp, projects: projectsProp, tagDict: tagDictProp, onTagDictAdd,
  autoFocus = true, drawerTitle, submitLabel, onClose, onCreated,
}) => {
  const { t } = useTranslation('qtask');
  const { user } = useAuth();
  const myId = user ? Number(user.id) : null;
  const isRequest = mode === 'request';
  const bizId = businessId;

  // ── 제목·설명 — 임시저장이 붙어 있으면 저장본이 정본 (NoteThread 와 같은 idiom) ──
  const titleKey = useDraftKey(draftKind ?? 'sale-task-add', draftKind && draftId ? `${draftId}:title` : null, bizId);
  const descKey = useDraftKey(draftKind ?? 'sale-task-add', draftKind && draftId ? `${draftId}:desc` : null, bizId);
  const titleDraft = useDraftText(titleKey);
  const descDraft = useDraftText(descKey);
  const title = titleDraft.text;
  const description = descDraft.text;

  const [assigneeId, setAssigneeId] = useState<number | null>(initial?.assigneeId ?? (isRequest ? null : myId));
  const [projectId, setProjectId] = useState<number | null>(fixedProjectId ?? initial?.projectId ?? null);
  const [workstreamId, setWorkstreamId] = useState<number | null>(null);
  const [startDate, setStartDate] = useState<string>(initial?.startDate ?? '');
  const [dueDate, setDueDate] = useState<string>(initial?.dueDate ?? '');
  const [estHours, setEstHours] = useState<string>('');
  const [tagIds, setTagIds] = useState<number[]>([]);
  const [uploads, setUploads] = useState<File[]>([]);
  const [existingFileIds, setExistingFileIds] = useState<number[]>(initial?.fileIds ?? []);
  const [existingPostIds, setExistingPostIds] = useState<number[]>([]);
  const [showAttach, setShowAttach] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const dateAnchorRef = useRef<HTMLButtonElement>(null);

  // 반복(정기업무) — UI 는 **공용 RecurrencePicker**(Q Calendar 와 같은 것). 값은 RRULE 문자열 하나.
  //   여기에 프리셋 셀렉트를 다시 그리면 달력과 업무의 반복 UI 가 갈라진다(그 컴포넌트의 주석이
  //   "Q Calendar / (향후) Q Task 가 공유" 라고 적어 둔 자리다 — 이제 실제로 공유한다).
  const [recurrence, setRecurrence] = useState<string | null>(null);

  const [aiEstimating, setAiEstimating] = useState(false);
  const [aiEstReason, setAiEstReason] = useState('');

  // ── 바깥에서 들어온 첫 값 — nonce 가 오를 때마다 적용한다.
  //   폼이 이미 열린 채로 같은 진입이 또 오는 경우(퀵메뉴 '+업무' 두 번)에도 내용이 바뀌어야 한다.
  const appliedNonceRef = useRef(-1);
  useEffect(() => {
    if (!initial || appliedNonceRef.current === initialNonce) return;
    appliedNonceRef.current = initialNonce;
    if (initial.title !== undefined) titleDraft.setText(initial.title);
    if (initial.description !== undefined) descDraft.setText(initial.description);
    if (initial.assigneeId !== undefined) setAssigneeId(initial.assigneeId);
    if (initial.projectId !== undefined && !fixedProjectId) setProjectId(initial.projectId);
    if (initial.startDate !== undefined) setStartDate(initial.startDate);
    if (initial.dueDate !== undefined) setDueDate(initial.dueDate);
    if (initial.fileIds !== undefined) setExistingFileIds(initial.fileIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial, initialNonce]);

  // ── 멤버·프로젝트·태그 사전 — 주면 쓰고, 없으면 읽는다 ──
  const [membersSelf, setMembersSelf] = useState<TaskFormMember[]>([]);
  useEffect(() => {
    if (membersProp || !bizId) return undefined;
    let alive = true;
    (async () => {
      const r = await apiFetch(`/api/businesses/${bizId}/members`);
      if (!r.ok) return;                       // apiFetch 는 throw 하지 않는다
      const j = await r.json().catch(() => null);
      if (!alive || !j?.success) return;
      setMembersSelf((j.data || [])
        .filter((m: { user_id: number | null }) => m.user_id != null)
        .map((m: { user_id: number; name?: string | null; user?: { name?: string } }) => ({
          user_id: m.user_id, name: m.name || m.user?.name || `user ${m.user_id}`,
        })));
    })();
    return () => { alive = false; };
  }, [membersProp, bizId]);
  const members = membersProp ?? membersSelf;

  const [projectsSelf, setProjectsSelf] = useState<TaskFormProject[]>([]);
  useEffect(() => {
    if (projectsProp || !bizId) return undefined;
    let alive = true;
    (async () => {
      const r = await apiFetch(`/api/projects?business_id=${bizId}&status=active`);
      if (!r.ok) return;
      const j = await r.json().catch(() => null);
      if (!alive || !j?.success || !Array.isArray(j.data)) return;
      setProjectsSelf(j.data.map((p: { id: number; name: string }) => ({ id: p.id, name: p.name })));
    })();
    return () => { alive = false; };
  }, [projectsProp, bizId]);
  const projects = projectsProp ?? projectsSelf;
  const projectOptions = useMemo(() => projects.map((p) => ({ value: String(p.id), label: p.name })), [projects]);

  const selfTags = useTaskTagDict(tagDictProp ? null : (bizId || null));
  const tagDict = tagDictProp ?? selfTags.dict;
  const addTagToDict = onTagDictAdd ?? selfTags.add;

  // 프로젝트를 고르면 그 프로젝트의 외부 참여자(고객·협력사·프리랜서)도 담당자 후보가 된다.
  //   프로젝트를 안 골랐으면 내부 멤버만 — 백엔드 assertAssignable 과 같은 규칙.
  const [externals, setExternals] = useState<Array<{ user_id: number; name: string; kind: string }>>([]);
  useEffect(() => {
    if (!bizId || !projectId) { setExternals([]); return undefined; }
    let alive = true;
    (async () => {
      try {
        const r = await apiFetch(`/api/tasks/by-business/${bizId}/assignable-externals?project_id=${projectId}`);
        const j = await r.json();
        if (alive && j.success) {
          setExternals((j.data || []).map((e: { user_id: number; name: string; kind: string }) => ({ user_id: e.user_id, name: e.name, kind: e.kind })));
        }
      } catch { /* 외부 후보는 부가 — 실패해도 내부 멤버로 등록은 된다 */ }
    })();
    return () => { alive = false; };
  }, [bizId, projectId]);

  // 담당자 미선택 시 서버 체인(프로젝트 기본담당자→PM→생성자)이 정하는 **실제 배정자** 미리보기.
  //   값은 서버가 createTask 와 같은 함수로 계산한다(미리보기 ≠ 실제 방지).
  const chainApplies = !assigneeFixedToMe && !isRequest;
  const [resolvedAssignee, setResolvedAssignee] = useState<{ name: string | null; is_me: boolean } | null>(null);
  useEffect(() => {
    if (!chainApplies || !projectId) { setResolvedAssignee(null); return undefined; }
    let cancelled = false;
    (async () => {
      try {
        const r = await apiFetch(`/api/projects/${projectId}`);
        const j = await r.json();
        const rd = j?.success ? j.data?.resolved_default_assignee : null;
        if (!cancelled) setResolvedAssignee(rd ? { name: rd.name, is_me: rd.is_me } : null);
      } catch { if (!cancelled) setResolvedAssignee(null); }
    })();
    return () => { cancelled = true; };
  }, [projectId, chainApplies]);

  // 동작(체인)이 바뀌었으므로 "담당자: 나" 를 고정 문구로 두면 거짓말이 된다.
  const assigneePlaceholder = isRequest
    ? t('add.assigneeRequiredHint', '담당자 선택 (필수)')
    : (resolvedAssignee?.name
      ? (resolvedAssignee.is_me
        ? t('add.assigneeResolvedMe', { name: resolvedAssignee.name, defaultValue: '담당자: {{name}} (나)' })
        : t('add.assigneeResolvedChain', { name: resolvedAssignee.name, defaultValue: '담당자: {{name}} (프로젝트 기본)' }))
      : t('add.assigneeDefault', '담당자: 나'));

  const handleAiEstimate = useCallback(async () => {
    const tt = title.trim();
    if (!tt || aiEstimating) return;
    setAiEstimating(true);
    setAiEstReason('');
    try {
      const r = await apiFetch('/api/tasks/estimate-preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: tt, description: description || undefined }),
      });
      const j = await r.json();
      if (j.success && typeof j.data?.value === 'number') {
        setEstHours(String(j.data.value));
        setAiEstReason(j.data.reason || '');
      }
    } catch (e) { console.warn('[ai-estimate]', e); }
    finally { setAiEstimating(false); }
  }, [title, description, aiEstimating]);

  // ★ 예측시간·반복은 **담당자의 캐파**다 — 남에게 명시적으로 지정한 업무에서는 서버가
  //   §5.7 로 조용히 버린다(services/actions/task_actions.js `isInternalRequest`).
  //   버려질 칸을 보여 주면 사용자는 저장된 줄 알고 잃는다. 그래서 숨기고 **보내지도 않는다**.
  //   미지정(=서버 담당자 체인)은 반복이 살아 있으므로 그대로 노출한다(그 주석의 근거와 같은 규칙).
  const assignedToOther = assigneeId != null && assigneeId !== myId;
  const capacityMine = !isRequest && !assignedToOther;

  const invalid = !title.trim() || (isRequest && !assigneeId);

  const submit = async () => {
    if (submitting || invalid || !bizId) return;
    // 담당자 결정
    //   · 내 업무(오늘·이번 주·전체) : 무조건 나
    //   · 요청 : 선택 필수
    //   · 그 외 : 미선택이면 **null 로 보낸다** — 그래야 서버의 담당자 체인
    //     (프로젝트 기본담당자 → PM → 생성자)이 탄다. 여기서 나로 채우면 그 체인은 영영 죽은 코드다.
    const targetAssignee = assigneeFixedToMe ? myId : assigneeId;
    const finalDue = dueDate || (createDefaults?.due_date ?? null);
    // 정기업무는 due_date 가 anchor 다(백엔드도 검증) — 없으면 반복을 붙이지 않는다
    const recurrenceRule = capacityMine && finalDue ? recurrence : null;
    setSubmitting(true);
    try {
      const r = await (await apiFetch('/api/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: Number(bizId),
          title: title.trim().slice(0, 200),
          description: description.trim() || null,
          assignee_id: targetAssignee,
          project_id: projectId,
          planned_week_start: createDefaults?.planned_week_start ?? null,
          start_date: startDate || null,
          due_date: finalDue,
          estimated_hours: capacityMine && estHours ? Number(estHours) : null,
          recurrence_rule: recurrenceRule,
          workstream_id: workstreamId,
          // 고객 맥락에서 연 폼이면 그 고객의 업무가 된다 — 서버가 워크스페이스 소속을 확인한다
          client_id: fixedClientId,
        }),
      })).json();
      if (!r?.success) return;
      const newTaskId = r.data.id;
      // 1) 새 업로드 파일 — 워크스페이스 업로드 후 fileId 수집
      const uploadedFileIds: number[] = [...existingFileIds];
      for (const f of uploads) {
        try {
          const fd = new FormData();
          fd.append('file', f);
          const upR = await apiFetch(`/api/files/${bizId}`, { method: 'POST', body: fd });
          const upJ = await upR.json();
          if (upJ.success && upJ.data?.id) uploadedFileIds.push(Number(upJ.data.id));
        } catch (err) { console.warn('[task upload]', err); }
      }
      // 2) 모은 fileId·post 를 task 에 link.
      //   ★ 운영 #256 — context 는 'description_attach' 다. 업무를 **추가하는 시점**의 첨부는
      //     의뢰 명세에 딸린 자료이지 수행자가 낸 결과물이 아니다('task' 로 붙이면 상세의
      //     **업무 결과물** 아래에 렌더된다). 권한도 이쪽이 맞다 — 생성자는 곧 작성자다.
      if (uploadedFileIds.length > 0 || existingPostIds.length > 0) {
        try {
          const linkRes = await apiFetch(`/api/tasks/${newTaskId}/attachments/link`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_ids: uploadedFileIds, post_ids: existingPostIds, context: 'description_attach' }),
          });
          if (!linkRes.ok) console.warn('[task attach link] HTTP', linkRes.status);
        } catch (err) { console.warn('[task attach link]', err); }
      }
      // 3) 태그 (#236/#250) — 실패해도 업무 생성은 이미 성공이라 되돌리지 않는다.
      if (tagIds.length > 0) {
        try {
          const tagRes = await apiFetch(`/api/tasks/${newTaskId}/tags`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tag_ids: tagIds }),
          });
          if (!tagRes.ok) console.warn('[task tags] HTTP', tagRes.status);
        } catch (err) { console.warn('[task tags]', err); }
      }
      // 제출이 끝난 뒤에만 초안을 비운다 — 실패를 삼키고 비우면 저장 실패가 곧 글 삭제다.
      titleDraft.clear();
      descDraft.clear();
      onCreated?.(r.data as TaskCreatedTask);
      onClose();
    } catch (e) { console.error('[TaskCreateForm submit]', e); }
    finally { setSubmitting(false); }
  };

  const formatDateRange = (s: string, d: string) => {
    const fmt = (v: string) => (v ? v.slice(5).replace('-', '/') : '');
    if (s && d) return s === d ? fmt(d) : `${fmt(s)} ~ ${fmt(d)}`;
    if (d) return fmt(d);
    if (s) return fmt(s);
    return '';
  };

  const fields = (
    <>
      <AddInput autoFocus={autoFocus} value={title} data-draft-kind={draftKind}
        data-testid="task-create-title"
        placeholder={t('add.placeholder', '업무명 입력 후 Ctrl+Enter 로 저장') as string}
        onChange={(e) => titleDraft.setText(e.target.value)}
        onKeyDown={(e) => {
          if (isEnterAction(e) && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void submit(); }
          if (e.key === 'Escape') onClose();
        }} />
      <AddOptRow>
        {!fixedProjectId && (
        <AddOptField data-field="project">
          <AddOptLabel>{t('add.project', '프로젝트')}</AddOptLabel>
          <PlanQSelect size="sm" isClearable
            placeholder={t('add.projectNone', '선택')}
            value={projectId == null ? null : { value: String(projectId), label: projectOptions.find((p) => p.value === String(projectId))?.label || '-' }}
            onChange={(v) => setProjectId((v as { value?: string })?.value ? Number((v as { value: string }).value) : null)}
            options={projectOptions} />
        </AddOptField>
        )}
        <AddOptField data-field="assignee">
          <AddOptLabel>{t('add.assignee', '담당자')}{isRequest && ' *'}</AddOptLabel>
          <PlanQSelect size="sm" isClearable={!isRequest}
            placeholder={assigneePlaceholder as string}
            value={assigneeId == null ? null : {
              value: String(assigneeId),
              label: (members.find((m) => m.user_id === assigneeId)?.name || externals.find((e) => e.user_id === assigneeId)?.name || '-')
                + (assigneeId === myId ? t('detail.meSuffix', ' (나)') : ''),
            }}
            onChange={(v) => setAssigneeId((v as { value?: string })?.value ? Number((v as { value: string }).value) : null)}
            options={[
              ...members.filter((m) => (isRequest ? m.user_id !== myId : true))
                .map((m) => ({ value: String(m.user_id), label: m.name + (m.user_id === myId ? t('detail.meSuffix', ' (나)') : '') })),
              ...externals.map((e) => ({ value: String(e.user_id), label: e.name, icon: <PartnerKindBadge kind={e.kind} size="xs" /> })),
            ]} />
        </AddOptField>
        <AddOptField data-field="dates" style={{ flex: '1 1 200px' }}>
          <AddOptLabel>{t('add.dateRange', '시작 ~ 마감')}</AddOptLabel>
          <AddDateTrigger ref={dateAnchorRef} type="button" onClick={() => setDatePickerOpen((v) => !v)}>
            {(startDate || dueDate) ? formatDateRange(startDate, dueDate) : <AddDatePH>{t('add.dateRangePlaceholder', '기간 선택')}</AddDatePH>}
          </AddDateTrigger>
          {datePickerOpen && (
            <CalendarPicker isOpen anchorRef={dateAnchorRef}
              startDate={startDate || dueDate}
              endDate={dueDate || startDate}
              onRangeSelect={(s, d) => { setStartDate(s || ''); setDueDate(d || ''); }}
              onClose={() => setDatePickerOpen(false)} />
          )}
        </AddOptField>
        {/* 요청에서는 예측시간·AI 추천을 숨긴다 — estimated_hours 는 담당자만(PERMISSION_MATRIX §5.7).
            요청자는 명세만 쓴다(기대 시간은 설명에). */}
        {capacityMine && (
          <AddOptField data-field="est" style={{ flex: '0 0 200px' }}>
            <AddOptLabel>{t('add.estHours', '예측(h)')}</AddOptLabel>
            <AddEstWrap>
              <AddEstNumberInput type="number" step="0.5" min="0" placeholder="—"
                value={estHours} onChange={(e) => { setEstHours(e.target.value); setAiEstReason(''); }} />
              <AddEstAiBtn type="button" disabled={!title.trim() || aiEstimating} onClick={handleAiEstimate}
                title={!title.trim()
                  ? (t('add.estAiNeedTitle', '제목 입력 후 클릭하면 AI 가 추천합니다') as string)
                  : (t('add.estAiHint', 'AI 가 제목·설명으로 예측 시간을 추천합니다') as string)}>
                {aiEstimating ? '…' : (estHours ? t('add.estAiAgain', 'AI 다시') : t('add.estAi', 'AI 추천'))}
              </AddEstAiBtn>
            </AddEstWrap>
            {aiEstReason && <AddEstReason title={aiEstReason}>{aiEstReason}</AddEstReason>}
          </AddOptField>
        )}
        {/* 운영 #236/#250 — 태그를 여기서 고르고 새로 만든다. 사전이 비어 있어도 항상 보인다:
            이 자리가 유일한 진입점이므로 숨기면 태그 기능 전체가 발견 불가가 된다. */}
        {workstreams && (
          <AddOptField data-field="workstream" style={{ flex: '1 1 200px' }}>
            <AddOptLabel>{t('add.workstream', '업무 그룹')}</AddOptLabel>
            <PlanQSelect size="sm" isClearable
              placeholder={t('add.workstreamNone', '그룹 없음') as string}
              value={workstreamId == null ? null : {
                value: String(workstreamId),
                label: workstreams.find((w) => w.id === workstreamId)?.title || String(workstreamId),
              }}
              onChange={(v) => setWorkstreamId((v as { value?: string })?.value ? Number((v as { value: string }).value) : null)}
              options={workstreams.filter((w) => !w.status || w.status === 'active')
                .map((w) => ({ value: String(w.id), label: w.title }))} />
          </AddOptField>
        )}
        <AddOptField data-field="tags" style={{ flex: '1 1 220px', minWidth: 200 }}>
          <AddOptLabel>{t('add.tags', '태그')}</AddOptLabel>
          <TagPicker
            bizId={bizId || null}
            dict={tagDict}
            value={tagDict.filter((g) => tagIds.includes(g.id))}
            onChange={setTagIds}
            onDictAdd={addTagToDict} />
        </AddOptField>
      </AddOptRow>
      {/* 반복 — 공용 RecurrencePicker(Q Calendar 와 같은 것). 마감일이 anchor 다.
          남에게 명시적으로 지정한 업무에서는 서버가 버리므로(§5.7) 칸 자체를 내지 않는다. */}
      {capacityMine && (
        <RecurRow data-field="recur">
          <RecurrencePicker value={recurrence} onChange={setRecurrence}
            anchorDate={dueDate || createDefaults?.due_date || null} />
        </RecurRow>
      )}
      <DescEditorWrap data-field="desc">
        <RichEditor
          value={description}
          onChange={descDraft.setText}
          placeholder={t('add.descPlaceholder', '업무 설명 — 이미지 붙여넣기·드래그 지원') as string}
          uploadUrl={bizId ? `/api/files/${bizId}` : undefined}
          minHeight={layout === 'inline' ? 100 : 120}
        />
      </DescEditorWrap>
      <AttachToggleRow data-field="attach">
        <AttachToggleBtn type="button" data-testid="task-add-attach" onClick={() => setShowAttach((v) => !v)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
          {showAttach ? t('add.attachHide', '파일·문서 첨부 닫기') : t('add.attachShow', '파일·문서 첨부')}
          {(uploads.length + existingFileIds.length + existingPostIds.length) > 0 &&
            <AttachCount>{uploads.length + existingFileIds.length + existingPostIds.length}</AttachCount>}
        </AttachToggleBtn>
      </AttachToggleRow>
      {showAttach && bizId && (
        <AttachInlineBox>
          <AttachmentField
            businessId={Number(bizId)}
            uploads={uploads}
            onUploadsChange={setUploads}
            existingFileIds={existingFileIds}
            onExistingFileIdsChange={setExistingFileIds}
            includePosts
            existingPostIds={existingPostIds}
            onExistingPostIdsChange={setExistingPostIds}
          />
        </AttachInlineBox>
      )}
    </>
  );

  if (layout === 'inline') {
    return (
      <>
        {/* data-task-add-form — 바깥클릭 핸들러가 폼 내부 클릭을 외부로 읽지 않게 하는 마커 */}
        <InlineAddBox data-task-add-form data-testid="task-create-form">
          {fields}
          <AddBtnRow>
            <AddCancelBtn type="button" onClick={onClose}>{t('add.cancel', '취소')}</AddCancelBtn>
            <AddSaveBtn type="button" data-testid="task-create-submit" onClick={submit} disabled={submitting || invalid}>
              {submitting ? t('add.saving', '저장 중...') : (submitLabel ?? t('add.save', '추가'))}
            </AddSaveBtn>
          </AddBtnRow>
        </InlineAddBox>
      </>
    );
  }

  return (
    <>
      <CreateDrawer
        open wide
        onClose={onClose}
        title={drawerTitle ?? (isRequest ? t('add.reqBtn', '요청 추가') : t('add.btn', '업무 추가'))}
        onSubmit={submit}
        submitting={submitting}
        submitLabel={submitLabel ?? t('add.save', '추가')}
        submitDisabled={invalid}
        submitTestId="task-create-submit"
      >
        <PanelAddForm data-testid="task-create-form">{fields}</PanelAddForm>
      </CreateDrawer>
    </>
  );
};

export default TaskCreateForm;

// ── 스타일 — QTaskPage 에서 그대로 옮겨왔다(두 벌이 되지 않게 여기 한 곳에 둔다) ──
const AddInput = styled.input`flex:1 1 auto;min-width:0;font-size:0.875rem;color:#0F172A;border:1px solid #14B8A6;background:#F0FDFA;padding:6px 10px;border-radius:6px;font-family:inherit;&:focus{outline:none;box-shadow:0 0 0 2px rgba(20,184,166,0.15);}&::placeholder{color:#94A3B8;}`;
const InlineAddBox = styled.div`display:flex;flex-direction:column;gap:8px;margin:8px 14px 20px;padding:12px;background:#F8FAFC;border:1px solid #14B8A6;border-radius:10px;`;
const PanelAddForm = styled.div`display:flex;flex-direction:column;gap:10px;padding:20px;background:transparent;border:none;`;
const AddOptRow = styled.div`display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start;`;
const DescEditorWrap = styled.div`background:#FFF;border:1px solid #E2E8F0;border-radius:8px;padding:0;overflow:hidden;&:focus-within{border-color:#14B8A6;}`;
const AttachToggleRow = styled.div`display:flex;`;
const AttachToggleBtn = styled.button`display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;font-size:0.75rem;font-weight:600;color:#475569;cursor:pointer;font-family:inherit;&:hover{background:#F1F5F9;border-color:#CBD5E1;}`;
const AttachCount = styled.span`display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;background:#14B8A6;color:#FFF;border-radius:8px;font-size:0.625rem;font-weight:700;`;
const AttachInlineBox = styled.div`background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:14px;`;
const AddOptField = styled.div`flex:1 1 140px;min-width:120px;display:flex;flex-direction:column;gap:3px;`;
const AddOptLabel = styled.label`font-size:0.6875rem;color:#64748B;font-weight:600;`;
const AddEstWrap = styled.div`display:flex;gap:6px;align-items:stretch;`;
const AddEstNumberInput = styled.input`width:60px;flex-shrink:0;height:30px;padding:0 8px;font-size:0.8125rem;color:#0F172A;border:1px solid #E2E8F0;border-radius:6px;background:#FFF;font-family:inherit;text-align:right;&:focus{outline:none;border-color:#14B8A6;}`;
const AddEstAiBtn = styled.button`flex:1;min-width:0;height:30px;padding:0 10px;font-size:0.75rem;font-weight:600;color:#0D9488;background:#F0FDFA;border:1px solid #99F6E4;border-radius:6px;cursor:pointer;font-family:inherit;letter-spacing:0.2px;display:inline-flex;align-items:center;justify-content:center;white-space:nowrap;&:hover:not(:disabled){background:#CCFBF1;border-color:#14B8A6;}&:disabled{opacity:0.5;cursor:not-allowed;}`;
const AddEstReason = styled.div`font-size:0.625rem;color:#64748B;margin-top:2px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px;`;
const AddDateTrigger = styled.button`height:30px;padding:0 10px;font-size:0.8125rem;color:#0F172A;border:1px solid #E2E8F0;border-radius:6px;background:#FFF;font-family:inherit;cursor:pointer;text-align:left;display:inline-flex;align-items:center;&:hover{border-color:#CBD5E1;}&:focus{outline:none;border-color:#14B8A6;box-shadow:0 0 0 2px rgba(20,184,166,0.15);}`;
const AddDatePH = styled.span`color:#94A3B8;`;
const AddBtnRow = styled.div`display:flex;justify-content:flex-end;gap:6px;`;
const AddSaveBtn = styled.button`flex:0 0 auto;padding:6px 14px;font-size:0.8125rem;font-weight:600;background:#14B8A6;color:#FFFFFF;border:none;border-radius:6px;cursor:pointer;&:hover:not(:disabled){background:#0D9488;}&:disabled{background:#CBD5E1;cursor:not-allowed;}`;
const AddCancelBtn = styled.button`flex:0 0 auto;padding:6px 10px;font-size:0.8125rem;color:#64748B;background:transparent;border:1px solid #E2E8F0;border-radius:6px;cursor:pointer;&:hover{background:#F8FAFC;color:#0F172A;}`;
const RecurRow = styled.div`display:flex;flex-direction:column;gap:6px;padding:8px 10px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:6px;`;
