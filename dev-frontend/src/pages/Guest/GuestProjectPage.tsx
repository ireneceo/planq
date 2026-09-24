// 무로그인 **프로젝트 열람** 화면 (`/g/:token`, scope=project) — 1차: 개요·업무·대화
//
//   Irene: "나는 프로젝트 안 탭들 보는 그대로 프로젝트 링크 물어본건데?"
//   그래서 이 화면의 주인은 **프로젝트**고 대화는 탭 하나다(전에는 반대였다 —
//   채팅 위에 정보 띠를 얹었더니 받는 사람에게는 그냥 채팅방이었다).
//
//   설계: docs/PROJECT_EXTERNAL_VIEW_DESIGN.md §7.1·§8. 2차에서 **문서·파일 탭**을 붙였다 —
//   무인증으로 문서 본문이 나가는 지점이라 게이트를 따로 통과시킨 뒤 열었다.
//   두 탭의 목록·잠금 규약은 서버(routes/guest_project.js)가 정한다: general 열림 /
//   internal 자리는 보이고 잠김 / confidential 은 건수만 / L1 은 행 자체가 없다.
//
//   2026-09-24 (docs/GUEST_PROJECT_VIEW_DECISIONS.md §C·E·F·G) — 다섯 탭이 **같은 기둥**(guestShell),
//   문서·파일 카드, 업무·문서·파일 필터(화면 안에서만), 개요 보강(마일스톤·다음 마감·최근 문서·문의),
//   **«고객으로 등록» 문**(로그인·계정 요청 시트 한 벌). 서버 개요 라우트는 늘리지 않았다 —
//   개요는 이미 여는 /tasks·/posts 를 탭을 열 때 한 번 더 읽는다.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatPublicDate } from '../../utils/dateFormat';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import GuestChatPanel from './GuestChatPanel';
import GuestNotifySection from './GuestNotifySection';
import GuestDocsTab from './GuestDocsTab';
import GuestFilesTab from './GuestFilesTab';
import LoginRequiredSheet, { type LoginSheetReason } from './LoginRequiredSheet';
import { GuestTabPane, Empty, RetryInline, Lock, READ_W } from './guestShell';
import { CardGrid, Card, CardName, CardMeta, CardChipRow, CardChip, LockCaption, MetaFixed } from './guestCards';
import PlanQSelect from '../../components/Common/PlanQSelect';
import SearchBox from '../../components/Common/SearchBox';
import { FilterBar, FilterSlot, FilterSearchSlot, axisOption } from '../../components/Common/filterBar';
import { SegmentedToggle, SegmentedBtn } from '../../components/Common/segmentedToggle';
import { PublicWorkspaceMark, PublicSubline, type PublicWorkspace } from '../../components/Layout/PublicPageShell';

export type GuestProject = {
  name: string; description: string | null; status: string | null;
  start_date: string | null; end_date: string | null;
  stages?: { kind: string; label: string; status: string }[];
  task_summary?: { total: number; completed: number };
};

type GuestTask = {
  id: number; title: string; status: string; progress_percent: number;
  start_date: string | null; due_date: string | null; completed_at: string | null;
  is_milestone: boolean; category: string | null; assignee_name: string | null;
};
type GuestDoc = { id: number; title: string; category: string | null; updated_at: string | null; locked: boolean; author_name: string | null };

type Props = {
  token: string;
  project: GuestProject;
  workspace: PublicWorkspace | null;
  canWrite: boolean;
  /** 계정 요청을 이미 보냈는가 — 서버 ctx.account_requested. */
  accountRequested?: boolean;
  onGone: () => void;
};

type TabKey = 'overview' | 'tasks' | 'docs' | 'files' | 'chat';
const TABS: TabKey[] = ['overview', 'tasks', 'docs', 'files', 'chat'];
const CLOSED = new Set(['completed', 'canceled']);

export default function GuestProjectPage({ token, project, workspace, canWrite, accountRequested, onGone }: Props) {
  const { t } = useTranslation('guest');
  // 탭은 URL 에 싱크한다 — 뒤로가기·새로고침·공유가 탭을 지킨다(CLAUDE.md 드로어 URL 싱크와 같은 규칙).
  //   필터는 싣지 않는다 — 공유되는 주소에 검색어가 실리면 안 된다(§F).
  const [sp, setSp] = useSearchParams();
  const raw = sp.get('tab') as TabKey | null;
  const tab: TabKey = raw && TABS.includes(raw) ? raw : 'overview';
  const setTab = (next: TabKey) => {
    const p = new URLSearchParams(sp);
    if (next === 'overview') p.delete('tab'); else p.set('tab', next);
    setSp(p, { replace: true });
  };

  // ── 로그인·계정 요청 시트 — 페이지에 **한 벌**(§G). 탭은 이유만 넘긴다.
  const [sheet, setSheet] = useState<LoginSheetReason | null>(null);
  const [requested, setRequested] = useState(!!accountRequested);
  const needLogin = useCallback((reason: LoginSheetReason) => setSheet(reason), []);
  // 로그인한 사람이면 이 프로젝트를 앱에서 열 수 있는지 서버에 묻는다(auth-check). 자동으로 옮기지 않는다 —
  //   사용자가 눌러야 간다(N+72-3).
  const { isAuthenticated } = useAuth();
  const [access, setAccess] = useState<{ canAccess: boolean; appUrl: string | null } | null>(null);
  useEffect(() => {
    if (!isAuthenticated || !token) { setAccess(null); return; }
    let dead = false;
    (async () => {
      try {
        const r = await apiFetch(`/api/guest/${token}/auth-check`);
        if (!r.ok) return;
        const j = await r.json();
        if (!dead && j?.success) setAccess({ canAccess: !!j.data?.canAccess, appUrl: j.data?.appUrl || null });
      } catch { /* 모르면 «고객으로 등록» 을 그대로 둔다 */ }
    })();
    return () => { dead = true; };
  }, [isAuthenticated, token]);

  const [tasks, setTasks] = useState<GuestTask[] | null>(null);
  const [tasksErr, setTasksErr] = useState(false);
  const [docs, setDocs] = useState<GuestDoc[] | null>(null);

  // 탭 데이터는 **그 탭이 처음 열릴 때** 1회. 안 보는 탭까지 미리 받지 않는다.
  //   개요는 업무·문서를 같이 쓴다(마일스톤·다음 마감·최근 문서) — 새 서버 필드를 만들지 않는다(§E).
  const loadTasks = useCallback(async () => {
    if (!token) return;
    setTasksErr(false);
    try {
      const r = await fetch(`/api/guest/${token}/tasks`);
      if (r.status === 404) { onGone(); return; }
      if (!r.ok) { setTasksErr(true); return; }
      const j = await r.json();
      if (j.success) setTasks(j.data || []); else setTasksErr(true);
    } catch { setTasksErr(true); }
  }, [token, onGone]);
  const loadDocs = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch(`/api/guest/${token}/posts`);
      if (r.status === 404) { onGone(); return; }
      if (!r.ok) { setDocs([]); return; }
      const j = await r.json();
      setDocs(j?.success ? (j.data?.items || []) : []);
    } catch { setDocs([]); }
  }, [token, onGone]);
  useEffect(() => { if ((tab === 'tasks' || tab === 'overview') && tasks === null) void loadTasks(); }, [tab, tasks, loadTasks]);
  useEffect(() => { if (tab === 'overview' && docs === null) void loadDocs(); }, [tab, docs, loadDocs]);

  // 날짜는 **보는 사람 로케일**로.
  const period = (a: string | null, b: string | null) => {
    if (!a && !b) return '';
    return `${formatPublicDate(a)} ~ ${formatPublicDate(b)}`.trim();
  };
  const done = project.task_summary?.completed ?? 0;
  const total = project.task_summary?.total ?? 0;

  // ★ 프로젝트 상태를 **내부 값 그대로** 내보내지 않는다. 모르는 값은 원문을 그대로.
  const projectStatusLabel = (s: string | null) => {
    if (!s) return '';
    if (s === 'active') return t('proj.active', { defaultValue: '진행 중' }) as string;
    if (s === 'paused') return t('proj.paused', { defaultValue: '일시 중지' }) as string;
    if (s === 'closed') return t('proj.closed', { defaultValue: '완료' }) as string;
    return s;
  };

  // ★ 모르는 상태값을 기본값으로 떨어뜨리지 않는다 (CLAUDE.md 상태값 규약).
  const taskStatusLabel = (s: string) => {
    const known: Record<string, string> = {
      not_started: t('task.notStarted', { defaultValue: '시작 전' }) as string,
      waiting: t('task.waiting', { defaultValue: '대기' }) as string,
      in_progress: t('task.inProgress', { defaultValue: '진행 중' }) as string,
      reviewing: t('task.reviewing', { defaultValue: '확인 중' }) as string,
      revision_requested: t('task.revision', { defaultValue: '수정 요청' }) as string,
      completed: t('task.completed', { defaultValue: '완료' }) as string,
      canceled: t('task.canceled', { defaultValue: '취소됨' }) as string,
    };
    return known[s] || s;
  };

  // ── 개요 보강(§E) — 이미 받은 목록에서 **파생**한다(두 번째 공식을 만들지 않는다).
  const milestones = useMemo(() => (tasks || [])
    .filter((k) => k.is_milestone)
    .sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')))
    .slice(0, 6), [tasks]);
  const nextDue = useMemo(() => (tasks || [])
    .filter((k) => !CLOSED.has(k.status) && k.due_date)
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))[0] || null, [tasks]);
  const recentDocs = useMemo(() => (docs || []).slice(0, 3), [docs]);

  // ── 업무 필터(§F) — 화면 안에서만.
  const [taskState, setTaskState] = useState<'all' | 'open' | 'done'>('all');
  const [taskCat, setTaskCat] = useState('');
  const [taskQ, setTaskQ] = useState('');
  const taskCatOptions = useMemo(() => {
    const cats = [...new Set((tasks || []).map((k) => k.category).filter(Boolean) as string[])].sort();
    return [axisOption(t('filter.category', { defaultValue: '분류' }) as string), ...cats.map((c) => ({ value: c, label: c }))];
  }, [tasks, t]);
  const shownTasks = useMemo(() => {
    const needle = taskQ.trim().toLowerCase();
    return (tasks || []).filter((k) => {
      if (taskState === 'open' && CLOSED.has(k.status)) return false;
      if (taskState === 'done' && k.status !== 'completed') return false;
      if (taskCat && k.category !== taskCat) return false;
      return !needle || k.title.toLowerCase().includes(needle);
    });
  }, [tasks, taskState, taskCat, taskQ]);

  const wsName = workspace?.name || '';

  return (
    <Wrap>
      <Head>
        <HeadRow>
          {workspace?.name && <PublicWorkspaceMark workspace={workspace} />}
          <HeadText>
            <Title>{project.name}</Title>
            <PublicSubline workspace={workspace}
              sub={[projectStatusLabel(project.status), period(project.start_date, project.end_date)].filter(Boolean).join(' · ')
                || t('ov.projectSub', { defaultValue: '진행 상황과 문의' })} />
          </HeadText>
          {/* 문 하나 — 앱에서 열 수 있으면 [앱에서 열기], 아니면 «고객으로 등록»(§G-2·3). */}
          {access?.canAccess && access.appUrl ? (
            <HeadBtn type="button" data-testid="guest-open-app" onClick={() => { window.location.assign(access.appUrl as string); }}>
              {t('login.openInApp', { defaultValue: '앱에서 열기' })}
            </HeadBtn>
          ) : (
            <HeadBtn type="button" data-testid="guest-register" onClick={() => setSheet('register')}>
              {requested
                ? t('login.registerSent', { defaultValue: '요청 보냄' })
                : t('login.register', { defaultValue: '고객으로 등록' })}
            </HeadBtn>
          )}
        </HeadRow>
      </Head>

      <TabBar role="tablist" aria-label={t('tabs.aria', { defaultValue: '프로젝트 탭' }) as string}>
        <Tab type="button" role="tab" aria-selected={tab === 'overview'} $on={tab === 'overview'}
          data-testid="guest-tab-overview" onClick={() => setTab('overview')}>
          {t('tabs.overview', { defaultValue: '개요' })}
        </Tab>
        <Tab type="button" role="tab" aria-selected={tab === 'tasks'} $on={tab === 'tasks'}
          data-testid="guest-tab-tasks" onClick={() => setTab('tasks')}>
          {t('tabs.tasks', { defaultValue: '업무' })}
          {total > 0 && <Count>{total}</Count>}
        </Tab>
        <Tab type="button" role="tab" aria-selected={tab === 'docs'} $on={tab === 'docs'}
          data-testid="guest-tab-docs" onClick={() => setTab('docs')}>
          {t('tabs.docs', { defaultValue: '문서' })}
        </Tab>
        <Tab type="button" role="tab" aria-selected={tab === 'files'} $on={tab === 'files'}
          data-testid="guest-tab-files" onClick={() => setTab('files')}>
          {t('tabs.files', { defaultValue: '파일' })}
        </Tab>
        <Tab type="button" role="tab" aria-selected={tab === 'chat'} $on={tab === 'chat'}
          data-testid="guest-tab-chat" onClick={() => setTab('chat')}>
          {t('tabs.chat', { defaultValue: '대화' })}
        </Tab>
      </TabBar>

      {tab === 'overview' && (
        <GuestTabPane data-testid="guest-tab-body-overview">
          {project.description && <OvDesc>{project.description}</OvDesc>}
          <OvSection>
            <OvLabel>{t('ov.stages', { defaultValue: '진행 단계' })}</OvLabel>
            {project.stages?.length ? (
              <StageRow>
                {project.stages.map((st, i) => <StageChip key={i} $state={st.status}>{st.label}</StageChip>)}
              </StageRow>
            ) : <OvEmpty>{t('ov.stagesEmpty', { defaultValue: '아직 등록된 단계가 없어요.' })}</OvEmpty>}
          </OvSection>
          <OvSection>
            <OvLabel>{t('ov.tasks', { defaultValue: '업무 진행' })}</OvLabel>
            {total > 0 ? (
              <>
                <OvValue>{t('ov.taskCount', { defaultValue: '{{done}} / {{total}} 완료', done, total })}</OvValue>
                <Bar aria-hidden><BarFill style={{ width: `${Math.round((done / Math.max(1, total)) * 100)}%` }} /></Bar>
              </>
            ) : <OvEmpty>{t('ov.tasksEmpty', { defaultValue: '아직 등록된 업무가 없어요.' })}</OvEmpty>}
          </OvSection>
          {nextDue && (
            <OvSection data-testid="guest-ov-nextdue">
              <OvLabel>{t('ov.nextDue', { defaultValue: '다음 마감' })}</OvLabel>
              <OvValue>{nextDue.title} · {formatPublicDate(nextDue.due_date)}</OvValue>
            </OvSection>
          )}
          {milestones.length > 0 && (
            <OvSection data-testid="guest-ov-milestones">
              <OvLabel>{t('ov.milestones', { defaultValue: '마일스톤' })}</OvLabel>
              <MsList>
                {milestones.map((k) => (
                  <MsRow key={k.id} data-testid={`guest-ov-ms-${k.id}`}>
                    <Milestone aria-hidden>◆</Milestone>
                    <MsTitle>{k.title}</MsTitle>
                    <TaskStatus $done={k.status === 'completed'}>{taskStatusLabel(k.status)}</TaskStatus>
                    {(k.start_date || k.due_date) && <MsDate>{period(k.start_date, k.due_date)}</MsDate>}
                  </MsRow>
                ))}
              </MsList>
            </OvSection>
          )}
          {recentDocs.length > 0 && (
            <OvSection data-testid="guest-ov-docs">
              <OvHeadRow>
                <OvLabel>{t('ov.recentDocs', { defaultValue: '최근 문서' })}</OvLabel>
                <LinkBtn type="button" onClick={() => setTab('docs')}>{t('ov.allDocs', { defaultValue: '문서 탭 전체 보기' })}</LinkBtn>
              </OvHeadRow>
              <CardGrid>
                {recentDocs.map((d) => (
                  <Card key={d.id} type="button" $dim={d.locked}
                    onClick={() => { if (d.locked) setSheet('locked-doc'); else setTab('docs'); }}>
                    <CardChipRow>{d.category && <CardChip>{d.category}</CardChip>}</CardChipRow>
                    <CardName $clamp>
                      {d.locked && <Lock />}
                      <span>{d.title}</span>
                    </CardName>
                    {/* 문서 탭 카드와 **같은 부품·같은 표시**(§E «§D 부품 그대로», Fable F3) — 잠긴 것이 열린 것처럼 읽히면 안 된다. */}
                    {d.locked
                      ? <LockCaption>{t('login.lockedCaption', { defaultValue: '로그인하면 볼 수 있어요' })}</LockCaption>
                      : <CardMeta>{d.updated_at && <MetaFixed>{formatPublicDate(d.updated_at)}</MetaFixed>}</CardMeta>}
                  </Card>
                ))}
              </CardGrid>
            </OvSection>
          )}
          {/* 문의 창구 — 문장이 아니라 **버튼**이다(§E-4). */}
          <AskBtn type="button" data-testid="guest-ov-ask" onClick={() => setTab('chat')}>
            {wsName
              ? t('ov.askWs', { defaultValue: '{{name}}에 문의하기', name: wsName })
              : t('ov.ask', { defaultValue: '담당자에게 문의하기' })}
          </AskBtn>
        </GuestTabPane>
      )}

      {tab === 'tasks' && (
        <GuestTabPane data-testid="guest-tab-body-tasks">
          {tasksErr ? (
            <OvEmpty>
              {t('tasks.failed', { defaultValue: '업무를 불러오지 못했습니다.' })}{' '}
              <RetryInline type="button" onClick={() => void loadTasks()}>{t('retry', { defaultValue: '다시 시도' })}</RetryInline>
            </OvEmpty>
          ) : tasks === null ? (
            <OvEmpty>{t('loading', { defaultValue: '불러오는 중…' })}</OvEmpty>
          ) : tasks.length === 0 ? (
            <OvEmpty>{t('ov.tasksEmpty', { defaultValue: '아직 등록된 업무가 없어요.' })}</OvEmpty>
          ) : (
            <>
              <FilterBar data-testid="guest-tasks-filter">
                <FilterPills role="tablist" aria-label={t('filter.state', { defaultValue: '상태' }) as string}>
                  {(['all', 'open', 'done'] as const).map((k) => (
                    <SegmentedBtn key={k} type="button" role="tab" aria-selected={taskState === k} $active={taskState === k}
                      data-testid={`guest-tasks-state-${k}`} onClick={() => setTaskState(k)}>
                      {k === 'all' ? t('filter.stateAll', { defaultValue: '전체' })
                        : k === 'open' ? t('filter.stateOpen', { defaultValue: '진행 중' })
                          : t('filter.stateDone', { defaultValue: '완료' })}
                    </SegmentedBtn>
                  ))}
                </FilterPills>
                <FilterSearchSlot>
                  <SearchBox value={taskQ} onChange={setTaskQ} width="100%"
                    placeholder={t('filter.search', { defaultValue: '제목 검색' }) as string}
                    ariaLabel={t('filter.search', { defaultValue: '제목 검색' }) as string} />
                </FilterSearchSlot>
                {taskCatOptions.length > 1 && (
                  <FilterSlot width={140} testId="guest-tasks-cat">
                    <PlanQSelect size="sm" isSearchable={false} options={taskCatOptions}
                      aria-label={t('filter.category', { defaultValue: '분류' }) as string}
                      value={taskCatOptions.find((o) => o.value === taskCat) || taskCatOptions[0]}
                      onChange={(opt: unknown) => setTaskCat(String((opt as { value?: string } | null)?.value ?? ''))} />
                  </FilterSlot>
                )}
              </FilterBar>
              {shownTasks.length === 0 ? (
                <Empty data-testid="guest-tasks-nomatch">{t('filter.noMatch', { defaultValue: '조건에 맞는 항목이 없어요.' })}</Empty>
              ) : (
                <TaskList>
                  {shownTasks.map((k) => (
                    <TaskRow key={k.id} data-testid={`guest-task-${k.id}`}>
                      <TaskMain>
                        <TaskTitle>
                          {k.is_milestone && <Milestone aria-hidden>◆</Milestone>}
                          {k.title}
                        </TaskTitle>
                        <TaskMeta>
                          {k.assignee_name && <span>{k.assignee_name}</span>}
                          <TaskStatus $done={k.status === 'completed'}>{taskStatusLabel(k.status)}</TaskStatus>
                          {(k.start_date || k.due_date) && <span>{period(k.start_date, k.due_date)}</span>}
                        </TaskMeta>
                      </TaskMain>
                      <TaskPct>{k.progress_percent ?? 0}%</TaskPct>
                    </TaskRow>
                  ))}
                </TaskList>
              )}
            </>
          )}
        </GuestTabPane>
      )}

      {/* 문서·파일은 **그 탭을 열 때 마운트**한다 — 안 보는 탭의 목록을 미리 받지 않는다.
          (대화 탭만 예외: 쓰던 글을 지키려고 계속 붙여 둔다.) */}
      {tab === 'docs' && <GuestDocsTab token={token} onGone={onGone} onNeedLogin={needLogin} />}
      {tab === 'files' && <GuestFilesTab token={token} onGone={onGone} onNeedLogin={needLogin} />}

      {/* 대화 탭은 **패널을 계속 붙여 둔다** — 탭을 오갈 때마다 다시 만들면 쓰던 글이 사라진다.
          보이지 않을 때는 폴링만 멈춘다(active=false). */}
      <ChatWrap $on={tab === 'chat'} data-testid="guest-tab-body-chat">
        {/* 답글 알림 신청 — 대화 화면과 **같은 부품**(설계 §7.1, 2026-09-05 Fable 지적 D3). */}
        <NotifyColumn><GuestNotifySection token={token} onGone={onGone} /></NotifyColumn>
        <GuestChatPanel token={token} canWrite={canWrite} active={tab === 'chat'} onGone={onGone} column />
      </ChatWrap>

      <LoginRequiredSheet
        open={!!sheet}
        onClose={() => setSheet(null)}
        reason={sheet || 'register'}
        token={token}
        tab={tab}
        requested={requested}
        onRequested={() => setRequested(true)}
        notInvited={!!access && !access.canAccess}
        onGone={onGone}
      />
    </Wrap>
  );
}

const Wrap = styled.div`display:flex;flex-direction:column;height:100dvh;background:#f8fafc;`;
// 필터 줄 안의 알약 — 한 줄 안 컨트롤은 **36** 이다(필터줄 계약). 머리줄용 32 를 그대로 쓰면 줄이 들쭉날쭉하다(Fable F4).
const FilterPills = styled(SegmentedToggle)`height:36px;`;
const Head = styled.div`
  min-height:60px;background:#fff;border-bottom:1px solid #e2e8f0;flex-shrink:0;
  padding:14px 20px;
  @media (max-width:640px){ padding:12px 16px; }
  > div { width:100%; max-width:${READ_W}; margin:0 auto; }
`;
// 로고 + 제목 칸. Head 의 직계 div 규칙(READ_W 기둥)이 이 줄에 걸리므로 본문과 같은 기둥에 선다.
const HeadRow = styled.div`display:flex;align-items:center;gap:8px;`;
const HeadText = styled.div`min-width:0;flex:1;`;
const Title = styled.div`font-size:1.125rem;font-weight:700;letter-spacing:-0.2px;color:#0f172a;`;
// 헤더 오른쪽 문 — Secondary 톤(3톤 규칙). 폰에서도 40 이상.
const HeadBtn = styled.button`
  flex-shrink:0;min-height:36px;padding:0 12px;border-radius:8px;cursor:pointer;
  border:1px solid #cbd5e1;background:#fff;color:#334155;font-size:0.8125rem;font-weight:600;white-space:nowrap;
  &:hover{border-color:#14B8A6;color:#0F766E;}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;}
  @media (max-width:640px){ min-height:40px; }
`;
const TabBar = styled.div`
  display:flex;gap:2px;background:#fff;border-bottom:1px solid #e2e8f0;flex-shrink:0;
  overflow-x:auto;-webkit-overflow-scrolling:touch;
  /* 탭도 본문과 같은 기둥에 세운다 — 안 그러면 탭은 화면 끝, 글은 가운데가 된다. */
  padding:0 12px;
  > * { flex-shrink:0; }
  justify-content:flex-start;
  &::after { content:''; }
  @media (min-width:${READ_W}) { padding-left:calc((100% - ${READ_W}) / 2 + 12px); padding-right:calc((100% - ${READ_W}) / 2 + 12px); }
`;
const Tab = styled.button<{ $on: boolean }>`
  display:inline-flex;align-items:center;gap:6px;flex-shrink:0;
  height:44px;padding:0 14px;border:none;background:none;cursor:pointer;
  /* 폰에서는 다섯 탭이 **한 줄에 다 보이게** — 영어 375 에서 마지막 탭(Chat)이 잘려 가로로 밀어야 한다는 걸 알 수 없었다. */
  @media (max-width:640px){ padding:0 9px; }
  font-size:0.875rem;font-weight:${p => (p.$on ? 700 : 500)};
  color:${p => (p.$on ? '#0F766E' : '#64748B')};
  box-shadow:${p => (p.$on ? 'inset 0 -2px 0 #14B8A6' : 'none')};
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:-2px;}
`;
// 배지 — 컨트롤이 아니라 표시다. 높이를 px 로 박지 않고 padding·line-height 로 잡는다.
const Count = styled.span`
  display:inline-flex;align-items:center;justify-content:center;min-width:18px;padding:1px 6px;line-height:1.45;
  border-radius:999px;background:#F1F5F9;color:#475569;font-size:0.6875rem;font-weight:700;
`;
const OvDesc = styled.p`margin-top:0;margin-bottom:0;font-size:0.8125rem;color:#475569;line-height:1.55;white-space:pre-wrap;`;
const OvSection = styled.div`display:flex;flex-direction:column;gap:6px;`;
const OvHeadRow = styled.div`display:flex;align-items:center;justify-content:space-between;gap:8px;`;
const OvLabel = styled.div`font-size:0.6875rem;font-weight:600;color:#94a3b8;letter-spacing:-0.1px;`;
const OvValue = styled.div`font-size:0.8125rem;color:#334155;`;
const OvEmpty = styled.div`font-size:0.8125rem;color:#94a3b8;`;
const StageRow = styled.div`display:flex;flex-wrap:wrap;gap:6px;`;
const StageChip = styled.span<{ $state: string }>`
  display:inline-flex;align-items:center;padding:3px 10px;border-radius:999px;
  font-size:0.6875rem;font-weight:600;
  background:${p => (p.$state === 'completed' ? '#CCFBF1' : p.$state === 'active' ? '#FEF3C7' : '#F1F5F9')};
  color:${p => (p.$state === 'completed' ? '#0F766E' : p.$state === 'active' ? '#92400E' : '#64748B')};
`;
const Bar = styled.div`height:6px;border-radius:999px;background:#F1F5F9;overflow:hidden;`;
const BarFill = styled.div`height:100%;background:#14B8A6;border-radius:999px;`;
const MsList = styled.div`display:flex;flex-direction:column;gap:6px;`;
const MsRow = styled.div`display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;font-size:0.8125rem;color:#334155;`;
const MsTitle = styled.span`min-width:0;word-break:break-word;`;
const MsDate = styled.span`font-size:0.6875rem;color:#94A3B8;`;
const LinkBtn = styled.button`
  border:none;background:none;padding:0;color:#0D9488;font-size:0.75rem;font-weight:700;cursor:pointer;
  &:hover{text-decoration:underline;}
`;
const AskBtn = styled.button`
  align-self:flex-start;min-height:40px;padding:0 16px;border-radius:10px;cursor:pointer;
  border:none;background:#14B8A6;color:#fff;font-size:0.875rem;font-weight:700;
  &:hover{background:#0D9488;}
  &:focus-visible{outline:2px solid #0D9488;outline-offset:2px;}
`;
const TaskList = styled.div`display:flex;flex-direction:column;gap:0;background:#fff;border:1px solid #E2E8F0;border-radius:12px;overflow:hidden;`;
const TaskRow = styled.div`
  display:flex;align-items:center;gap:10px;padding:11px 14px;border-bottom:1px solid #F1F5F9;
  &:last-child{border-bottom:none;}
`;
const TaskMain = styled.div`flex:1 1 0;min-width:0;`;
const TaskTitle = styled.div`font-size:0.875rem;color:#0F172A;line-height:1.4;word-break:break-word;`;
const Milestone = styled.span`color:#14B8A6;margin-right:5px;`;
const TaskMeta = styled.div`display:flex;gap:8px;flex-wrap:wrap;margin-top:3px;font-size:0.6875rem;color:#94A3B8;`;
const TaskStatus = styled.span<{ $done: boolean }>`color:${p => (p.$done ? '#0F766E' : '#64748B')};font-weight:600;`;
const TaskPct = styled.div`flex-shrink:0;font-size:0.75rem;font-weight:700;color:#475569;`;
// 대화 탭 — 숨길 때도 **언마운트하지 않는다**(쓰던 글 보존). 자리만 접는다.
const ChatWrap = styled.div<{ $on: boolean }>`
  display:${p => (p.$on ? 'flex' : 'none')};
  flex-direction:column;flex:1;min-height:0;
`;
// 알림 신청 띠도 같은 기둥 — 안 그러면 대화 탭에서만 띠가 화면 끝까지 늘어난다.
const NotifyColumn = styled.div`
  flex-shrink:0;padding:0 20px;
  @media (max-width:640px){ padding:0 16px; }
  > * { width:100%; max-width:${READ_W}; margin-left:auto; margin-right:auto; }
`;
