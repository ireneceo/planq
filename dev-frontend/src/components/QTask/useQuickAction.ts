// 팝아웃 행 퀵액션 실행 — TaskPopoutView 에서 절출(god-file 래칫).
//   화면이 아니라 **동작**이라 파일이 갈리는 편이 읽기도 쉽다. 규칙 판정은 popoutQuickAction.ts.
import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';

interface HasStatus { id: number; status: string }

export function useQuickAction<T extends HasStatus>(opts: {
  setTasks: React.Dispatch<React.SetStateAction<T[]>>;
  silentLoad: () => Promise<void> | void;
}) {
  const { setTasks, silentLoad } = opts;
  const { t } = useTranslation('qtask');
  // ★ 2026-08-24 (Irene: "팝아웃 체크박스 반응이 너무 느려? 기본 리스트랑 달라")
  //   옛 구현은 단일 busyId 라 **한 행이 처리 중이면 모든 행이 잠겼고**, 낙관적 반영이 없어
  //   POST + 전체 재조회가 끝나야 체크가 보였다(왕복 두 번). 메인 리스트는 즉시 반영한다.
  //   → 진행 중인 id 집합으로 바꿔 다른 행은 계속 눌리게 하고, 상태는 먼저 뒤집는다.
  const [busyIds, setBusyIds] = useState<ReadonlySet<number>>(() => new Set());
  const [rowErr, setRowErr] = useState<{ id: number; msg: string } | null>(null);

  const actErrMsg = useCallback((raw?: string) => {
    // 백엔드는 에러 코드를 message 로 그대로 내보낸다(계약). 일부 코드는 뒤에 설명이 붙어 온다.
    const code = String(raw || '').split(' ')[0];
    const map: Record<string, string> = {
      only_assignee: t('popout.act.errOnlyAssignee', '담당자만 처리할 수 있습니다'),
      task_closed: t('popout.act.errClosed', '이미 종료된 업무입니다'),
      task_on_hold: t('popout.act.errOnHold', '보류 중인 업무입니다'),
      not_ready_for_complete: t('popout.act.errNeedsReview', '컨펌을 거쳐야 완료됩니다'),
      no_reviewers_add_first: t('popout.act.errNoReviewers', '컨펌자를 먼저 지정하세요'),
      nothing_to_revert: t('popout.act.errNothingToRevert', '되돌릴 이력이 없습니다'),
      forbidden_revert: t('popout.act.errForbiddenRevert', '되돌릴 권한이 없습니다'),
    };
    return map[code] || t('popout.act.errGeneric', '처리하지 못했습니다');
  }, [t]);

  const runAction = useCallback(async (id: number, path: string) => {
    if (busyIds.has(id)) return;                       // 같은 행 연타만 막는다 (다른 행은 자유)
    setBusyIds((prev) => new Set(prev).add(id));
    setRowErr(null);

    // 낙관적 반영 — 서버 왕복을 기다리지 않고 먼저 뒤집는다.
    //   되돌릴 수 있도록 이전 상태를 스냅샷으로 잡아둔다(실패 시 그대로 복원).
    //   ★ 낙관 상태를 계산으로 만들지 않는다: /complete → completed, /revert-status → in_progress
    //     두 경로만 낙관 대상이고, 나머지(submit-review 등)는 서버 판정이 복잡해 건드리지 않는다.
    const optimistic = path === '/complete' ? 'completed' : (path === '/revert-status' ? 'in_progress' : null);
    let snapshot: T[] | null = null;
    if (optimistic) {
      setTasks((prev) => {
        snapshot = prev;
        return prev.map((tk) => (tk.id === id ? { ...tk, status: optimistic } : tk));
      });
    }

    try {
      const r = await apiFetch(`/api/tasks/${id}${path}`, { method: 'POST' });
      // apiFetch 는 throw 하지 않는다 — res.ok 를 반드시 본다 (memory: apifetch_no_throw)
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setRowErr({ id, msg: actErrMsg(j?.message) });
        if (snapshot) setTasks(snapshot);              // 거절당했다 — 낙관 반영을 되돌린다
      }
      // 성공·실패 무관 서버 진실로 재동기. 다른 창이 먼저 바꿨다면 이 행은 여기서 사라진다.
      await silentLoad();
    } catch {
      setRowErr({ id, msg: t('popout.act.errNetwork', '연결에 실패했습니다') });
      if (snapshot) setTasks(snapshot);
    } finally {
      setBusyIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }
  }, [busyIds, silentLoad, actErrMsg, t]);
  return { busyIds, rowErr, setRowErr, runAction };
}
