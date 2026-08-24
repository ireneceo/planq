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
  GoMainBtn,
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
  Spin,
  SubmitBtn,
  TabBtn,
  TabRow,
  TagGroupHead,
  TagSlot,
  DoneFilterLabel,
  PrioGapHint,
  WaitDot,
  Wrap,
} from './TaskPopoutView.styles';

import { inTodaySet } from '../../utils/todayTaskSet';
import { detectBrowserTz, dateStrInTz } from '../../utils/timezones';
import { useAuth, apiFetch } from '../../contexts/AuthContext';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { joinRoom, leaveRoom, onSocket, getSocket } from '../../services/socket';
import { buildPriorityMap, hiddenPriorityNumbers } from './popoutPriority';
import TaskDetailDrawer, { type DrawerMemberOption } from './TaskDetailDrawer';
import { STATUS_COLOR, displayStatus, getStatusLabel, type StatusCode } from '../../utils/taskLabel';
import { getRoles, primaryPerspective } from '../../utils/taskRoles';
import TagChips, { type TaskTagLite } from './TagChips';
import TagQuickMenu from './TagQuickMenu';
import { quickActionFor, type QuickAction } from './popoutQuickAction';
import { useQuickAction } from './useQuickAction';   // 행 퀵액션 실행(낙관 반영·행 단위 잠금)
import { useTaskTagDict } from './useTaskTagDict';
import PopoutViewChips, { type PopoutView } from './PopoutViewChips';
import PopoutQuickAdd from './PopoutQuickAdd';
import { bySortRule, buildQuickChoices, cmpNullLast } from './popoutSort';
import { requestMainNavigate } from '../Common/PopoutBridge';

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
  // 태그 편집 권한 — 백엔드 PUT /api/tasks/:id/tags 의 canEdit 와 **같은 집합**이어야 한다
  //   (담당자 OR 작성자 OR owner OR admin OR platform_admin).
  //   여태 팝아웃은 담당자·작성자만 봐서, owner 인데도 "내가 컨펌자로 들어간 남의 업무" 행에는
  //   버튼이 아예 안 떴다 — 백엔드는 허용하는데 화면이 막고 있던 것(Irene 2026-08-23 "팝아웃에서
  //   여전히 안되는데"). 메인 리스트(canEditDatesFor)는 이미 owner/admin 을 포함하고 있었다.
  const canEditTagsFor = useCallback((t: { created_by?: number | null; assignee_id?: number | null }) => (
    t.created_by === myId || t.assignee_id === myId
    || user?.business_role === 'owner' || user?.business_role === 'admin'
    || user?.platform_role === 'platform_admin'
  ), [myId, user?.business_role, user?.platform_role]);
  // 로컬 기준 오늘 (toISOString 은 UTC 라 KST 자정 직후 전날로 밀린다).
  //   ★ 상수로 두면 팝아웃을 밤새 열어둔 사용자의 "오늘" 이 어제에 머문다 — 60초 타이머 + 복귀 시 재평가.
  const localToday = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const [todayStr, setTodayStr] = useState<string>(localToday);
  const [wsTz, setWsTz] = useState<string | null>(null);  // 시간 기준 = 워크스페이스 tz (/my-week 정본, Irene 2026-08-24)
  const tzGuess = useMemo(() => detectBrowserTz(), []);   // 첫 렌더 폴백. 훅은 무조건 호출(조건부 금지)
  const effTz = wsTz || tzGuess;
  useEffect(() => {
    const sync = () => setTodayStr((p) => { const n = wsTz ? dateStrInTz(new Date(), wsTz) : localToday(); return n === p ? p : n; });
    const id = window.setInterval(sync, 60000);
    const onVis = () => { if (document.visibilityState === 'visible') sync(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis); };
  }, [wsTz]);

  const [tasks, setTasks] = useState<PopoutTask[]>([]);
  const { dict: tagDict, add: addTagToDict } = useTaskTagDict(bizId);
  const [summary, setSummary] = useState<WeekSummary | null>(null);
  /** /my-week 가 준 이번 주 월요일(YYYY-MM-DD). 퀵애드의 planned_week_start 정합 원천. */
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const [members, setMembers] = useState<DrawerMemberOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // ★ 2026-08-24 (Irene) — 기본은 **완료도 보이되 아래로**(Q Task 리스트와 같은 방식).
  //   옛 기본(숨김)은 완료를 누르는 순간 행이 사라져 "없어져버린다" 로 읽혔다.
  const [hideDone, setHideDone] = useState(false);
  const showDone = !hideDone;
  // #237·#258 — 오늘/이번 주 2탭. 팝아웃은 "오늘 해야 할 일" 도구로 쓰이므로 기본은 오늘.
  //   데이터는 /my-week 한 벌을 공유하고 탭은 **클라이언트 필터**다 — 새 요청·새 술어를 만들지 않는다.
  const [popTab, setPopTab] = useState<'today' | 'week'>(() => {
    try { return localStorage.getItem('planq:taskPopout:tab') === 'week' ? 'week' : 'today'; } catch { return 'today'; }
  });
  useEffect(() => { try { localStorage.setItem('planq:taskPopout:tab', popTab); } catch { /* ignore */ } }, [popTab]);

  // #258 — 보기 기준은 **탭마다 따로** 기억한다. 원문이 탭별로 다른 디폴트를 지정했기 때문이다:
  //   "오늘의 내 업무에서는 태그별 보기를 디폴트로" / "이번 주 내 업무 탭에서는 마감일순을 디폴트로".
  //   한 벌로 공유하면 탭을 오갈 때마다 상대 탭의 디폴트가 파괴된다.
  const VIEW_KEY = (tab: 'today' | 'week') => `planq:taskPopout:view:${tab}`;
  const readView = (tab: 'today' | 'week'): PopoutView => {
    try {
      const v = localStorage.getItem(VIEW_KEY(tab));
      if (v === 'tag' || v === 'project' || v === 'due') return v;
    } catch { /* ignore */ }
    return tab === 'today' ? 'tag' : 'due';
  };
  const [viewMode, setViewMode] = useState<PopoutView>(() => readView(popTab));
  // 탭이 바뀌면 그 탭이 기억한 보기로 갈아탄다(없으면 그 탭의 디폴트).
  useEffect(() => { setViewMode(readView(popTab)); }, [popTab]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { localStorage.setItem(VIEW_KEY(popTab), viewMode); } catch { /* ignore */ } }, [popTab, viewMode]);

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
      // #258 퀵애드 — 이번 주 monday 는 **서버가 준 값**을 그대로 쓴다. 브라우저 tz 로 다시 계산하면
      //   weekTaskSet 술어(planned_week_start = monday **정확 일치**)와 어긋나 추가한 업무가
      //   그 자리에서 사라진다. 정합 원천은 하나여야 한다 (Fable 설계 C-5).
      if (json.data.week) setWeekStart(String(json.data.week));
      if (json.data.timezone) setWsTz(String(json.data.timezone));   // 워크스페이스 시간·오늘 정본
      if (json.data.today) setTodayStr(String(json.data.today));
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

  // ── 퀵애드 (#258 "바로 바로 추가") ─────────────────────────
  // 기본값은 **탭 문맥**이 정한다. 신규 라우트를 만들지 않고 기존 POST /api/tasks 를 그대로 쓴다
  //   (생성 권한·자동 컨펌자·socket broadcast·감사가 전부 행동 계층 createTask 안에 있다).
  //
  // ★ 게이트 정합 — 추가한 업무가 그 탭에 **남아 있어야** 한다(이전에 "추가 즉시 사라짐" 회귀가 났다):
  //   · 오늘 탭: due_date = 이 뷰의 todayStr → inTodaySet ②(due === today) 통과.
  //     주간 술어도 due_date 가 주 범위 안이라 함께 통과한다.
  //   · 이번 주 탭: planned_week_start = **서버가 준 weekStart** → weekTaskSet 정확 일치 통과.
  //     브라우저에서 monday 를 계산하면 tz 차이로 어긋난다 (Fable 설계 C-5).
  // #309 — "할일 입력할 때 태그/프로젝트도 같이 고를 수 있게".
  //   보기 기준이 바뀌면 고르는 대상도 바뀐다(태그별↔태그 / 프로젝트별↔프로젝트).
  //   기준이 바뀌면 이전 선택은 의미가 없으므로 아래 effect 에서 비운다.
  const [quickPick, setQuickPick] = useState('');

  const quickAdd = useCallback(async (title: string): Promise<boolean> => {
    if (!bizId) return false;
    // 이번 주 탭인데 아직 weekStart 를 못 받았으면 만들지 않는다 —
    //   null 로 보내면 주간 술어를 못 넘겨 방금 만든 업무가 화면에서 사라진다.
    if (popTab === 'week' && !weekStart) return false;
    try {
      const res = await apiFetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: bizId,
          title,
          assignee_id: myId,                                   // 이 팝아웃은 내 업무 목록이다
          ...(popTab === 'today'
            ? { due_date: todayStr, planned_week_start: weekStart || undefined }
            : { planned_week_start: weekStart }),
          // #309 — 프로젝트별로 보고 있으면 그 프로젝트로 바로 만든다.
          ...(viewMode === 'project' && quickPick ? { project_id: Number(quickPick) } : {}),
        }),
      });
      // apiFetch 는 throw 하지 않는다 — res.ok 를 반드시 본다 (memory: apifetch_no_throw)
      if (!res.ok) return false;
      const json = await res.json();
      if (!json.success) return false;
      // #309 — 태그는 생성 API 가 안 받는다. 전용 경로로 이어 붙인다(QTaskPage 와 같은 계약).
      //   ★ 태그 부여가 실패해도 업무는 이미 만들어졌다 — 되돌리지 않고 목록만 갱신한다.
      //     (apiFetch 는 throw 하지 않으므로 res.ok 를 본다.)
      const newId = json.data?.id;
      if (viewMode === 'tag' && quickPick && newId) {
        try {
          const tagRes = await apiFetch(`/api/tasks/${newId}/tags`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tag_ids: [Number(quickPick)] }),
          });
          if (!tagRes.ok) console.warn('[popout quickadd tags] HTTP', tagRes.status);
        } catch (err) { console.warn('[popout quickadd tags]', err); }
      }
      await silentLoad();     // 서버 fresh 로 덮어쓴다(부분 merge 금지)
      return true;
    } catch {
      return false;
    }
  }, [bizId, myId, popTab, todayStr, weekStart, silentLoad, viewMode, quickPick]);

  // ── 퀵액션 (체크박스 완료처리) ─────────────────────────────
  // 중복 제출 가드는 전역 1건 — 더블클릭도, 다른 행 연타도 요청 1회 (UI_DESIGN_GUIDE §1.8).
  const { busyIds, rowErr, runAction } = useQuickAction({ setTasks, silentLoad });

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

  // 번호 규칙의 정본은 popoutPriority.ts 에 있다(god-file 분리 + 규칙 한곳 모음).
  const prioMap = useMemo(() => buildPriorityMap(tasks, CLOSED), [tasks]);

  // #250 — "태그기준대로 나열". 다대다라 정렬 키가 모호하므로 **대표 태그(사전순 최소)** 1키로 확정한다.
  //   백엔드 attachTagsTo() 가 이름순 정렬해 보내므로 tags[0] 이 대표다.
  //   ★ 이건 **행 순서만** 바꾼다. prioMap(우선순위 번호)은 절대 건드리지 않는다 —
  //     번호의 정본은 서버 재인덱스 집합이고, 보기 옵션이 번호에 닿으면 안 된다
  //     (QTaskPage 의 weekSet/filtered 분리와 같은 원칙. 이 저장소가 한 번 당한 사고다).
  //     따라서 태그순에서는 칩 번호가 행 순서와 어긋나 보일 수 있는데, 그게 정상이다.
  const repTag = (tk: PopoutTask) => (tk.tags && tk.tags.length > 0 ? tk.tags[0].name : null);
  const repProject = (tk: PopoutTask) => (tk.Project?.name || null);

  // 그룹 보기 공통 — 그룹 키(null last) → 같은 그룹 안에서는 기존 사슬 그대로.
  const byGroup = (key: (tk: PopoutTask) => string | null) => (a: PopoutTask, b: PopoutTask): number => {
    const ka = key(a); const kb = key(b);
    if (ka && !kb) return -1;          // 그룹 없는 업무는 맨 뒤 (null last)
    if (!ka && kb) return 1;
    if (ka && kb) {
      const c = ka.localeCompare(kb);
      if (c !== 0) return c;
    }
    return bySortRule(a, b);
  };
  const byTagRule = byGroup(repTag);
  const byProjectRule = byGroup(repProject);
  // 마감일별 — 원문 "마감일별 보기". 마감이 앞선 순서가 **먼저** 오는 것이 이 라벨의 뜻이므로
  //   due 를 1순위로 둔다(bySortRule 은 우선순위가 1순위라 라벨과 어긋난다).
  //   동률 tie-break 은 기존 사슬을 그대로 이어 두 화면의 순서가 갈리지 않게 한다.
  const byDueRule = (a: PopoutTask, b: PopoutTask): number =>
    cmpNullLast(a.due_date, b.due_date) || bySortRule(a, b) || (a.id - b.id);

  // '태그별' 노출 기준 = **워크스페이스 태그 사전**. 목록 기준으로 재면 태그 붙은 업무가 완료되는
  //   순간 칩이 사라져 "기능이 없어졌다" 로 읽힌다(Irene 2026-08-23). 행에서 바로 붙일 수 있는 지금은
  //   목록이 비어도 살아있는 컨트롤이다. 사전 로드 전엔 옛 기준으로 OR.
  const hasAnyTag = useMemo(() => tagDict.length > 0 || tasks.some((tk) => (tk.tags?.length || 0) > 0),
    [tagDict.length, tasks]);
  const hasAnyProject = useMemo(() => tasks.some((tk) => !!tk.Project?.name), [tasks]);
  // 선택지에 없는 보기(태그 0개인데 'tag' 가 기억돼 있는 등)로 굳어 있으면 마감일별로 코어스한다.
  //   ★ 칩이 사라진 보기가 유효한 채로 남으면 사용자가 되돌릴 수단이 없다.
  //   ★ 정렬·그룹헤더·칩 하이라이트가 **모두 이 값 하나**를 봐야 한다 — viewMode 를 직접 읽는 소비처가
  //     하나라도 남으면 "칩은 마감일별인데 정렬은 태그별" 로 갈린다.
  const effView: PopoutView = (viewMode === 'tag' && !hasAnyTag) || (viewMode === 'project' && !hasAnyProject)
    ? 'due' : viewMode;

  // #309 — 선택지 계산은 popoutSort 로 절출(순수 함수). 규칙 설명도 그 파일에 있다.
  const quickChoices = useMemo(() => buildQuickChoices(effView, tasks), [effView, tasks]);

  // 기준이 바뀌면 이전 선택은 뜻이 달라진다(태그 id 를 프로젝트로 쓸 수 없다) → 비운다.
  useEffect(() => { setQuickPick(''); }, [effView]);

  const sortRule = effView === 'tag' ? byTagRule
    : effView === 'project' ? byProjectRule
      : byDueRule;
  // 오늘 탭 = 이번 주 응답(/my-week) 위에 utils/todayTaskSet 술어를 얹은 것. 메인 화면과 **같은 함수**다.
  const inTab = useCallback((tk: PopoutTask, includeDone: boolean) => (
    popTab === 'week' ? true : inTodaySet(tk as never, todayStr, myId, effTz, includeDone)
  ), [popTab, todayStr, myId, effTz]);
  const openTasks = useMemo(
    () => tasks.filter((tk) => !CLOSED.includes(tk.status) && inTab(tk, false)).sort(sortRule), [tasks, viewMode, inTab]);   // eslint-disable-line react-hooks/exhaustive-deps
  const doneTasks = useMemo(
    () => tasks.filter((tk) => CLOSED.includes(tk.status) && inTab(tk, true)).sort(sortRule), [tasks, viewMode, inTab]);    // eslint-disable-line react-hooks/exhaustive-deps
  const visible = showDone ? [...openTasks, ...doneTasks] : openTasks;

  // 운영 #280 — 번호가 건너뛰어 보이는 이유(완료로 접힘·다른 탭)를 목록 아래에서 설명한다.
  const hiddenPrioNums = useMemo(() => hiddenPriorityNumbers(prioMap, visible.map((tk) => tk.id)), [visible, prioMap]);

  const fmtDue = (due?: string | null) => (due ? due.slice(5, 10).replace('-', '/') : '');
  const isOverdue = (tk: PopoutTask) =>
    !!tk.due_date && tk.due_date.slice(0, 10) < todayStr && !CLOSED.includes(tk.status);

  // 행 왼쪽 24px 슬롯 — 분기별로 렌더가 다르지만 폭은 항상 같다 (제목 좌측선 정렬 유지).
  const renderQuickAction = (tk: PopoutTask, qa: QuickAction, busy: boolean) => {
    // 체크/해제는 낙관적으로 이미 뒤집혀 있다 — 스피너로 덮으면 **즉시 반영을 도로 감춘다**.
    //   나머지(제출 등)는 서버 판정을 기다려야 하므로 종전대로 스피너를 보인다.
    if (busy && qa !== 'complete' && qa !== 'uncheck') return <Slot aria-hidden="true"><Spin /></Slot>;
    // 중복 제출 가드 (UI_DESIGN_GUIDE §1.8) — 처리 중엔 다른 행의 퀵액션도 잠근다.
    // 이 행만 잠근다. 옛 전역 잠금은 한 행을 누르면 목록 전체가 굳어 버렸고,
    //   그것이 느리다는 체감의 절반이었다.
    const locked = busy;
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
        // ★ 여기서 **바로 보내지 않는다** (운영 #280: "팝아웃 테스크에 나오는 보내는 아이콘은 뭐야?
        //   기존 Q task 리스트에 없는 기능은 따로 추가하기에 통일성이나 혼란이 있어서 조심해야 할 것
        //   같아. 그냥 패널열고 보내면 될 것 같은데").
        //   아이콘은 남긴다 — "이 업무는 확인 요청이 필요하다" 는 **신호**는 목록에서 보여야 한다.
        //   다만 누르면 상세를 열고, 보내는 것은 메인 Q task 와 같은 자리(상세)에서 한다.
        return (
          <SubmitBtn
            type="button" disabled={locked}
            data-testid="task-popout-submit-review"
            aria-label={t('popout.act.needSubmit', '확인 요청이 필요해요 — 눌러서 상세에서 보내기')}
            title={t('popout.act.needSubmit', '확인 요청이 필요해요 — 눌러서 상세에서 보내기')}
            onClick={() => handleRow(tk.id)}
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
        {/* ★ 제목은 탭을 따라간다 — 고정 '이번 주 내 업무' 는 오늘 탭에서 거짓말이 된다
            (memory feedback_new_behavior_makes_copy_lie). */}
        <HeadTitle>{popTab === 'today'
          ? t('popout.titleToday', '오늘 내 업무')
          : t('popout.title', '이번 주 내 업무')}</HeadTitle>
        <HeadRight>
          {/* #258 "Q task로 가는 버튼이 상단에 있어야 하지 않아? 다른 업무리스트 종류들 보고 싶으면 가서 봐야지."
              ★ 메인 탭에 부탁한다 — 이 창에서 /tasks 를 열면 팝아웃이 본체가 돼 버린다.
              ★ 메인 탭이 없으면 새 창으로 연다. `noopener` 는 쓰지 않는다 — 성공해도 핸들이 null 이라
                실패로 오판하게 된다(memory feedback_window_open_noopener_null). 대신 opener 를 끊는다. */}
          <GoMainBtn
            type="button"
            data-testid="task-popout-go-qtask"
            onClick={() => {
              requestMainNavigate('/tasks');
              // 메인 탭이 응답했는지 알 방법이 없다(단방향 방송) — 이 창은 아무것도 더 하지 않는다.
              //   메인 탭이 아예 없는 경우를 위해 사용자가 한 번 더 누르면 새 창을 여는 폴백은
              //   두지 않는다(두 번 눌러 두 탭이 뜨는 혼란 > 이득). 도크에서 다시 열면 된다.
            }}
          >{t('popout.goQTask', 'Q Task 열기')}</GoMainBtn>
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

      {/* #258 — 퀵애드. 로딩·에러 중에는 내지 않는다(기본값의 원천인 weekStart 가 아직 없다). */}
      {!loading && !error && (
        <PopoutQuickAdd
          onAdd={quickAdd}
          placeholder={popTab === 'today'
            ? t('popout.quickAddToday', '오늘 할 일 입력 후 Enter')
            : t('popout.quickAddWeek', '이번 주 할 일 입력 후 Enter')}
          addLabel={t('popout.quickAddBtn', '추가')}
          errorText={t('popout.quickAddFailed', '추가하지 못했습니다')}
          option={quickChoices.length > 0 ? {
            choices: quickChoices,
            value: quickPick,
            onChange: setQuickPick,
            placeholder: effView === 'tag'
              ? (t('popout.quickAddTagPh', '태그 선택') as string)
              : (t('popout.quickAddProjectPh', '프로젝트 선택') as string),
            ariaLabel: effView === 'tag'
              ? (t('popout.quickAddTagAria', '추가할 업무의 태그') as string)
              : (t('popout.quickAddProjectAria', '추가할 업무의 프로젝트') as string),
          } : null}
        />
      )}

      {/* #258 — 보기 기준 칩. 정본 집합은 그대로고 **나열 방식만** 바뀐다(행 개수 불변). */}
      {!loading && !error && (visible.length > 0 || doneTasks.length > 0) && (
        <PopoutViewChips
          value={effView}
          onChange={setViewMode}
          hasAnyTag={hasAnyTag}
          hasAnyProject={hasAnyProject}
          groupLabel={t('popout.viewLabel', '보기 기준') as string}
          /* 완료 가리기 — 태그별·마감일별 칩과 **같은 줄** 오른쪽 끝 (Irene 2026-08-24) */
          trailing={(openTasks.length > 0 || doneTasks.length > 0) ? (
            <DoneFilterLabel>
              <input type="checkbox" checked={hideDone} data-testid="task-popout-hide-done"
                onChange={(e) => setHideDone(e.target.checked)} />
              {t('popout.hideDoneFilter', { count: doneTasks.length, defaultValue: '완료 가리기 ({{count}})' })}
            </DoneFilterLabel>
          ) : null}
          labels={{
            tag: t('popout.viewTag', '태그별'),
            project: t('popout.viewProject', '프로젝트별'),
            due: t('popout.viewDue', '마감일별'),
          }}
        />
      )}
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
            {/* 제목과 같은 이유로 탭을 따라간다 — 오늘 탭에서 '이번 주' 라고 말하면 거짓말이다.
                퀵애드가 위에 있으므로 안내도 "적어 두라" 로 바뀐다. */}
            <EmptyTitle>{popTab === 'today'
              ? t('popout.emptyTitleToday', '오늘 할 일이 없습니다')
              : t('popout.emptyTitle', '이번 주 배정된 업무가 없습니다')}</EmptyTitle>
            <EmptyLine>{t('popout.emptyLineAdd', '위에 입력하면 바로 추가됩니다.')}</EmptyLine>
          </Center>
        )}

        {!loading && !error && visible.length > 0 && (
          <List role="list" data-testid="task-popout-list">
            {visible.map((tk, vi) => {
              // #237·#258 "태그(업무방식)별로 시각적으로 제대로 보여야" — 그룹 보기에서만 헤더를 낸다.
              //   그룹 키가 바뀌는 지점에 한 줄. 키 없는 묶음은 맨 뒤라 "태그 없음"/"프로젝트 없음" 으로 닫힌다.
              //   마감일별 보기는 그룹이 아니라 나열이므로 헤더가 없다.
              const gKey = effView === 'tag' ? repTag : effView === 'project' ? repProject : null;
              const groupHead = gKey
                ? (vi === 0 || gKey(visible[vi - 1]) !== gKey(tk)
                  ? (gKey(tk) || (effView === 'tag'
                    ? t('popout.noTagGroup', '태그 없음')
                    : t('popout.noProjectGroup', '프로젝트 없음')))
                  : null)
                : null;
              const code = displayStatus(tk, todayStr) as StatusCode;
              const color = STATUS_COLOR[code] || STATUS_COLOR.not_started;
              const role = primaryPerspective(getRoles(tk, myId));
              const rc = Number(tk.reviewer_count ?? 0) || 0;
              const qa = quickActionFor(tk.status, rc, tk.assignee_id === myId);
              const busy = busyIds.has(tk.id);
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
                          완료 업무에 우선순위를 새로 매기는 것은 무의미하고 메인에도 그 경로가 없다).
                        ★ #258 Fable 결정(G-a): **이번 주 탭에서만** 낸다. priority_order 의 의미의 고향이
                          주간 랭킹이고, 오늘 탭 디폴트인 태그 그룹 보기에서는 칩 번호와 행 순서가 항상
                          어긋난다. 오늘 ⊆ 이번 주라 관리는 탭 1회 전환으로 충분하다. */}
                    {popTab === 'week' && (CLOSED.includes(tk.status) ? (
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
                    ))}
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
                            메인 리스트는 3칩까지 편다(TagChips max prop).
                            #290 — 태그별 보기에서는 그룹 헤더가 이미 대표 태그를 말한다.
                            같은 걸 행마다 또 그리면 노이즈다(헤더=tags[0], 칩=tags[0] 으로 100% 중복이었다).
                            대표만 빼고 나머지는 남긴다 — 전부 숨기면 다중 태그 정보가 사라진다. */}
                        <TagChips tags={effView === 'tag' ? (tk.tags || []).slice(1) : tk.tags} max={1} />
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
                    {/* Irene 2026-08-23 — 리스트에서도 태그를 붙이고 뗀다.
                        ★ RowMain(button) **밖 형제**여야 한다. 안에 넣으면 button-in-button 이라
                          클릭이 행 열기로 접혀 버튼이 죽는다(위 PrioSlot·RowLead 와 같은 이유).
                        권한은 백엔드 PUT /:id/tags 의 canEdit 집합과 같은 축. */}
                    {canEditTagsFor(tk) && (
                      <TagSlot>
                        <TagQuickMenu
                          taskId={tk.id} bizId={bizId} dict={tagDict} value={tk.tags || []}
                          onDictAdd={addTagToDict}
                          onSaved={(tags) => setTasks((prev) => prev.map((x) => (x.id === tk.id ? { ...x, tags } : x)))}
                        />
                      </TagSlot>
                    )}
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

        {!loading && !error && visible.length > 0 && hiddenPrioNums.length > 0 && (
          <PrioGapHint>
            {t('popout.prioGap', {
              nums: hiddenPrioNums.join('·'),
              defaultValue: '우선순위 {{nums}} 번은 지금 목록에 없어요 — 완료했거나 다른 탭의 업무입니다. 번호는 전체 기준이라 그대로 둡니다.',
            })}
          </PrioGapHint>
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

