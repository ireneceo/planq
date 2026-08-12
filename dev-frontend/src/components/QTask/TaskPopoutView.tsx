// TaskPopoutView — Q Task 팝아웃 창 본문 (Fable 설계 2026-07-28)
//
//   RightDock "열기 > Q Task" → window.open('/task-popout') 안에서 마운트된다.
//   QTaskPage(3418줄, URL 접점 27곳)를 embedded 로 이식하지 않고 **전용 경량 뷰**를 둔 이유:
//     - 폭 520px 창에 워크스페이스 탭·주간 리포트·템플릿까지 든 풀 페이지는 맞지 않는다.
//     - QTaskPage 의 navigate/setSearchParams 를 하나라도 놓치면 팝아웃이 /tasks 로 튕긴다
//       (QTalkStandalonePage 주석에 기록된 그 회귀).
//   데이터는 기존 실 API `GET /api/tasks/my-week` 그대로 — 신규 백엔드 0, mock 0.
//   행 클릭 → TaskDetailDrawer (TodoPage 와 동일한 마운트 방식) 로 상세·상태변경까지 이 창에서 끝난다.
//
//   CLAUDE.md §16 실시간 4요소를 처음부터 구현한다:
//     (a) business room join  (b) 백엔드 broadcast(기존 task:*)  (c) listener + 250ms debounce silentLoad
//     (d) useVisibilityRefresh  (+ 같은 창 안전망 window 'inbox:refresh')
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  CheckIcon,
  SendIcon,
  Body,
  Center,
  CheckBtn,
  EmptyLine,
  EmptyTitle,
  ErrText,
  Head,
  HeadMeta,
  HeadRight,
  HeadTitle,
  List,
  MetaChip,
  MetaDue,
  PrioBtn,
  PrioChip,
  PrioSlot,
  RetryBtn,
  Row,
  RowErr,
  RowInner,
  RowLead,
  RowMain,
  RowMeta,
  RowTitle,
  RowTop,
  Slot,
  SortToggle,
  Spin,
  SubmitBtn,
  TabBtn,
  TabRow,
  TagGroupHead,
  ToggleDone,
  WaitDot,
  Wrap,
} from './TaskPopoutView.styles';

import { inTodaySet } from '../../utils/todayTaskSet';
import { detectBrowserTz } from '../../utils/timezones';
import { useAuth, apiFetch } from '../../contexts/AuthContext';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { joinRoom, leaveRoom, onSocket, getSocket } from '../../services/socket';
import TaskDetailDrawer, { type DrawerMemberOption } from './TaskDetailDrawer';
import { STATUS_COLOR, displayStatus, getStatusLabel, type StatusCode } from '../../utils/taskLabel';
import { getRoles, primaryPerspective } from '../../utils/taskRoles';
import TagChips, { type TaskTagLite } from './TagChips';

interface PopoutTask {
  id: number;
  title: string;
  status: string;
  source?: string;
  request_ack_at?: string | null;
  assignee_id: number | null;
  created_by?: number;
  request_by_user_id?: number | null;
  planned_week_start?: string | null;
  start_date?: string | null;
  due_date?: string | null;
  estimated_hours?: number | null;
  actual_hours?: number | null;
  progress_percent?: number;
  // my-week 가 서브쿼리로 실어 보낸다. MySQL COUNT 는 드라이버에 따라 문자열로 오므로 Number() 로 캐스팅해 쓴다.
  reviewer_count?: number | string | null;
  // 우선순위. DB 는 글로벌 단일 컬럼이라 갭(1,2,9)·중복(1,1,2)이 실재한다 — 표시는 항상 재인덱스한다.
  priority_order?: number | null;
  // my-week 가 실어 보낸다. getRoles 가 reviewer 관점을 메인과 같은 근거로 판정하게 하는 용도.
  reviewers?: Array<{ id?: number; user_id: number; state?: string; is_client?: boolean }>;
  // #250 — my-week 가 배치 2차 쿼리로 실어 보낸다. **이름 사전순 정렬된 상태**라 [0] 이 대표 태그다.
  tags?: TaskTagLite[] | null;
  Project?: { id: number; name: string } | null;
}

// null 은 항상 뒤로. (서버 order 의 `due_date ASC` 는 MySQL NULL-first 라 마감 없는 업무가 맨 위로 온다 —
//  메인 QTaskPage 는 null-last 라서 두 화면의 순서가 갈렸다. 여기서 메인 규칙으로 맞춘다.)
function cmpNullLast(a?: string | null, b?: string | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

// 메인 QTaskPage 기본 정렬과 동일: priority_order(null last) → due_date(null last) → title
function bySortRule(a: PopoutTask, b: PopoutTask): number {
  const pa = a.priority_order ?? null;
  const pb = b.priority_order ?? null;
  if (pa !== pb) {
    if (pa === null) return 1;
    if (pb === null) return -1;
    return pa - pb;
  }
  const d = cmpNullLast(a.due_date, b.due_date);
  if (d !== 0) return d;
  return (a.title || '').localeCompare(b.title || '');
}

// 행 퀵액션 분기 — Fable 설계 확정본(2026-07-28)의 5분기. **raw status 로만 판정**한다
// (displayStatus 는 '지연' 같은 표시용 코드를 섞기 때문에 여기 쓰면 안 된다).
//
//   canceled            → 인터랙션 없음 (☐ 를 주면 취소된 업무가 완료로 뒤집힌다)
//   completed  rc===0   → ☑ 클릭 시 /revert-status 로 직전 복귀
//   completed  rc>=1    → ☑ 고정. 컨펌 승인으로 완료된 건을 여기서 되돌리면 마지막 history 가
//                          review_submit 이라 reviewing 이 아니라 in_progress 로 떨어지고,
//                          reviewer state 는 'approved' 로 남아 이력과 모순된다.
//   reviewing           → 표시만. submit-review 재호출은 새 라운드를 열어 받아둔 승인을 리셋한다.
//   rc===0 그 외        → ☐ 클릭 시 /complete
//   rc>=1  in_progress·revision_requested → ↻ /submit-review, 나머지는 퀵액션 없음
export type QuickAction =
  | 'complete' | 'uncheck' | 'submit' | 'checked_locked' | 'reviewing' | 'none';

// isAssignee=false 는 **무조건 퀵액션 없음**. my-week 집합이 "내가 pending 컨펌자인 남의 업무" 와
//   "내가 관여한 이번 주 완료" 까지 포함하도록 넓어졌으므로(메인 weekSet 미러), 담당자 전제인 5분기를
//   그대로 적용하면 남의 revision_requested 에 ↻ 가 떠서 클릭 시 403 only_assignee 가 난다.
//   컨펌 액션은 행 클릭 → TaskDetailDrawer 가 이미 담당한다.
export function quickActionFor(status: string, reviewerCount: number, isAssignee: boolean): QuickAction {
  if (!isAssignee) return 'none';
  if (status === 'canceled') return 'none';
  if (status === 'completed') return reviewerCount === 0 ? 'uncheck' : 'checked_locked';
  if (status === 'reviewing') return 'reviewing';
  if (reviewerCount === 0) return 'complete';
  if (status === 'in_progress' || status === 'revision_requested') return 'submit';
  return 'none';
}

interface WeekSummary {
  total_tasks: number;
  total_estimated: number;
  total_actual: number;
  total_remaining: number;
}

const CLOSED = ['completed', 'canceled'];

interface TaskPopoutViewProps {
  /** 헤더 우측에 놓을 핀 토글 (QTaskStandalonePage 가 주입 — 핀 상태는 창이 소유한다) */
  pinSlot?: React.ReactNode;
}

const TaskPopoutView: React.FC<TaskPopoutViewProps> = ({ pinSlot }) => {
  const { t } = useTranslation('qtask');
  const { user } = useAuth();
  const bizId = user?.business_id ? Number(user.business_id) : null;
  const myId = user ? Number(user.id) : -1;
  // 로컬 기준 오늘 (toISOString 은 UTC 라 KST 자정 직후 전날로 밀린다).
  //   ★ 상수로 두면 팝아웃을 밤새 열어둔 사용자의 "오늘" 이 어제에 머문다 — 60초 타이머 + 복귀 시 재평가.
  const localToday = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const [todayStr, setTodayStr] = useState<string>(localToday);
  // 팝아웃은 워크스페이스 tz 를 따로 안 받는다 — 완료 판정용으로 브라우저 tz 를 쓴다(로컬 오늘과 같은 기준).
  const tzGuess = useMemo(() => detectBrowserTz(), []);
  useEffect(() => {
    const sync = () => setTodayStr((prev) => { const now = localToday(); return now === prev ? prev : now; });
    const id = window.setInterval(sync, 60000);
    const onVis = () => { if (document.visibilityState === 'visible') sync(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis); };
  }, []);

  const [tasks, setTasks] = useState<PopoutTask[]>([]);
  const [summary, setSummary] = useState<WeekSummary | null>(null);
  const [members, setMembers] = useState<DrawerMemberOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showDone, setShowDone] = useState(false);
  // #250 — 나열 기준. 'default' = 기존 사슬(우선순위→마감→제목), 'tag' = 대표 태그순.
  const [sortMode, setSortMode] = useState<'default' | 'tag'>('default');
  // #237·#258 — 오늘/이번 주 2탭. 팝아웃은 "오늘 해야 할 일" 도구로 쓰이므로 기본은 오늘.
  //   데이터는 /my-week 한 벌을 공유하고 탭은 **클라이언트 필터**다 — 새 요청·새 술어를 만들지 않는다.
  const [popTab, setPopTab] = useState<'today' | 'week'>(() => {
    try { return localStorage.getItem('planq:taskPopout:tab') === 'week' ? 'week' : 'today'; } catch { return 'today'; }
  });
  useEffect(() => { try { localStorage.setItem('planq:taskPopout:tab', popTab); } catch { /* ignore */ } }, [popTab]);

  // 응답 순서 가드 — 늦게 도착한 옛 응답이 새 목록을 덮어쓰지 않게 (#205 패턴)
  const seqRef = useRef(0);

  const fetchWeek = useCallback(async (silent: boolean) => {
    if (!bizId) return;
    const seq = ++seqRef.current;
    if (!silent) setLoading(true);
    try {
      const res = await apiFetch(`/api/tasks/my-week?business_id=${bizId}`);
      // apiFetch 는 throw 하지 않는다 — res.ok 를 반드시 본다 (memory: apifetch_no_throw)
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      if (seq !== seqRef.current) return;   // stale 응답 폐기
      if (!json.success) throw new Error('failed');
      setTasks(json.data.tasks || []);
      setSummary(json.data.summary || null);
      setError(false);
    } catch {
      if (seq !== seqRef.current) return;
      if (!silent) setError(true);          // silent 갱신 실패는 화면을 비우지 않는다
    } finally {
      if (seq === seqRef.current && !silent) setLoading(false);
    }
  }, [bizId]);

  const load = useCallback(() => fetchWeek(false), [fetchWeek]);
  const silentLoad = useCallback(() => fetchWeek(true), [fetchWeek]);

  useEffect(() => { load(); }, [load]);

  // ── 퀵액션 (체크박스 완료처리) ─────────────────────────────
  // 중복 제출 가드는 전역 1건 — 더블클릭도, 다른 행 연타도 요청 1회 (UI_DESIGN_GUIDE §1.8).
  const [busyId, setBusyId] = useState<number | null>(null);
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
    if (busyId !== null) return;
    setBusyId(id);
    setRowErr(null);
    try {
      const r = await apiFetch(`/api/tasks/${id}${path}`, { method: 'POST' });
      // apiFetch 는 throw 하지 않는다 — res.ok 를 반드시 본다 (memory: apifetch_no_throw)
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setRowErr({ id, msg: actErrMsg(j?.message) });
      }
      // 성공·실패 무관 서버 진실로 재동기. 다른 창이 먼저 바꿨다면 이 행은 여기서 사라진다.
      await silentLoad();
    } catch {
      setRowErr({ id, msg: t('popout.act.errNetwork', '연결에 실패했습니다') });
    } finally {
      setBusyId(null);
    }
  }, [busyId, silentLoad, actErrMsg, t]);

  // 드로어에 필요한 멤버 목록
  useEffect(() => {
    if (!bizId) return;
    let cancelled = false;
    apiFetch(`/api/businesses/${bizId}/members`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.success) return;
        setMembers((j.data as Array<{ user_id: number; name: string }>).map((m) => ({ user_id: m.user_id, name: m.name })));
      })
      .catch(() => { /* 멤버 목록은 부가 정보 — 실패해도 리스트는 뜬다 */ });
    return () => { cancelled = true; };
  }, [bizId]);

  // §16 (a)(c) — business room join + task 변경 listener (250ms debounce)
  useEffect(() => {
    if (!bizId) return;
    const room = `business:${bizId}`;
    joinRoom(room);
    let pending: number | null = null;
    const debouncedReload = () => {
      if (pending) return;
      pending = window.setTimeout(() => { pending = null; silentLoad(); }, 250);
    };
    const offs = [
      onSocket('task:new', debouncedReload),
      onSocket('task:updated', debouncedReload),
      onSocket('task:deleted', debouncedReload),
      onSocket('inbox:refresh', debouncedReload),
    ];
    // §16 (e) — 같은 창 안전망. TaskDetailDrawer 의 workflow 액션이 dispatch 한다.
    const onLocalRefresh = () => debouncedReload();
    window.addEventListener('inbox:refresh', onLocalRefresh);
    return () => {
      if (pending) window.clearTimeout(pending);
      window.removeEventListener('inbox:refresh', onLocalRefresh);
      offs.forEach((off) => off());
      leaveRoom(room);
    };
  }, [bizId, silentLoad]);

  // §16 (d) — background 복귀 / socket 끊김 회복
  useVisibilityRefresh(useCallback(() => {
    silentLoad();
    const s = getSocket();
    if (s && !s.connected) s.connect();
  }, [silentLoad]));

  // 리스트 재클릭 토글 (CLAUDE.md UI 규칙)
  const handleRow = (id: number) => setSelectedId((prev) => (prev === id ? null : id));

  // #250 — 팝아웃에서도 우선순위 관리. 재인덱스는 **백엔드가 정본 집합 기준으로 단독 수행**한다
  //   (services/taskPriority.js). 팝아웃은 이번 주 집합이라 from/to 를 보내지 않는다 —
  //   서버가 워크스페이스 tz 기준 이번 주 월~일로 계산한다(`/my-week` 과 같은 계산).
  const [prioBusy, setPrioBusy] = useState(false);
  const togglePrio = async (taskId: number) => {
    if (prioBusy) return;   // 더블클릭 = 부여 후 즉시 해제 사고 차단 (UI_DESIGN_GUIDE §1.8)
    setPrioBusy(true);
    try {
      const r = await apiFetch('/api/tasks/priority/toggle', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: bizId, task_id: taskId }),
      });
      if (!r.ok) return;   // apiFetch 는 throw 안 함 — 실패 시 낙관적 적용 금지
      const j = await r.json();
      const map = new Map<number, number | null>(
        ((j?.data?.priorities || []) as Array<{ id: number; priority_order: number | null }>)
          .map((p) => [p.id, p.priority_order]));
      setTasks((prev) => prev.map((tk) => (map.has(tk.id) ? { ...tk, priority_order: map.get(tk.id) ?? null } : tk)));
    } catch { /* 네트워크 실패 — 상태 그대로 (socket/visibility 복귀가 회복) */ }
    finally { setPrioBusy(false); }
  };

  // 표시용 우선순위 번호 — 메인 QTaskPage 의 displayPriorityMap 과 같은 규칙(연속 재인덱스).
  //   ★ 기준 집합은 **응답 tasks 전체**(완료 포함). visible 로 잡으면 "완료 보기" 토글마다 번호가 출렁이고,
  //     완료 업무도 priority_order 를 그대로 들고 있는 메인 화면과 번호가 어긋난다.
  //   ★ tie-break 를 명시한다 — DB 에 중복값(1,1,2,3,3,8)이 실재해 stable sort 의 입력 순서에 기대면
  //     서버 정렬(due asc)로 들어오는 팝아웃과 메인의 번호가 갈린다.
  //   ★ 동률일 때의 순서는 메인과 **완전히 같은 사슬**이어야 한다. 메인의 displayPriorityMap 은
  //     priority 만으로 stable sort 하므로 동률의 실제 순서는 그 입력(filtered)이 결정한다 —
  //     즉 완료 뒤로 → due(null last) → title. id tie-break 을 쓰면 두 화면의 번호가 갈릴 뿐 아니라
  //     같은 팝아웃 안에서도 행 순서(bySortRule = title tie-break)와 칩 번호가 역전됐다.
  const prioMap = useMemo(() => {
    const m = new Map<number, number>();
    const doneRank = (tk: PopoutTask) => (CLOSED.includes(tk.status) ? 1 : 0);
    tasks
      .filter((tk) => tk.priority_order != null)
      // ★ 맨 끝 id 는 서버 services/taskPriority.js byPriorityChain 과 문자 그대로 동일한 절대 tie-break.
      //   위로 올리면 위 주석의 옛 실버그가 재발한다.
      .sort((a, b) => (a.priority_order! - b.priority_order!)
        || (doneRank(a) - doneRank(b))
        || cmpNullLast(a.due_date, b.due_date)
        || (a.title || '').localeCompare(b.title || '')
        || (a.id - b.id))
      .forEach((tk, i) => m.set(tk.id, i + 1));
    return m;
  }, [tasks]);

  // #250 — "태그기준대로 나열". 다대다라 정렬 키가 모호하므로 **대표 태그(사전순 최소)** 1키로 확정한다.
  //   백엔드 attachTagsTo() 가 이름순 정렬해 보내므로 tags[0] 이 대표다.
  //   ★ 이건 **행 순서만** 바꾼다. prioMap(우선순위 번호)은 절대 건드리지 않는다 —
  //     번호의 정본은 서버 재인덱스 집합이고, 보기 옵션이 번호에 닿으면 안 된다
  //     (QTaskPage 의 weekSet/filtered 분리와 같은 원칙. 이 저장소가 한 번 당한 사고다).
  //     따라서 태그순에서는 칩 번호가 행 순서와 어긋나 보일 수 있는데, 그게 정상이다.
  const repTag = (tk: PopoutTask) => (tk.tags && tk.tags.length > 0 ? tk.tags[0].name : null);
  const byTagRule = (a: PopoutTask, b: PopoutTask): number => {
    const ta = repTag(a); const tb = repTag(b);
    if (ta && !tb) return -1;          // 태그 없는 업무는 맨 뒤 (null last)
    if (!ta && tb) return 1;
    if (ta && tb) {
      const c = ta.localeCompare(tb);
      if (c !== 0) return c;
    }
    return bySortRule(a, b);           // 같은 대표 태그 안에서는 기존 사슬 그대로
  };
  const sortRule = sortMode === 'tag' ? byTagRule : bySortRule;
  // 오늘 탭 = 이번 주 응답(/my-week) 위에 utils/todayTaskSet 술어를 얹은 것. 메인 화면과 **같은 함수**다.
  const inTab = useCallback((tk: PopoutTask, includeDone: boolean) => (
    popTab === 'week' ? true : inTodaySet(tk as never, todayStr, myId, tzGuess, includeDone)
  ), [popTab, todayStr, myId]);   // eslint-disable-line react-hooks/exhaustive-deps
  const openTasks = useMemo(
    () => tasks.filter((tk) => !CLOSED.includes(tk.status) && inTab(tk, false)).sort(sortRule), [tasks, sortMode, inTab]);   // eslint-disable-line react-hooks/exhaustive-deps
  const doneTasks = useMemo(
    () => tasks.filter((tk) => CLOSED.includes(tk.status) && inTab(tk, true)).sort(sortRule), [tasks, sortMode, inTab]);    // eslint-disable-line react-hooks/exhaustive-deps
  const visible = showDone ? [...openTasks, ...doneTasks] : openTasks;
  const hasAnyTag = useMemo(() => tasks.some((tk) => (tk.tags?.length || 0) > 0), [tasks]);

  const fmtDue = (due?: string | null) => (due ? due.slice(5, 10).replace('-', '/') : '');
  const isOverdue = (tk: PopoutTask) =>
    !!tk.due_date && tk.due_date.slice(0, 10) < todayStr && !CLOSED.includes(tk.status);

  // 행 왼쪽 24px 슬롯 — 분기별로 렌더가 다르지만 폭은 항상 같다 (제목 좌측선 정렬 유지).
  const renderQuickAction = (tk: PopoutTask, qa: QuickAction, busy: boolean) => {
    if (busy) return <Slot aria-hidden="true"><Spin /></Slot>;
    // 중복 제출 가드 (UI_DESIGN_GUIDE §1.8) — 처리 중엔 다른 행의 퀵액션도 잠근다.
    const locked = busyId !== null;
    switch (qa) {
      case 'complete':
        return (
          <CheckBtn
            type="button" role="checkbox" aria-checked={false} disabled={locked}
            data-testid="task-popout-check"
            aria-label={t('popout.act.complete', '완료 처리')}
            title={t('popout.act.complete', '완료 처리')}
            onClick={() => runAction(tk.id, '/complete')}
          />
        );
      case 'uncheck':
        return (
          <CheckBtn
            type="button" role="checkbox" aria-checked $checked disabled={locked}
            data-testid="task-popout-uncheck"
            aria-label={t('popout.act.uncheck', '완료 되돌리기')}
            title={t('popout.act.uncheck', '완료 되돌리기')}
            onClick={() => runAction(tk.id, '/revert-status')}
          ><CheckIcon /></CheckBtn>
        );
      case 'checked_locked':
        return (
          <CheckBtn
            as="span" $checked $locked role="img"
            data-testid="task-popout-check-locked"
            aria-label={t('popout.act.locked', '컨펌으로 완료됨')}
            title={t('popout.act.lockedTip', '컨펌으로 완료됨 — 되돌리기는 상세에서')}
          ><CheckIcon /></CheckBtn>
        );
      case 'submit':
        return (
          <SubmitBtn
            type="button" disabled={locked}
            data-testid="task-popout-submit-review"
            aria-label={t('popout.act.submit', '확인 요청 보내기')}
            title={t('popout.act.submit', '확인 요청 보내기')}
            onClick={() => runAction(tk.id, '/submit-review')}
          ><SendIcon /></SubmitBtn>
        );
      case 'reviewing':
        return (
          <Slot
            role="img"
            data-testid="task-popout-reviewing"
            aria-label={t('popout.act.reviewing', '확인 중')}
            title={t('popout.act.reviewingTip', '확인 중 — 컨펌자 응답을 기다리는 중입니다')}
          ><WaitDot /></Slot>
        );
      default:
        return <Slot aria-hidden="true" />;
    }
  };

  if (!bizId) {
    return <Center>{t('popout.noWorkspace', '워크스페이스를 선택한 뒤 다시 열어주세요.')}</Center>;
  }

  return (
    <Wrap>
      <Head>
        <HeadTitle>{t('popout.title', '이번 주 내 업무')}</HeadTitle>
        <HeadRight>
          {summary && (
            <HeadMeta>
              {t('popout.summary', '{{open}}건 진행 · 남은 {{hours}}h', {
                open: openTasks.length,
                hours: Math.round((summary.total_remaining || 0) * 10) / 10,
              })}
            </HeadMeta>
          )}
          {pinSlot}
        </HeadRight>
      </Head>

      {/* #237·#258 — 오늘 / 이번 주 2탭. 데이터는 한 벌(/my-week)이고 탭은 클라이언트 필터다. */}
      <TabRow role="tablist" aria-label={t('popout.tabsLabel', '업무 범위') as string}>
        <TabBtn type="button" role="tab" aria-selected={popTab === 'today'} $active={popTab === 'today'}
          data-testid="task-popout-tab-today" onClick={() => setPopTab('today')}>
          {t('popout.tabToday', '오늘')}
        </TabBtn>
        <TabBtn type="button" role="tab" aria-selected={popTab === 'week'} $active={popTab === 'week'}
          data-testid="task-popout-tab-week" onClick={() => setPopTab('week')}>
          {t('popout.tabWeek', '이번 주')}
        </TabBtn>
      </TabRow>
      <Body>
        {loading && <Center>{t('popout.loading', '불러오는 중…')}</Center>}

        {!loading && error && (
          <Center>
            <ErrText>{t('popout.error', '업무를 불러오지 못했습니다.')}</ErrText>
            <RetryBtn type="button" data-testid="task-popout-retry" onClick={load}>
              {t('popout.retry', '다시 시도')}
            </RetryBtn>
          </Center>
        )}

        {!loading && !error && visible.length === 0 && (
          <Center>
            <EmptyTitle>{t('popout.emptyTitle', '이번 주 배정된 업무가 없습니다')}</EmptyTitle>
            <EmptyLine>{t('popout.emptyLine', '새 업무가 배정되면 이 창에 바로 나타납니다.')}</EmptyLine>
          </Center>
        )}

        {!loading && !error && visible.length > 0 && (
          <List role="list" data-testid="task-popout-list">
            {visible.map((tk, vi) => {
              // #237 "태그(업무방식)별로 시각적으로 제대로 보여야" — 태그순 모드에서만 그룹 헤더를 낸다.
              //   대표 태그가 바뀌는 지점에 한 줄. 태그 없는 묶음은 맨 뒤라 "태그 없음" 으로 닫힌다.
              const groupHead = sortMode === 'tag'
                ? (vi === 0 || repTag(visible[vi - 1]) !== repTag(tk) ? (repTag(tk) || t('popout.noTagGroup', '태그 없음')) : null)
                : null;
              const code = displayStatus(tk, todayStr) as StatusCode;
              const color = STATUS_COLOR[code] || STATUS_COLOR.not_started;
              const role = primaryPerspective(getRoles(tk, myId));
              const rc = Number(tk.reviewer_count ?? 0) || 0;
              const qa = quickActionFor(tk.status, rc, tk.assignee_id === myId);
              const busy = busyId === tk.id;
              const groupColor = tk.tags && tk.tags.length > 0 ? tk.tags[0].color : null;
              // ★ Row 는 div 다. 체크박스 버튼과 본문 버튼은 **형제** — 중첩하면 button-in-button 이 되어
              //   HTML 상 무효이고 브라우저가 클릭 타깃을 임의로 접는다(stopPropagation 으로 못 막는다).
              return (
                <React.Fragment key={`g-${tk.id}`}>
                {groupHead && <TagGroupHead $color={groupColor || '#CBD5E1'}>{groupHead}</TagGroupHead>}
                <Row
                  role="listitem"
                  data-testid="task-popout-row"
                  $active={selectedId === tk.id}
                  $dim={CLOSED.includes(tk.status)}
                >
                  <RowInner>
                    <RowLead>{renderQuickAction(tk, qa, busy)}</RowLead>
                    {/* 우선순위 슬롯 — #250 "우선순위 관리도 여기서도 해야 해".
                        ★ RowMain(button) **밖 형제**여야 한다. 안에 넣으면 button-in-button 이라
                          HTML 상 무효이고 브라우저가 클릭 타깃을 임의로 접는다(위 397 주석과 같은 이유).
                        옛 주석은 "팝아웃 집합은 메인의 부분집합이라 여기서 토글하면 번호가 오염된다" 였다 —
                          이제 재인덱스를 백엔드가 정본 집합(services/weekTaskSet.myWeekWhere) 기준으로
                          단독 수행하므로 그 전제가 해소됐다.
                        완료/취소 행: 번호가 있으면 읽기 전용 칩, 없으면 빈 칸(부여 버튼을 내지 않는다 —
                          완료 업무에 우선순위를 새로 매기는 것은 무의미하고 메인에도 그 경로가 없다). */}
                    {CLOSED.includes(tk.status) ? (
                      <PrioSlot>
                        {prioMap.has(tk.id) && (
                          <PrioChip
                            $dim
                            aria-label={t('popout.priorityN', '우선순위 {{n}}', { n: prioMap.get(tk.id) }) as string}
                            title={t('popout.priorityN', '우선순위 {{n}}', { n: prioMap.get(tk.id) }) as string}
                          >{prioMap.get(tk.id)}</PrioChip>
                        )}
                      </PrioSlot>
                    ) : (
                      <PrioBtn
                        type="button"
                        $on={prioMap.has(tk.id)}
                        disabled={prioBusy}
                        data-testid="task-popout-priority"
                        aria-pressed={prioMap.has(tk.id)}
                        aria-label={(prioMap.has(tk.id)
                          ? t('popout.priorityClear', '우선순위 {{n}} — 해제', { n: prioMap.get(tk.id) })
                          : t('popout.prioritySet', '우선순위 지정')) as string}
                        title={(prioMap.has(tk.id)
                          ? t('popout.priorityClear', '우선순위 {{n}} — 해제', { n: prioMap.get(tk.id) })
                          : t('popout.prioritySet', '우선순위 지정')) as string}
                        onClick={() => togglePrio(tk.id)}
                      ><span>{prioMap.get(tk.id) ?? ''}</span></PrioBtn>
                    )}
                    <RowMain
                      type="button"
                      data-testid="task-popout-row-open"
                      onClick={() => handleRow(tk.id)}
                    >
                      <RowTop>
                        <Badge $bg={color.bg} $fg={color.fg}>{getStatusLabel(tk, role, todayStr, t as never)}</Badge>
                        <RowTitle>{tk.title}</RowTitle>
                      </RowTop>
                      <RowMeta>
                        {/* #250 — 팝아웃은 폭 520px 라 **대표 1칩 + `+k`** 만. 행이 한 줄을 넘기면 안 된다.
                            메인 리스트는 3칩까지 편다(TagChips max prop). */}
                        <TagChips tags={tk.tags} max={1} />
                        {tk.Project?.name && <MetaChip>{tk.Project.name}</MetaChip>}
                        {tk.due_date && (
                          <MetaDue $overdue={isOverdue(tk)}>
                            {t('popout.due', '마감 {{date}}', { date: fmtDue(tk.due_date) })}
                          </MetaDue>
                        )}
                        {typeof tk.progress_percent === 'number' && tk.progress_percent > 0 && (
                          <MetaChip>{tk.progress_percent}%</MetaChip>
                        )}
                      </RowMeta>
                    </RowMain>
                  </RowInner>
                  {rowErr?.id === tk.id && (
                    <RowErr role="alert" data-testid="task-popout-row-error">{rowErr.msg}</RowErr>
                  )}
                </Row>
                </React.Fragment>
              );
            })}
          </List>
        )}

        {/* #250 "태그기준대로 나열…도 여기서도 해야 해" — 태그가 하나라도 있을 때만 노출한다
            (태그를 안 쓰는 워크스페이스에 죽은 컨트롤을 두지 않는다). 기존 ToggleDone 계열 스타일. */}
        {!loading && !error && hasAnyTag && visible.length > 0 && (
          <SortToggle
            type="button"
            data-testid="task-popout-sort-mode"
            aria-pressed={sortMode === 'tag'}
            onClick={() => setSortMode((m) => (m === 'tag' ? 'default' : 'tag'))}
          >
            {sortMode === 'tag'
              ? t('popout.sortDefault', '기본 순서로 보기')
              : t('popout.sortByTag', '태그순으로 보기')}
          </SortToggle>
        )}

        {!loading && !error && doneTasks.length > 0 && (
          <ToggleDone
            type="button"
            data-testid="task-popout-toggle-done"
            onClick={() => setShowDone((v) => !v)}
          >
            {showDone
              ? t('popout.hideDone', '완료 숨기기')
              : t('popout.showDone', '완료 {{count}}건 보기', { count: doneTasks.length })}
          </ToggleDone>
        )}
      </Body>

      {selectedId !== null && (
        <TaskDetailDrawer
          taskId={selectedId}
          bizId={bizId}
          myId={myId}
          todayStr={todayStr}
          members={members}
          onClose={() => setSelectedId(null)}
          onRefresh={silentLoad}
          onDuplicated={(newId) => { setSelectedId(newId); silentLoad(); }}
        />
      )}
    </Wrap>
  );
};

export default TaskPopoutView;

