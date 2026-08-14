// useCalendarSyncStatus — 구글 캘린더 연동 상태 + "지금 당겨오기" 를 한 곳에 모은다 (#242).
//
// 왜 훅으로 뺐나: QCalendarPage 가 800줄(컴포넌트 god-file 기준)을 넘겼다. 페이지는 일정 표시가
//   본업이고, 연동 상태·폴링 당김은 그와 독립된 관심사라 여기로 옮긴다.
//
// 두 가지를 제공한다
//   ① status  — 배너가 상태를 말하고 그 자리에서 고칠 수 있게 하는 값들(재연결 필요·폴링 주기·마지막 확인)
//   ② pull()  — 구글 변경분을 **우리가** 당겨온다. 화면 진입·foreground 복귀 시 자동 호출한다.
//               버튼을 눌러야 최신이 되는 것은 사용자에게 떠넘기는 것이다 — #242 재신고의 실체가 그것이었다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { getVideoStatus, syncCalendarNow } from '../services/calendar';
import { onSocket } from '../services/socket';
import type { CalendarSyncStatus } from '../components/Calendar/CalendarSyncNotice';

interface Result {
  status: CalendarSyncStatus | null;
  /** Meet 축 — 워크스페이스 또는 개인 연동 중 하나라도 회의를 만들 수 있는가. */
  gcalCanWrite: boolean;
  /** 팀 캘린더 쓰기 가능 — "구글 캘린더로 보내기" 게이트. */
  workspaceCanWrite: boolean;
  reload: () => void;
  /** 구글 → PlanQ 당겨오기. 반영분이 있으면 true (호출부가 화면을 다시 그린다). */
  pull: () => Promise<boolean>;
}

/**
 * @param onDataChanged 연동 상태가 바뀌었다는 신호를 받았을 때 화면 데이터도 다시 읽고 싶으면 넘긴다.
 */
export function useCalendarSyncStatus(
  bizId: number | null | undefined,
  onDataChanged?: () => void,
): Result {
  // 콜백을 ref 에 담는다 — 매 렌더 새로 만들어지는 함수를 deps 에 넣으면 구독이 계속 재등록된다.
  const changedRef = useRef(onDataChanged);
  changedRef.current = onDataChanged;
  const [status, setStatus] = useState<CalendarSyncStatus | null>(null);
  const [gcalCanWrite, setGcalCanWrite] = useState(false);
  const [workspaceCanWrite, setWorkspaceCanWrite] = useState(false);

  const reload = useCallback(() => {
    if (!bizId) return;
    getVideoStatus(bizId)
      .then((s) => {
        setGcalCanWrite(!!s.gcal_can_write);
        setWorkspaceCanWrite(!!s.workspace_can_write);
        setStatus(s as unknown as CalendarSyncStatus);
      })
      .catch(() => {
        setGcalCanWrite(false);
        setWorkspaceCanWrite(false);
        setStatus(null);
      });
  }, [bizId]);

  useEffect(() => { reload(); }, [reload]);

  // 연동 상태가 바뀌면(오너의 재연결·백필) **열려 있는 모든 화면**이 즉시 사실을 반영해야 한다.
  //   이게 없으면 오너가 고친 뒤에도 다른 멤버 화면에는 닫을 수도 없는 "끊김" 배너가 그대로 남는다 —
  //   "고쳤다는데 화면은 아직 고장이라고 말하는" 상태가 바로 #242 를 만든 병리다.
  //   room join 은 페이지가 이미 한다(business:{id}).
  useEffect(() => {
    if (!bizId) return undefined;
    return onSocket('calendar:sync-changed', () => { reload(); changedRef.current?.(); });
  }, [bizId, reload]);

  const pull = useCallback(async () => {
    if (!bizId) return false;
    try {
      const r = await syncCalendarNow(bizId);
      return r.applied > 0;
    } catch {
      // 보조 가속일 뿐이다 — 1분 cron 이 정본 경로라 실패해도 화면을 막지 않는다.
      return false;
    }
  }, [bizId]);

  return { status, gcalCanWrite, workspaceCanWrite, reload, pull };
}
