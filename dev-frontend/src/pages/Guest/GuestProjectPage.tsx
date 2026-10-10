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
//
//   2026-10-10 (docs/GUEST_PROJECT_VIEW_DECISIONS.md §I — Irene: «기본 정보·주요 이슈·통계·업무 진행 통계·히스토리가
//   제대로 제공이 안 돼») — 개요에 **기본 정보 표(항상)·업무 통계(guestTaskStats 한 곳)·주요 이슈 3**, 6번째 탭 **히스토리**
//   (사람이 «고객에게 보이기» 를 켠 주요 이슈 + 업무 완료·마일스톤). 서버 개요 라우트는 여전히 늘리지 않는다 —
//   새로 읽는 것은 /files(건수)와 /history(항목마다 켠 것만) 둘이다.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatPublicDate } from '../../utils/dateFormat';
import { computeTaskStats, STATUS_BUCKETS, localYmd, type StatusBucket } from './guestTaskStats';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import GuestChatPanel from './GuestChatPanel';
import GuestNotifySection from './GuestNotifySection';
import GuestDocsTab from './GuestDocsTab';
import GuestFilesTab from './GuestFilesTab';
import LoginRequiredSheet, { type LoginSheetReason } from './LoginRequiredSheet';
import {
  GuestTabPane, Empty, RetryInline, Lock,
  // 껍데기는 한 벌이다 — 워크스페이스 창구 화면(GuestWorkspacePage)이 **같은 것**을 쓴다.
  Wrap, Head, HeadRow, HeadText, Title, HeadBtn, TabBar, Tab, Count, NotifyColumn,
} from './guestShell';
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
/** 공개된 주요 이슈 — 서버 `/history` 가 주는 네 키뿐(§I-2). */
type GuestIssue = { id: number; occurred_at: string; title: string; body: string | null };
/** 히스토리 탭 한 줄 — 주요 이슈(★)·업무 완료(✓)·마일스톤 완료(◆)를 한 시간축에 합친다. */
type TimelineItem = { key: string; at: string; kind: 'issue' | 'done' | 'milestone'; title: string; body?: string | null };

type Props = {
  token: string;
  project: GuestProject;
  workspace: PublicWorkspace | null;
  canWrite: boolean;
  /** 계정 요청을 이미 보냈는가 — 서버 ctx.account_requested. */
  accountRequested?: boolean;
  onGone: () => void;
};

type TabKey = 'overview' | 'tasks' | 'history' | 'docs' | 'files' | 'chat';
const TABS: TabKey[] = ['overview', 'tasks', 'history', 'docs', 'files', 'chat'];
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
  // 개요의 «파일 N» — 파일 탭과 같은 응답에서 센다(보이는 행 + 이름도 못 보이는 건수).
  const [fileCount, setFileCount] = useState<number | null>(null);
  const [issues, setIssues] = useState<GuestIssue[] | null>(null);
  const [issuesErr, setIssuesErr] = useState(false);

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
  const loadFileCount = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch(`/api/guest/${token}/files`);
      if (r.status === 404) { onGone(); return; }
      if (!r.ok) return;
      const j = await r.json();
      if (j?.success) setFileCount((j.data?.items || []).length + (Number(j.data?.locked_count) || 0));
    } catch { /* 모르면 «—» */ }
  }, [token, onGone]);
  const loadIssues = useCallback(async () => {
    if (!token) return;
    setIssuesErr(false);
    try {
      const r = await fetch(`/api/guest/${token}/history`);
      if (r.status === 404) { onGone(); return; }
      if (!r.ok) { setIssuesErr(true); return; }
      const j = await r.json();
      if (j?.success) setIssues(j.data?.items || []); else setIssuesErr(true);
    } catch { setIssuesErr(true); }
  }, [token, onGone]);
  useEffect(() => { if ((tab === 'tasks' || tab === 'overview' || tab === 'history') && tasks === null) void loadTasks(); }, [tab, tasks, loadTasks]);
  useEffect(() => { if (tab === 'overview' && docs === null) void loadDocs(); }, [tab, docs, loadDocs]);
  useEffect(() => { if (tab === 'overview' && fileCount === null) void loadFileCount(); }, [tab, fileCount, loadFileCount]);
  useEffect(() => { if ((tab === 'overview' || tab === 'history') && issues === null && !issuesErr) void loadIssues(); }, [tab, issues, issuesErr, loadIssues]);

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

  // 시각(DATETIME) → 보는 사람 로컬 날짜. formatPublicDate 는 문자열 앞 10자리를 쓰므로 UTC 날짜가 된다.
  const dayOf = (v: string | null | undefined) => (v ? formatPublicDate(localYmd(new Date(v))) : '');

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
      // 2026-10-10 — 이 셋을 몰라 운영 고객 링크에 `done_feedback` 같은 원문 값이 그대로 나갔다.
      done_feedback: t('task.doneFeedback', { defaultValue: '마무리 대기' }) as string,
      on_hold: t('task.onHold', { defaultValue: '보류' }) as string,
      external_review: t('task.externalReview', { defaultValue: '외부 확인 중' }) as string,
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
  // 업무 통계(§I-1) — 순수 함수 한 곳. 진행률은 여기서 내지 않는다(서버 task_summary 하나).
  const stats = useMemo(() => (tasks ? computeTaskStats(tasks, { serverTotal: total }) : null), [tasks, total]);
  const bucketLabel = (b: StatusBucket) => ({
    waiting: t('stats.bWaiting', { defaultValue: '대기' }),
    active: t('stats.bActive', { defaultValue: '진행 중' }),
    review: t('stats.bReview', { defaultValue: '확인 중' }),
    done: t('stats.bDone', { defaultValue: '완료' }),
    canceled: t('stats.bCanceled', { defaultValue: '취소' }),
    other: t('stats.bOther', { defaultValue: '기타' }),
  }[b]) as string;
  const weekMax = stats ? Math.max(1, ...stats.weekly.map((w) => w.count)) : 1;
  // 히스토리 — 주요 이슈 + 업무 완료(마일스톤은 ◆) 를 최근 순으로 한 줄에. 둘 다 이미 받은 응답에서 만든다.
  const timeline = useMemo<TimelineItem[]>(() => {
    const out: TimelineItem[] = [];
    for (const it of issues || []) out.push({ key: `i${it.id}`, at: it.occurred_at, kind: 'issue', title: it.title, body: it.body });
    for (const k of tasks || []) {
      if (k.status === 'completed' && k.completed_at) out.push({ key: `t${k.id}`, at: k.completed_at, kind: k.is_milestone ? 'milestone' : 'done', title: k.title });
    }
    return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }, [issues, tasks]);

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
        <Tab type="button" role="tab" aria-selected={tab === 'history'} $on={tab === 'history'}
          data-testid="guest-tab-history" onClick={() => setTab('history')}>
          {t('tabs.history', { defaultValue: '히스토리' })}
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
          {/* 기본 정보 — **항상** 그린다. 비어 있으면 숨기지 않고 «—» (빈 줄이 왜 없는지 아무도 모르게 되지 않게, §I-1). */}
          <OvSection data-testid="guest-ov-info">
            <OvLabel>{t('ov.info', { defaultValue: '기본 정보' })}</OvLabel>
            <InfoGrid>
              <InfoRow label={t('ov.infoStatus', { defaultValue: '상태' }) as string} value={projectStatusLabel(project.status)} testId="status" />
              <InfoRow label={t('ov.infoPeriod', { defaultValue: '기간' }) as string}
                value={project.start_date || project.end_date ? period(project.start_date, project.end_date) : ''} testId="period" />
              <InfoRow label={t('ov.infoTasks', { defaultValue: '업무' }) as string}
                value={t('ov.infoTaskVal', { defaultValue: '{{total}}건 (완료 {{done}})', total, done }) as string} testId="tasks" />
              <InfoRow label={t('ov.infoDocs', { defaultValue: '문서' }) as string}
                value={docs === null ? '' : t('ov.infoCount', { defaultValue: '{{count}}건', count: docs.length }) as string} testId="docs" />
              <InfoRow label={t('ov.infoFiles', { defaultValue: '파일' }) as string}
                value={fileCount === null ? '' : t('ov.infoCount', { defaultValue: '{{count}}건', count: fileCount }) as string} testId="files" />
              <InfoRow label={t('ov.infoDesc', { defaultValue: '설명' }) as string} value={project.description || ''} testId="desc" pre />
            </InfoGrid>
          </OvSection>
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
          {stats && stats.total > 0 && (
            <OvSection data-testid="guest-ov-stats">
              <OvLabel>
                {t('ov.stats', { defaultValue: '업무 통계' })}
                {stats.capped && <CapNote> · {t('ov.statsCapped', { defaultValue: '최근 200건 기준' })}</CapNote>}
              </OvLabel>
              <StatGrid>
                {STATUS_BUCKETS.filter((b) => b !== 'other' || stats.buckets.other > 0).map((b) => (
                  <StatCell key={b} data-testid={`guest-ov-bucket-${b}`}>
                    <StatNum>{stats.buckets[b]}</StatNum>
                    <StatName>{bucketLabel(b)}</StatName>
                  </StatCell>
                ))}
                <StatCell $warn={stats.overdueCount > 0} data-testid="guest-ov-overdue-count">
                  <StatNum>{stats.overdueCount}</StatNum>
                  <StatName>{t('stats.overdue', { defaultValue: '지연' })}</StatName>
                </StatCell>
                <StatCell data-testid="guest-ov-week-count">
                  <StatNum>{stats.dueThisWeekCount}</StatNum>
                  <StatName>{t('stats.thisWeek', { defaultValue: '이번 주 마감' })}</StatName>
                </StatCell>
              </StatGrid>
            </OvSection>
          )}
          {stats && stats.overdue.length > 0 && (
            <OvSection data-testid="guest-ov-overdue">
              <OvLabel>{t('stats.overdueList', { defaultValue: '마감이 지난 업무' })}</OvLabel>
              <TaskList>{stats.overdue.map((k) => <MiniTask key={k.id} title={k.title} status={taskStatusLabel(k.status)} date={formatPublicDate(k.due_date)} who={k.assignee_name} warn />)}</TaskList>
            </OvSection>
          )}
          {stats && stats.dueThisWeek.length > 0 && (
            <OvSection data-testid="guest-ov-week">
              <OvLabel>{t('stats.thisWeekList', { defaultValue: '이번 주 마감' })}</OvLabel>
              <TaskList>{stats.dueThisWeek.map((k) => <MiniTask key={k.id} title={k.title} status={taskStatusLabel(k.status)} date={formatPublicDate(k.due_date)} who={k.assignee_name} />)}</TaskList>
            </OvSection>
          )}
          {stats && stats.recentDone.length > 0 && (
            <OvSection data-testid="guest-ov-recent-done">
              <OvLabel>{t('stats.recentDone', { defaultValue: '최근 완료' })}</OvLabel>
              <TaskList>{stats.recentDone.map((k) => <MiniTask key={k.id} title={k.title} status={taskStatusLabel(k.status)} date={dayOf(k.completed_at)} who={k.assignee_name} done />)}</TaskList>
            </OvSection>
          )}
          {stats && stats.doneWithDate > 0 && (
            <OvSection data-testid="guest-ov-weekly">
              <OvLabel>{t('stats.weekly', { defaultValue: '주별 완료 (최근 8주)' })}</OvLabel>
              <WeekBars role="img" aria-label={stats.weekly.map((w) => `${formatPublicDate(w.weekStart)} ${w.count}`).join(', ')}>
                {stats.weekly.map((w) => (
                  <WeekCol key={w.weekStart} data-testid="guest-ov-week-bar" data-count={w.count}>
                    <WeekNum>{w.count || ''}</WeekNum>
                    <WeekTrack><WeekFill style={{ height: `${Math.round((w.count / weekMax) * 100)}%` }} /></WeekTrack>
                    <WeekLabel>{w.weekStart.slice(5).replace('-', '/')}</WeekLabel>
                  </WeekCol>
                ))}
              </WeekBars>
            </OvSection>
          )}
          {/* 주요 이슈 — 사람이 «고객에게 보이기» 를 켠 것만(§I-2). 없으면 숨기지 않고 말한다. */}
          <OvSection data-testid="guest-ov-issues">
            <OvHeadRow>
              <OvLabel>{t('ov.issues', { defaultValue: '주요 이슈' })}</OvLabel>
              {(issues?.length || 0) > 0 && (
                <LinkBtn type="button" onClick={() => setTab('history')}>{t('ov.allHistory', { defaultValue: '히스토리 탭 전체 보기' })}</LinkBtn>
              )}
            </OvHeadRow>
            {issuesErr ? (
              <OvEmpty>{t('history.failed', { defaultValue: '히스토리를 불러오지 못했습니다.' })}{' '}
                <RetryInline type="button" onClick={() => void loadIssues()}>{t('retry', { defaultValue: '다시 시도' })}</RetryInline></OvEmpty>
            ) : issues === null ? (
              <OvEmpty>{t('loading', { defaultValue: '불러오는 중…' })}</OvEmpty>
            ) : issues.length === 0 ? (
              <OvEmpty>{t('ov.issuesEmpty', { defaultValue: '공개된 주요 이슈가 없어요.' })}</OvEmpty>
            ) : (
              <IssueList>
                {issues.slice(0, 3).map((it) => (
                  <IssueRow key={it.id} data-testid={`guest-ov-issue-${it.id}`}>
                    <IssueDate>{dayOf(it.occurred_at)}</IssueDate>
                    <IssueTitle>{it.title}</IssueTitle>
                    {it.body && <IssueBody>{it.body}</IssueBody>}
                  </IssueRow>
                ))}
              </IssueList>
            )}
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

      {tab === 'history' && (
        <GuestTabPane data-testid="guest-tab-body-history">
          {issuesErr || tasksErr ? (
            <OvEmpty>
              {t('history.failed', { defaultValue: '히스토리를 불러오지 못했습니다.' })}{' '}
              <RetryInline type="button" onClick={() => { void loadIssues(); void loadTasks(); }}>{t('retry', { defaultValue: '다시 시도' })}</RetryInline>
            </OvEmpty>
          ) : issues === null || tasks === null ? (
            <OvEmpty>{t('loading', { defaultValue: '불러오는 중…' })}</OvEmpty>
          ) : timeline.length === 0 ? (
            <Empty data-testid="guest-history-empty">{t('history.empty', { defaultValue: '아직 기록된 히스토리가 없어요.' })}</Empty>
          ) : (
            <>
              {issues.length === 0 && <OvEmpty>{t('ov.issuesEmpty', { defaultValue: '공개된 주요 이슈가 없어요.' })}</OvEmpty>}
              <Timeline data-testid="guest-history-list">
                {timeline.map((it, i) => {
                  const month = localYmd(new Date(it.at)).slice(0, 7);
                  const prevMonth = i > 0 ? localYmd(new Date(timeline[i - 1].at)).slice(0, 7) : '';
                  return (
                    <li key={it.key}>
                      {month !== prevMonth && <MonthSep>{month.replace('-', '.')}</MonthSep>}
                      <TlRow data-testid={`guest-history-${it.key}`} data-kind={it.kind}>
                        <TlMark $kind={it.kind} aria-hidden>{it.kind === 'issue' ? '★' : it.kind === 'milestone' ? '◆' : '✓'}</TlMark>
                        <TlMain>
                          <TlTitle>{it.title}</TlTitle>
                          <TlMeta>
                            {it.kind === 'issue'
                              ? t('history.kIssue', { defaultValue: '주요 이슈' })
                              : it.kind === 'milestone'
                                ? t('history.kMilestone', { defaultValue: '마일스톤 완료' })
                                : t('history.kDone', { defaultValue: '업무 완료' })}
                            {' · '}{dayOf(it.at)}
                          </TlMeta>
                          {it.body && <IssueBody>{it.body}</IssueBody>}
                        </TlMain>
                      </TlRow>
                    </li>
                  );
                })}
              </Timeline>
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

/** 기본 정보 한 줄 — 값이 비면 «—» 로 그린다(숨기지 않는다, §I-1). */
function InfoRow({ label, value, testId, pre }: { label: string; value: string; testId: string; pre?: boolean }) {
  return (
    <>
      <InfoKey>{label}</InfoKey>
      <InfoVal data-testid={`guest-ov-info-${testId}`} $pre={!!pre} $empty={!value}>{value || '—'}</InfoVal>
    </>
  );
}
/** 개요의 업무 한 줄 — 업무 탭 행과 같은 부품(TaskRow·TaskTitle·TaskMeta)을 쓴다. */
function MiniTask({ title, status, date, who, warn, done }: { title: string; status: string; date: string; who?: string | null; warn?: boolean; done?: boolean }) {
  return (
    <TaskRow>
      <TaskMain>
        <TaskTitle>{title}</TaskTitle>
        <TaskMeta>
          {who && <span>{who}</span>}
          <TaskStatus $done={!!done}>{status}</TaskStatus>
          {date && <DateSpan $warn={!!warn}>{date}</DateSpan>}
        </TaskMeta>
      </TaskMain>
    </TaskRow>
  );
}

const InfoGrid = styled.dl`
  display:grid;grid-template-columns:max-content minmax(0,1fr);gap:6px 14px;margin:0;
  background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:12px 14px;
`;
const InfoKey = styled.dt`font-size:0.75rem;color:#94A3B8;font-weight:600;`;
const InfoVal = styled.dd<{ $pre: boolean; $empty: boolean }>`
  margin:0;font-size:0.8125rem;color:${p => (p.$empty ? '#CBD5E1' : '#334155')};min-width:0;word-break:break-word;
  white-space:${p => (p.$pre ? 'pre-wrap' : 'normal')};line-height:1.5;
`;
const CapNote = styled.span`font-weight:500;color:#94A3B8;`;
const StatGrid = styled.div`display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:8px;`;
const StatCell = styled.div<{ $warn?: boolean }>`
  background:#fff;border:1px solid ${p => (p.$warn ? '#FECDD3' : '#E2E8F0')};border-radius:10px;padding:10px 12px;
  display:flex;flex-direction:column;gap:2px;
`;
const StatNum = styled.div`font-size:1.125rem;font-weight:700;color:#0F172A;font-variant-numeric:tabular-nums;`;
const StatName = styled.div`font-size:0.6875rem;color:#64748B;`;
const DateSpan = styled.span<{ $warn: boolean }>`color:${p => (p.$warn ? '#E11D48' : 'inherit')};`;
const WeekBars = styled.div`display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:6px;align-items:end;
  background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:12px;`;
const WeekCol = styled.div`display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0;`;
const WeekNum = styled.div`font-size:0.6875rem;font-weight:700;color:#475569;min-height:14px;`;
const WeekTrack = styled.div`width:100%;max-width:28px;height:64px;background:#F1F5F9;border-radius:6px;display:flex;align-items:flex-end;overflow:hidden;`;
const WeekFill = styled.div`width:100%;background:#14B8A6;border-radius:6px;`;
const WeekLabel = styled.div`font-size:0.625rem;color:#94A3B8;white-space:nowrap;`;
const IssueList = styled.div`display:flex;flex-direction:column;gap:0;background:#fff;border:1px solid #E2E8F0;border-radius:12px;overflow:hidden;`;
const IssueRow = styled.div`padding:11px 14px;border-bottom:1px solid #F1F5F9;&:last-child{border-bottom:none;}`;
const IssueDate = styled.div`font-size:0.6875rem;color:#94A3B8;`;
const IssueTitle = styled.div`font-size:0.875rem;color:#0F172A;font-weight:600;line-height:1.4;word-break:break-word;`;
const IssueBody = styled.div`margin-top:4px;font-size:0.8125rem;color:#475569;line-height:1.55;white-space:pre-wrap;word-break:break-word;`;
const Timeline = styled.ol`list-style:none;margin-top:0;margin-bottom:0;padding:0;display:flex;flex-direction:column;`;
const MonthSep = styled.div`font-size:0.75rem;font-weight:700;color:#64748B;padding:14px 0 6px;`;
const TlRow = styled.div`display:flex;gap:10px;padding:10px 14px;background:#fff;border:1px solid #E2E8F0;border-radius:10px;margin-bottom:6px;`;
const TlMark = styled.span<{ $kind: string }>`
  flex-shrink:0;width:20px;text-align:center;font-size:0.8125rem;
  color:${p => (p.$kind === 'issue' ? '#F43F5E' : '#14B8A6')};
`;
const TlMain = styled.div`flex:1 1 0;min-width:0;`;
const TlTitle = styled.div`font-size:0.875rem;color:#0F172A;line-height:1.4;word-break:break-word;`;
const TlMeta = styled.div`margin-top:2px;font-size:0.6875rem;color:#94A3B8;`;
// 필터 줄 안의 알약 — 한 줄 안 컨트롤은 **36** 이다(필터줄 계약). 머리줄용 32 를 그대로 쓰면 줄이 들쭉날쭉하다(Fable F4).
const FilterPills = styled(SegmentedToggle)`height:36px;`;
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
