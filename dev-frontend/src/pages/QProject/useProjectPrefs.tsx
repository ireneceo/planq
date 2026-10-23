// 프로젝트 목록의 내 즐겨찾기(별)·직접 정렬 상태 (2026-10-23, docs/PROJECT_PREFS_DESIGN.md · Fable DESIGN-OK).
//   QProjectPage 에서 뺐다 — 정렬 선택 파생 · 별 켜고 끄기 · 순서 저장(자리 바꾸기) · 초기화 · 실시간 신호.
//   정렬 술어 자체는 utils/projectOrder 한 벌이다(여기서 다시 쓰지 않는다).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import { hasManualOrder, type ProjectPrefFields } from '../../utils/projectOrder';
import { setProjectPinned, saveProjectOrder, resetProjectOrder, PROJECT_PREF_EVENT } from '../../services/projectPrefs';
import { onSocket } from '../../services/socket';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';

export type SortBy = 'manual' | 'recent' | 'name' | 'progress' | 'deadline';

interface Args<T extends ProjectPrefFields> {
  bizId: number | null;
  projects: T[];
  initialProjects: T[];
  setProjects: React.Dispatch<React.SetStateAction<T[]>>;
  load: () => Promise<void> | void;
  t: (k: string, fb?: string) => string;
}

export function useProjectPrefs<T extends ProjectPrefFields>({ bizId, projects, initialProjects, setProjects, load, t }: Args<T>) {
  // 정렬 — 기본값은 파생한다(Fable): 내 직접 정렬 번호가 있으면 «직접 정렬», 없으면 «최근순».
  //   끌어 놓기·⋯ 위/아래가 곧 번호를 만드니 «끌면 직접 정렬로 바뀐다» 가 저장 없이 성립하고, 기기마다 같다.
  //   셀렉트로 고른 다른 정렬은 화면 상태만(sortTouched) — 서버 신호로 다시 읽어도 사람이 고른 것을 덮지 않는다.
  const [sortBy, setSortByState] = useState<SortBy>(() => (hasManualOrder(initialProjects) ? 'manual' : 'recent'));
  const sortTouched = useRef(false);
  const setSortBy = useCallback((v: SortBy) => { sortTouched.current = true; setSortByState(v); }, []);
  useEffect(() => {
    if (sortTouched.current) return;
    setSortByState(hasManualOrder(projects) ? 'manual' : 'recent');
  }, [projects]);

  // 내 다른 기기·탭에서 별·순서가 바뀌면 다시 읽는다(서버는 신호만 — 규칙 16) + 탭 복귀 안전망.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let timer: number | null = null;
    const off = onSocket<{ business_id: number }>(PROJECT_PREF_EVENT, (d) => {
      if (Number(d?.business_id) !== Number(bizId)) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => { void loadRef.current(); }, 250);
    });
    return () => { off(); if (timer) window.clearTimeout(timer); };
  }, [bizId]);
  useVisibilityRefresh(useCallback(() => { void loadRef.current(); }, []));

  // 별 — 대화방 별과 같은 방식: 낙관적으로 바꾸고 저장, 실패하면 되돌린다.
  const [prefError, setPrefError] = useState<string | null>(null);
  const togglePin = useCallback(async (projectId: number, next: boolean) => {
    const nowIso = next ? new Date().toISOString() : null;
    let prevVal: string | null = null;
    setProjects((prev) => prev.map((p) => {
      if (p.id !== projectId) return p;
      prevVal = p.my_pinned_at ?? null;
      return { ...p, my_pinned_at: nowIso };
    }));
    const ok = await setProjectPinned(projectId, next);
    if (!ok) {
      setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, my_pinned_at: prevVal } : p)));
      setPrefError(t('star.failed', '즐겨찾기를 저장하지 못했습니다. 다시 눌러 주세요.'));
    }
  }, [setProjects, t]);

  // 새 표시 순서(ids) 저장 — 서버와 같은 «자리 바꾸기»(받은 id 들이 내 기존 순서에서 차지하던 자리에 다시 넣는다).
  //   필터 밖 프로젝트의 상대 순서는 그대로다. 놓는 순간 정렬이 «직접 정렬» 로 바뀐다(Irene 요청).
  const applyOrder = useCallback(async (ids: number[]) => {
    if (!bizId || !ids.length) return;
    const before = projects;
    const prevSort = sortBy;
    const full = projects.filter((p) => p.my_sort_order != null)
      .sort((a, b) => (a.my_sort_order as number) - (b.my_sort_order as number)).map((p) => p.id);
    const inFull = new Set(full);
    for (const id of ids) if (!inFull.has(id)) full.push(id);
    const moving = new Set(ids);
    const slots: number[] = [];
    full.forEach((id, i) => { if (moving.has(id)) slots.push(i); });
    slots.forEach((slot, k) => { full[slot] = ids[k]; });
    const pos = new Map(full.map((id, i) => [id, i]));
    setProjects((prev) => prev.map((p) => (pos.has(p.id) ? { ...p, my_sort_order: pos.get(p.id) as number } : p)));
    sortTouched.current = false;
    setSortByState('manual');
    const ok = await saveProjectOrder(bizId, ids);
    if (!ok) {
      setProjects(before);
      setSortByState(prevSort);
      setPrefError(t('order.failed', '순서를 저장하지 못했습니다. 다시 옮겨 주세요.'));
    }
  }, [bizId, projects, setProjects, sortBy, t]);

  const [resetOpen, setResetOpen] = useState(false);
  const doResetOrder = useCallback(async () => {
    setResetOpen(false);
    if (!bizId) return;
    const before = projects;
    setProjects((prev) => prev.map((p) => ({ ...p, my_sort_order: null })));
    sortTouched.current = false;
    setSortByState('recent');
    const ok = await resetProjectOrder(bizId);
    if (!ok) { setProjects(before); setSortByState('manual'); setPrefError(t('order.failed', '순서를 저장하지 못했습니다. 다시 옮겨 주세요.')); }
  }, [bizId, projects, setProjects, t]);

  // 순서 초기화 확인(순서는 복구할 수 없으니 묻는다) · 저장 실패 안내
  const dialogs = (
    <>
      <ConfirmDialog isOpen={resetOpen} onClose={() => setResetOpen(false)} onConfirm={() => { void doResetOrder(); }}
        title={t('order.resetTitle', '직접 정한 순서를 지울까요?')}
        message={t('order.resetBody', '끌어서 정한 순서가 사라지고 최근순으로 돌아갑니다. 즐겨찾기(별)는 그대로입니다.')}
        confirmText={t('order.resetConfirm', '순서 초기화')} variant="warning" />
      <ConfirmDialog isOpen={!!prefError} onClose={() => setPrefError(null)} onConfirm={() => setPrefError(null)}
        title={t('order.errorTitle', '저장하지 못했습니다')} message={prefError || ''}
        confirmText={t('order.ok', '확인')} variant="info" />
    </>
  );

  return { sortBy, setSortBy, togglePin, applyOrder, openReset: () => setResetOpen(true), dialogs };
}
