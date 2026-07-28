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
import styled, { keyframes } from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth, apiFetch } from '../../contexts/AuthContext';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { joinRoom, leaveRoom, onSocket, getSocket } from '../../services/socket';
import TaskDetailDrawer, { type DrawerMemberOption } from './TaskDetailDrawer';
import { STATUS_COLOR, displayStatus, getStatusLabel, type StatusCode } from '../../utils/taskLabel';
import { getRoles, primaryPerspective } from '../../utils/taskRoles';

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

export function quickActionFor(status: string, reviewerCount: number): QuickAction {
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

const TaskPopoutView: React.FC = () => {
  const { t } = useTranslation('qtask');
  const { user } = useAuth();
  const bizId = user?.business_id ? Number(user.business_id) : null;
  const myId = user ? Number(user.id) : -1;
  const todayStr = useMemo(() => {
    // 로컬 기준 오늘 (toISOString 은 UTC 라 KST 자정 직후 전날로 밀린다)
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  const [tasks, setTasks] = useState<PopoutTask[]>([]);
  const [summary, setSummary] = useState<WeekSummary | null>(null);
  const [members, setMembers] = useState<DrawerMemberOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showDone, setShowDone] = useState(false);

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
      .sort((a, b) => (a.priority_order! - b.priority_order!)
        || (doneRank(a) - doneRank(b))
        || cmpNullLast(a.due_date, b.due_date)
        || (a.title || '').localeCompare(b.title || ''))
      .forEach((tk, i) => m.set(tk.id, i + 1));
    return m;
  }, [tasks]);

  const openTasks = useMemo(
    () => tasks.filter((tk) => !CLOSED.includes(tk.status)).sort(bySortRule), [tasks]);
  const doneTasks = useMemo(
    () => tasks.filter((tk) => CLOSED.includes(tk.status)).sort(bySortRule), [tasks]);
  const visible = showDone ? [...openTasks, ...doneTasks] : openTasks;

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
        {summary && (
          <HeadMeta>
            {t('popout.summary', '{{open}}건 진행 · 남은 {{hours}}h', {
              open: openTasks.length,
              hours: Math.round((summary.total_remaining || 0) * 10) / 10,
            })}
          </HeadMeta>
        )}
      </Head>

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
            {visible.map((tk) => {
              const code = displayStatus(tk, todayStr) as StatusCode;
              const color = STATUS_COLOR[code] || STATUS_COLOR.not_started;
              const role = primaryPerspective(getRoles(tk, myId));
              const rc = Number(tk.reviewer_count ?? 0) || 0;
              const qa = quickActionFor(tk.status, rc);
              const busy = busyId === tk.id;
              return (
                // ★ Row 는 div 다. 체크박스 버튼과 본문 버튼은 **형제** — 중첩하면 button-in-button 이 되어
                //   HTML 상 무효이고 브라우저가 클릭 타깃을 임의로 접는다(stopPropagation 으로 못 막는다).
                <Row
                  key={tk.id}
                  role="listitem"
                  data-testid="task-popout-row"
                  $active={selectedId === tk.id}
                  $dim={CLOSED.includes(tk.status)}
                >
                  <RowInner>
                    <RowLead>{renderQuickAction(tk, qa, busy)}</RowLead>
                    <RowMain
                      type="button"
                      data-testid="task-popout-row-open"
                      onClick={() => handleRow(tk.id)}
                    >
                      <RowTop>
                        {/* 우선순위 — 표시 전용(span). 조작은 메인 Q Task 화면이 단일 기록자다:
                            팝아웃 집합은 메인 filtered 의 부분집합이라 여기서 토글하면 부분집합 기준
                            재인덱스 write 가 나가 메인의 번호 체계를 오염시킨다. 지정 안 된 행은 칩 없음. */}
                        {prioMap.has(tk.id) && (
                          <PrioChip
                            $dim={CLOSED.includes(tk.status)}
                            aria-label={t('popout.priorityN', '우선순위 {{n}}', { n: prioMap.get(tk.id) })}
                            title={t('popout.priorityN', '우선순위 {{n}}', { n: prioMap.get(tk.id) })}
                          >{prioMap.get(tk.id)}</PrioChip>
                        )}
                        <Badge $bg={color.bg} $fg={color.fg}>{getStatusLabel(tk, role, todayStr, t as never)}</Badge>
                        <RowTitle>{tk.title}</RowTitle>
                      </RowTop>
                      <RowMeta>
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
              );
            })}
          </List>
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

// ===== styled =====
const Wrap = styled.div`
  display: flex; flex-direction: column;
  height: 100%; min-height: 0;
  background: #F8FAFC;
`;
// PageShell/PanelHeader 표준값과 동일 (min-height 60px · padding 14px 20px · 18px/700)
const Head = styled.div`
  min-height: 60px; box-sizing: border-box;
  padding: 14px 20px;
  display: flex; align-items: center; gap: 10px;
  background: #FFFFFF; border-bottom: 1px solid #E2E8F0;
  flex-shrink: 0;
`;
const HeadTitle = styled.h1`
  margin: 0; font-size: 18px; font-weight: 700; letter-spacing: -0.2px; color: #0F172A;
`;
const HeadMeta = styled.span`
  font-size: 12px; color: #64748B; margin-left: auto; white-space: nowrap;
`;
const Body = styled.div`
  flex: 1; min-height: 0; overflow-y: auto;
  padding: 12px;
`;
const List = styled.div`
  display: flex; flex-direction: column; gap: 8px;
`;
// ★ div 다 — 안에 체크박스 버튼이 들어가므로 button 이면 중첩이 된다.
const Row = styled.div<{ $active: boolean; $dim: boolean }>`
  display: flex; flex-direction: column; gap: 6px;
  padding: 10px 12px;
  background: #FFFFFF;
  border: 1px solid ${({ $active }) => ($active ? '#0F766E' : '#E2E8F0')};
  border-radius: 10px;
  opacity: ${({ $dim }) => ($dim ? 0.6 : 1)};
  transition: border-color 0.12s, box-shadow 0.12s;
  &:hover { box-shadow: 0 2px 10px rgba(15,23,42,0.08); }
`;
const RowInner = styled.div`
  display: flex; align-items: center; gap: 6px;
`;
const RowLead = styled.div`
  flex-shrink: 0;
`;
// 본문 클릭영역 — 드로어를 여는 버튼. 카드 테두리는 Row 가 그리므로 여기선 투명.
const RowMain = styled.button`
  flex: 1; min-width: 0;
  text-align: left;
  display: flex; flex-direction: column; gap: 6px;
  margin: 0; padding: 0; border: 0; background: transparent;
  cursor: pointer;
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 3px; border-radius: 6px; }
`;
// 퀵액션 슬롯 — 분기가 달라도 폭·높이 동일 (터치 타겟 36, CLAUDE.md 반응형 원칙 2)
const Slot = styled.span`
  width: 36px; height: 36px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
`;
const CheckBtn = styled.button<{ $checked?: boolean; $locked?: boolean }>`
  width: 36px; height: 36px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0; border: 0; background: transparent;
  cursor: ${({ $locked }) => ($locked ? 'default' : 'pointer')};
  &::before {
    content: ''; position: absolute;
    width: 20px; height: 20px; border-radius: 6px;
    box-sizing: border-box;
    background: ${({ $checked }) => ($checked ? '#0F766E' : 'transparent')};
    border: 2px solid ${({ $checked }) => ($checked ? '#0F766E' : '#CBD5E1')};
    transition: border-color 0.12s, background 0.12s;
  }
  position: relative;
  ${({ $locked, $checked }) => ($locked ? `
    &::before { background: #94A3B8; border-color: #94A3B8; }
  ` : `
    &:hover::before { border-color: ${$checked ? '#0D9488' : '#0F766E'}; ${$checked ? 'background:#0D9488;' : ''} }
  `)}
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 0; border-radius: 8px; }
  &:disabled { cursor: default; opacity: 0.5; }
  > svg { position: relative; z-index: 1; }
`;
const SubmitBtn = styled.button`
  width: 36px; height: 36px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0; border: 0; background: transparent;
  cursor: pointer; color: #0F766E;
  &::before {
    content: ''; position: absolute;
    width: 24px; height: 24px; border-radius: 50%;
    border: 1px dashed #99F6E4; box-sizing: border-box;
    transition: background 0.12s, border-color 0.12s;
  }
  position: relative;
  &:hover::before { background: #F0FDFA; border-color: #0F766E; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 0; border-radius: 50%; }
  &:disabled { cursor: default; opacity: 0.5; }
  > svg { position: relative; z-index: 1; }
`;
const pulse = keyframes`
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.35; transform: scale(0.75); }
`;
const WaitDot = styled.span`
  width: 8px; height: 8px; border-radius: 50%;
  background: #94A3B8;
  animation: ${pulse} 1.4s ease-in-out infinite;
`;
const spin = keyframes`to { transform: rotate(360deg); }`;
const Spin = styled.span`
  width: 16px; height: 16px; border-radius: 50%;
  border: 2px solid #E2E8F0; border-top-color: #0F766E;
  animation: ${spin} 0.7s linear infinite;
`;
const RowErr = styled.div`
  margin-left: 42px;
  padding: 4px 8px; border-radius: 6px;
  background: #FEF2F2; color: #BE123C;
  font-size: 11.5px; font-weight: 600; line-height: 1.4;
`;
const CheckIcon: React.FC = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M2.5 6.2 L4.8 8.5 L9.5 3.6" stroke="#FFFFFF" strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const SendIcon: React.FC = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M1.6 7 L12.4 2.2 L9.9 11.8 L7.2 8.4 Z" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const RowTop = styled.div`
  display: flex; align-items: flex-start; gap: 8px;
`;
// 우선순위 번호 — 메인 PrioNum 의 색 언어를 그대로(활성 Teal). 단 여기선 클릭 없는 span 이다.
const PrioChip = styled.span<{ $dim: boolean }>`
  flex-shrink: 0;
  width: 20px; height: 20px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 50%;
  font-size: 11px; font-weight: 800; line-height: 1;
  background: ${({ $dim }) => ($dim ? '#F1F5F9' : '#14B8A6')};
  color: ${({ $dim }) => ($dim ? '#94A3B8' : '#FFFFFF')};
`;
const Badge = styled.span<{ $bg: string; $fg: string }>`
  flex-shrink: 0;
  padding: 2px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 700;
  background: ${({ $bg }) => $bg}; color: ${({ $fg }) => $fg};
  white-space: nowrap;
`;
const RowTitle = styled.span`
  font-size: 13.5px; font-weight: 600; color: #0F172A; line-height: 1.4;
  word-break: break-word;
`;
const RowMeta = styled.div`
  display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
  font-size: 11.5px; color: #64748B;
`;
const MetaChip = styled.span`
  padding: 1px 6px; border-radius: 6px; background: #F1F5F9; color: #475569;
`;
const MetaDue = styled.span<{ $overdue: boolean }>`
  font-weight: ${({ $overdue }) => ($overdue ? 700 : 500)};
  color: ${({ $overdue }) => ($overdue ? '#BE123C' : '#64748B')};
`;
const ToggleDone = styled.button`
  width: 100%; margin-top: 10px;
  padding: 8px; border: 1px dashed #CBD5E1; border-radius: 8px;
  background: transparent; cursor: pointer;
  font-size: 12px; font-weight: 600; color: #64748B;
  &:hover { border-color: #94A3B8; color: #475569; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
`;
const Center = styled.div`
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  padding: 48px 20px; text-align: center;
  font-size: 13px; color: #94A3B8;
`;
const EmptyTitle = styled.div`font-size: 14px; font-weight: 700; color: #475569;`;
const EmptyLine = styled.div`font-size: 12.5px; color: #94A3B8;`;
const ErrText = styled.div`font-size: 13px; color: #BE123C;`;
const RetryBtn = styled.button`
  padding: 7px 14px; border: 1px solid #E2E8F0; border-radius: 8px;
  background: #FFFFFF; cursor: pointer; font-size: 12.5px; font-weight: 600; color: #0F172A;
  &:hover { border-color: #0F766E; color: #0F766E; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
`;
