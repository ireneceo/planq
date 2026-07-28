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
import styled from 'styled-components';
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
  Project?: { id: number; name: string } | null;
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

  const openTasks = tasks.filter((tk) => !CLOSED.includes(tk.status));
  const doneTasks = tasks.filter((tk) => CLOSED.includes(tk.status));
  const visible = showDone ? [...openTasks, ...doneTasks] : openTasks;

  const fmtDue = (due?: string | null) => (due ? due.slice(5, 10).replace('-', '/') : '');
  const isOverdue = (tk: PopoutTask) =>
    !!tk.due_date && tk.due_date.slice(0, 10) < todayStr && !CLOSED.includes(tk.status);

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
              return (
                <Row
                  key={tk.id}
                  role="listitem"
                  type="button"
                  data-testid="task-popout-row"
                  $active={selectedId === tk.id}
                  $dim={CLOSED.includes(tk.status)}
                  onClick={() => handleRow(tk.id)}
                >
                  <RowTop>
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
const Row = styled.button<{ $active: boolean; $dim: boolean }>`
  width: 100%; text-align: left;
  display: flex; flex-direction: column; gap: 6px;
  padding: 10px 12px;
  background: #FFFFFF;
  border: 1px solid ${({ $active }) => ($active ? '#0F766E' : '#E2E8F0')};
  border-radius: 10px;
  cursor: pointer;
  opacity: ${({ $dim }) => ($dim ? 0.6 : 1)};
  transition: border-color 0.12s, box-shadow 0.12s;
  &:hover { box-shadow: 0 2px 10px rgba(15,23,42,0.08); }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
`;
const RowTop = styled.div`
  display: flex; align-items: flex-start; gap: 8px;
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
