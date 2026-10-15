// 문서 작성·수정의 «업무 연결» 칸 (2026-10-15, Irene «문서작성/수정에도 업무연결을 추가해줘»)
//   ★ 연결의 정본은 새로 만들지 않는다 — 업무 결과물 첨부(task_attachments.post_id, context 'task')다.
//     걸기 = 기존 POST /api/tasks/:taskId/attachments/link(업무 canAccessTask + 문서 canReadPost 를 서버가 본다)
//     떼기 = 기존 DELETE /api/tasks/attachments/:id(같은 술어 taskAttachmentLink.canRemoveTaskAttachment — × 는 can_unlink 일 때만)
//     보이는 목록 = 서버 linked_tasks(보는 사람 기준) 그대로. 바꾼 뒤에는 문서를 다시 읽는다(화면이 따로 모으지 않는다).
//   고르는 부품은 일정과 같은 공용 TaskLinkPicker.
//   새 문서(아직 id 없음)는 고른 업무를 들고 있다가 문서가 처음 저장돼 id 가 생기는 순간 건다.
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import AutoSaveField, { type AutoSaveHandle } from '../Common/AutoSaveField';
import TaskLinkPicker from '../Common/TaskLinkPicker';
import LinkedTaskChips, { type LinkedTaskRef } from '../Common/LinkedTaskChips';
import { apiFetch } from '../../contexts/AuthContext';
import { fetchPost } from '../../services/posts';

type Op = { kind: 'add'; taskId: number } | { kind: 'remove'; attachmentId: number };

interface Props {
  postId: number | null;
  businessId: number;
  tasks: LinkedTaskRef[];
  onTasksChange: (tasks: LinkedTaskRef[]) => void;
  /** 업무 결과물 요청에서 넘어온 새 문서 — 그 업무는 서버가 액션으로 건다(중복으로 걸지 않는다) */
  fromTaskId?: number | null;
  /** 아직 못 건 업무 — 저장 버튼으로 바로 만들고 보기로 넘어가면 이 칸이 사라지므로 부모가 받아 건다 */
  onPendingChange?: (taskIds: number[]) => void;
}

export async function linkTask(taskId: number, postId: number) {
  const r = await apiFetch(`/api/tasks/${taskId}/attachments/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ post_ids: [postId], context: 'task' }),
  });
  if (!r.ok) throw new Error(`link ${r.status}`);
}

async function unlinkAttachment(attachmentId: number) {
  const r = await apiFetch(`/api/tasks/attachments/${attachmentId}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`unlink ${r.status}`);
}

const DocTaskLinkField: React.FC<Props> = ({ postId, businessId, tasks, onTasksChange, fromTaskId, onPendingChange }) => {
  const { t } = useTranslation('common');
  const saveRef = useRef<AutoSaveHandle>(null);
  const opsRef = useRef<Op[]>([]);
  const [pending, setPending] = useState<LinkedTaskRef[]>([]);
  const [failed, setFailed] = useState(false);
  const onChangeRef = useRef(onTasksChange);
  onChangeRef.current = onTasksChange;

  const reread = async (id: number) => {
    const fresh = await fetchPost(id);
    if (fresh) onChangeRef.current((fresh.linked_tasks || []) as LinkedTaskRef[]);
  };

  // 저장(✓/!) — 쌓인 걸기·떼기를 순서대로 보낸다. 실패는 던진다(삼키면 화면만 바뀐 채 남는다).
  const save = async () => {
    if (!postId) return;
    const ops = opsRef.current.splice(0);
    try {
      for (const op of ops) {
        if (op.kind === 'add') await linkTask(op.taskId, postId);
        else await unlinkAttachment(op.attachmentId);
      }
    } finally {
      await reread(postId).catch(() => null);
    }
  };

  const pendRef = useRef(onPendingChange);
  pendRef.current = onPendingChange;
  useEffect(() => { pendRef.current?.(pending.map((x) => x.id)); }, [pending]);
  useEffect(() => () => { pendRef.current?.([]); }, []);

  // 새 문서 — id 가 생기는 순간 들고 있던 업무를 건다
  useEffect(() => {
    if (!postId || pending.length === 0) return;
    const list = pending;
    setPending([]);
    (async () => {
      let bad = false;
      for (const tk of list) {
        try { await linkTask(tk.id, postId); } catch { bad = true; }
      }
      setFailed(bad);
      await reread(postId).catch(() => null);
    })();
  }, [postId]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown: LinkedTaskRef[] = postId ? tasks : pending;
  const exclude = [...shown.map((x) => x.id), ...(fromTaskId ? [fromTaskId] : [])];

  const pick = (task: { id: number; title: string } | null) => {
    if (!task) return;
    setFailed(false);
    if (!postId) {
      setPending((prev) => (prev.some((x) => x.id === task.id) ? prev : [...prev, { id: task.id, title: task.title, status: '', project_id: null, can_unlink: true }]));
      return;
    }
    opsRef.current.push({ kind: 'add', taskId: task.id });
    // 화면 먼저 — 저장이 끝나면 서버 목록으로 갈아끼운다
    onChangeRef.current([...tasks, { id: task.id, title: task.title, status: '', project_id: null, via: 'attachment' }]);
  };

  const remove = (tk: LinkedTaskRef) => {
    setFailed(false);
    if (!postId) { setPending((prev) => prev.filter((x) => x.id !== tk.id)); return; }
    if (!tk.attachment_id) return;
    opsRef.current.push({ kind: 'remove', attachmentId: tk.attachment_id });
    onChangeRef.current(tasks.filter((x) => x.id !== tk.id));
    saveRef.current?.triggerSave();
  };

  const picker = (
    <TaskLinkPicker businessId={businessId} value={null} onChange={pick} excludeIds={exclude} testId="post-task-link" />
  );

  return (
    <Wrap data-testid="post-task-link-field">
      {shown.length > 0 && (
        <Chips><LinkedTaskChips tasks={shown} onRemove={remove} /></Chips>
      )}
      <PickerSlot>
        {postId ? (
          // 걸기는 고르는 즉시(onChange 를 래퍼가 감싸 저장을 부른다), 떼기는 × 가 triggerSave 로
          <AutoSaveField key={`post-tasklink-${postId}`} ref={saveRef} type="select" onSave={save}>
            {picker}
          </AutoSaveField>
        ) : picker /* autosave-exempt: 아직 문서가 없다 — 첫 저장으로 id 가 생기면 위 이펙트가 건다 */}
      </PickerSlot>
      {failed && <Fail role="alert">{t('taskLink.linkFailed')}</Fail>}
    </Wrap>
  );
};

export default DocTaskLinkField;

const Wrap = styled.div`
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0;
  flex: 1 1 260px; max-width: 100%;
`;
const Chips = styled.div`display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; min-width: 0;`;
const PickerSlot = styled.div`flex: 1 1 200px; min-width: 180px; max-width: 280px;`;
const Fail = styled.span`flex-basis: 100%; font-size: 0.75rem; color: #B91C1C;`;
