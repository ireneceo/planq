// 프로젝트 업무 목록의 추진과제(워크스트림) 만들기·이름·삭제·순서 — ProjectTaskList 에서 나눴다(2026-10-27, 800줄 한도).
// 단일 진실 원천 project_workstreams. 바꾸면 onWorkstreamsChanged 로 캔버스·타임라인이 같이 다시 읽는다.
import { useEffect, useState } from 'react';
import type { TFunction } from 'i18next';
import { createWorkstream, updateWorkstream, deleteWorkstream, reorderWorkstreams, type Workstream } from '../../services/projectCanvas';

export default function useWorkstreamOps({ projectId, workstreams, onWorkstreamsChanged, onAddGroupTopClose, addGroupTop, t }: {
  projectId: number | null;
  workstreams?: Workstream[];
  onWorkstreamsChanged?: () => void;
  onAddGroupTopClose?: () => void;
  addGroupTop?: boolean;
  t: TFunction;
}) {
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [groupTitleDraft, setGroupTitleDraft] = useState('');
  const [headerMenuGroupId, setHeaderMenuGroupId] = useState<number | null>(null);  // 그룹 헤더 ⋯ 메뉴
  const [addingGroup, setAddingGroup] = useState(false);
  const [newGroupTitle, setNewGroupTitle] = useState('');
  const [groupBusy, setGroupBusy] = useState(false);
  // 만들면 서버가 맨 뒤(max+1)에 넣는다 — 아래 버튼은 그 자리(마지막 그룹 다음)에 있다.
  //   맨 위 입력줄(atTop)은 만들기가 끝난 뒤 순서를 [새 것, ...기존] 으로 다시 보낸다. 화면 순서를 먼저 바꾸지 않는다 —
  //   순서 저장이 실패하면 다시 읽고 알린다(그룹이 몰래 맨 아래로 가면 원래 «위로 들어가 헷갈려» 가 돌아온다 · Fable).
  const [groupErr, setGroupErr] = useState('');
  // 오류 문구는 붙어 남지 않는다 — 6초 뒤 · 입력줄을 다시 열 때 · 다른 그룹 작업이 성공할 때 지운다(Fable 완료 점검 B2)
  useEffect(() => {
    if (!groupErr) return;
    const h = setTimeout(() => setGroupErr(''), 6000);
    return () => clearTimeout(h);
  }, [groupErr]);
  useEffect(() => { if (addingGroup || addGroupTop) setGroupErr(''); }, [addingGroup, addGroupTop]);
  const submitNewGroup = async (atTop = false) => {
    if (!projectId || !newGroupTitle.trim() || groupBusy) return;
    setGroupBusy(true); setGroupErr('');
    try {
      const ws = await createWorkstream(projectId, { title: newGroupTitle.trim() });
      if (atTop) {
        const rest = [...(workstreams || [])].sort((a, b) => a.order_index - b.order_index).map(w => w.id);
        try { await reorderWorkstreams(projectId, [ws.id, ...rest.filter(id => id !== ws.id)]); }
        catch { setGroupErr(t('list.group.topFailed', '맨 위로 옮기지 못해 맨 아래에 추가했어요') as string); }
      }
      setNewGroupTitle(''); setAddingGroup(false); onAddGroupTopClose?.();
      onWorkstreamsChanged?.();
    } catch { setGroupErr(t('list.group.addFailed', '추진과제를 만들지 못했어요') as string); } finally { setGroupBusy(false); }
  };
  const renameGroup = async (wsId: number) => {
    const ws = (workstreams || []).find(w => w.id === wsId);
    setEditingGroupId(null);
    if (!projectId || !ws || !groupTitleDraft.trim() || groupTitleDraft.trim() === ws.title) return;
    try { await updateWorkstream(projectId, wsId, { title: groupTitleDraft.trim() }); setGroupErr(''); onWorkstreamsChanged?.(); } catch { /* ignore */ }
  };
  const removeGroup = async (wsId: number) => {
    setHeaderMenuGroupId(null);
    if (!projectId || groupBusy) return;
    setGroupBusy(true);
    try { await deleteWorkstream(projectId, wsId); setGroupErr(''); onWorkstreamsChanged?.(); } catch { /* ignore */ } finally { setGroupBusy(false); }
  };
  const moveGroup = async (wsId: number, dir: -1 | 1) => {
    setHeaderMenuGroupId(null);
    const ordered = [...(workstreams || [])].sort((a, b) => a.order_index - b.order_index);
    const idx = ordered.findIndex(w => w.id === wsId);
    const swap = idx + dir;
    if (!projectId || idx < 0 || swap < 0 || swap >= ordered.length) return;
    [ordered[idx], ordered[swap]] = [ordered[swap], ordered[idx]];
    try { await reorderWorkstreams(projectId, ordered.map(w => w.id)); setGroupErr(''); onWorkstreamsChanged?.(); } catch { /* ignore */ }
  };

  return {
    editingGroupId, setEditingGroupId, groupTitleDraft, setGroupTitleDraft, headerMenuGroupId, setHeaderMenuGroupId,
    addingGroup, setAddingGroup, newGroupTitle, setNewGroupTitle, groupErr,
    submitNewGroup, renameGroup, removeGroup, moveGroup,
  };
}
