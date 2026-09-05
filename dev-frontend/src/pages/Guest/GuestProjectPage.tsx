// 무로그인 **프로젝트 열람** 화면 (`/g/:token`, scope=project) — 1차: 개요·업무·대화
//
//   Irene: "나는 프로젝트 안 탭들 보는 그대로 프로젝트 링크 물어본건데?"
//   그래서 이 화면의 주인은 **프로젝트**고 대화는 탭 하나다(전에는 반대였다 —
//   채팅 위에 정보 띠를 얹었더니 받는 사람에게는 그냥 채팅방이었다).
//
//   설계: docs/PROJECT_EXTERNAL_VIEW_DESIGN.md §7.1. 문서·파일 탭은 **2차**다 —
//   무인증으로 문서 본문이 나가는 지점이라 게이트를 따로 통과시킨다. 1차에는 탭 자체가 없다
//   (탭이 없다 = 라우트도 없다 = 가장 강한 차단).
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import GuestChatPanel from './GuestChatPanel';
import GuestNotifySection from './GuestNotifySection';

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

type Props = {
  token: string;
  project: GuestProject;
  canWrite: boolean;
  onGone: () => void;
};

type TabKey = 'overview' | 'tasks' | 'chat';
const TABS: TabKey[] = ['overview', 'tasks', 'chat'];

export default function GuestProjectPage({ token, project, canWrite, onGone }: Props) {
  const { t } = useTranslation('guest');
  // 탭은 URL 에 싱크한다 — 뒤로가기·새로고침·공유가 탭을 지킨다(CLAUDE.md 드로어 URL 싱크와 같은 규칙).
  const [sp, setSp] = useSearchParams();
  const raw = sp.get('tab') as TabKey | null;
  const tab: TabKey = raw && TABS.includes(raw) ? raw : 'overview';
  const setTab = (next: TabKey) => {
    const p = new URLSearchParams(sp);
    if (next === 'overview') p.delete('tab'); else p.set('tab', next);
    setSp(p, { replace: true });
  };

  const [tasks, setTasks] = useState<GuestTask[] | null>(null);
  const [tasksErr, setTasksErr] = useState(false);

  // 탭 데이터는 **그 탭이 처음 열릴 때** 1회. 안 보는 탭까지 미리 받지 않는다.
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
  useEffect(() => { if (tab === 'tasks' && tasks === null) void loadTasks(); }, [tab, tasks, loadTasks]);

  const period = (a: string | null, b: string | null) => {
    const f = (d: string | null) => (d ? String(d).slice(0, 10) : '');
    if (!a && !b) return '';
    return `${f(a)} ~ ${f(b)}`.trim();
  };
  const done = project.task_summary?.completed ?? 0;
  const total = project.task_summary?.total ?? 0;

  // ★ 프로젝트 상태를 **내부 값 그대로** 내보내지 않는다 — 고객 화면에 `active` 가 그대로 떴다
  //   (2026-09-05 실측). 앱의 라벨(QProjectDetailPage projStatusLabel)과 같은 뜻으로 맞춘다.
  //   모르는 값은 원문을 그대로 — 새 상태가 생겨도 조용히 뭉개지 않는다.
  const projectStatusLabel = (s: string | null) => {
    if (!s) return '';
    if (s === 'active') return t('proj.active', { defaultValue: '진행 중' }) as string;
    if (s === 'paused') return t('proj.paused', { defaultValue: '일시 중지' }) as string;
    if (s === 'closed') return t('proj.closed', { defaultValue: '완료' }) as string;
    return s;
  };

  // ★ 모르는 상태값을 기본값으로 떨어뜨리지 않는다 (CLAUDE.md 상태값 규약) —
  //   새 상태가 생기면 원문을 그대로 보여준다. "대기" 로 뭉개면 아무도 모른다.
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

  return (
    <Wrap>
      <Head>
        <Title>{project.name}</Title>
        <Sub>{[projectStatusLabel(project.status), period(project.start_date, project.end_date)].filter(Boolean).join(' · ')
          || t('ov.projectSub', { defaultValue: '진행 상황과 문의' })}</Sub>
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
        <Tab type="button" role="tab" aria-selected={tab === 'chat'} $on={tab === 'chat'}
          data-testid="guest-tab-chat" onClick={() => setTab('chat')}>
          {t('tabs.chat', { defaultValue: '대화' })}
        </Tab>
      </TabBar>

      {tab === 'overview' && (
        <Scroll data-testid="guest-project-overview">
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
          <ChatHint>{t('ov.chatHint2', { defaultValue: '대화 탭에서 담당자에게 바로 문의할 수 있어요.' })}</ChatHint>
        </Scroll>
      )}

      {tab === 'tasks' && (
        <Scroll data-testid="guest-tasks">
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
            <TaskList>
              {tasks.map((k) => (
                <TaskRow key={k.id}>
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
        </Scroll>
      )}

      {/* 대화 탭은 **패널을 계속 붙여 둔다** — 탭을 오갈 때마다 다시 만들면 쓰던 글이 사라진다.
          보이지 않을 때는 폴링만 멈춘다(active=false). */}
      <ChatWrap $on={tab === 'chat'}>
        {/* 답글 알림 신청 — 대화 화면과 **같은 부품**. 프로젝트 링크로 들어온 고객만
            알림을 못 받는 일이 없게(설계 §7.1, 2026-09-05 Fable 지적 D3). */}
        <GuestNotifySection token={token} onGone={onGone} />
        <GuestChatPanel token={token} canWrite={canWrite} active={tab === 'chat'} onGone={onGone} />
      </ChatWrap>
    </Wrap>
  );
}

const Wrap = styled.div`display:flex;flex-direction:column;height:100dvh;background:#f8fafc;`;
const Head = styled.div`min-height:60px;padding:14px 20px;background:#fff;border-bottom:1px solid #e2e8f0;flex-shrink:0;`;
const Title = styled.div`font-size:1.125rem;font-weight:700;letter-spacing:-0.2px;color:#0f172a;`;
const Sub = styled.div`font-size:0.8125rem;color:#64748b;margin-top:2px;`;
const TabBar = styled.div`
  display:flex;gap:2px;background:#fff;border-bottom:1px solid #e2e8f0;padding:0 12px;flex-shrink:0;
  overflow-x:auto;-webkit-overflow-scrolling:touch;
`;
const Tab = styled.button<{ $on: boolean }>`
  display:inline-flex;align-items:center;gap:6px;flex-shrink:0;
  height:44px;padding:0 14px;border:none;background:none;cursor:pointer;
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
const Scroll = styled.div`
  flex:1;min-height:0;overflow-y:auto;padding:16px 20px;
  display:flex;flex-direction:column;gap:14px;
`;
const OvDesc = styled.p`margin:0;font-size:0.8125rem;color:#475569;line-height:1.55;white-space:pre-wrap;`;
const OvSection = styled.div`display:flex;flex-direction:column;gap:6px;`;
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
const ChatHint = styled.div`font-size:0.75rem;color:#94a3b8;padding-top:10px;border-top:1px dashed #E2E8F0;`;
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
const RetryInline = styled.button`
  border:none;background:none;padding:0;color:#0D9488;font-size:0.8125rem;font-weight:700;
  cursor:pointer;text-decoration:underline;
`;
// 대화 탭 — 숨길 때도 **언마운트하지 않는다**(쓰던 글 보존). 자리만 접는다.
const ChatWrap = styled.div<{ $on: boolean }>`
  display:${p => (p.$on ? 'flex' : 'none')};
  flex-direction:column;flex:1;min-height:0;
`;
