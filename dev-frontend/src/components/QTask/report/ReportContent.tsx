// ReportContent — 보고서 본문(내용 중심) 공유 렌더러.
//   통계 카드 X. 실제 업무 내용: 전략·추진과제·완료·진행·지연·블로커·이슈·산출물·다음·팀·이해관계자.
//   나의 보고서 · 프로젝트 보고서 · 통합 보고서(펼침) 모두 재사용.
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { STATUS_COLOR, type StatusCode } from '../../../utils/taskLabel';
import type { ReportSnapshot, TaskBrief } from '../../../services/reportUnit';

interface Props { snap: ReportSnapshot; compact?: boolean; }

const ReportContent: React.FC<Props> = ({ snap, compact }) => {
  const { t } = useTranslation('qtask');
  const navigate = useNavigate();
  const isProject = snap.scope === 'project';
  const projId = isProject ? snap.subject?.id : undefined;
  const openTask = (id: number) => { if (projId) navigate(`/projects/p/${projId}?tab=tasks&task=${id}`); };

  const TaskList = ({ tasks, tone }: { tasks: TaskBrief[]; tone: 'good' | 'bad' | 'wait' | 'plan' }) => (
    <List>
      {tasks.map((tk) => (
        <Item key={tk.id} type="button" $tone={tone} onClick={() => openTask(tk.id)}>
          <Dot style={{ background: (STATUS_COLOR[tk.status as StatusCode] || STATUS_COLOR.not_started).fg }} />
          <ITitle>{tk.title}</ITitle>
          {tk.assignee_name && <Meta>{tk.assignee_name}</Meta>}
          {tone === 'wait' && tk.progress_percent > 0 && <Meta>{tk.progress_percent}%</Meta>}
          {tone === 'bad' && tk.due_date && <Meta>{String(tk.due_date).slice(5, 10)}</Meta>}
          {!isProject && tk.project_name && <Tag>{tk.project_name}</Tag>}
        </Item>
      ))}
    </List>
  );

  const Section = ({ icon, title, n, children }: { icon: string; title: string; n?: number; children: React.ReactNode }) => (
    <Sec>
      <SecHead><SecIcon>{icon}</SecIcon>{title}{n != null && <Cnt>{n}</Cnt>}</SecHead>
      {children}
    </Sec>
  );

  return (
    <Wrap>
      {/* 프로젝트: 전략 핵심메시지 + 추진과제(워크스트림) */}
      {isProject && snap.strategy?.governing_thought && (
        <Governing>“{snap.strategy.governing_thought}”{snap.strategy.goal && <GoalLine>{snap.strategy.goal}</GoalLine>}</Governing>
      )}
      {isProject && (snap.workstreams?.length || 0) > 0 && (
        <Streams>
          {(snap.workstreams || []).map((w) => (
            <Stream key={w.id}><SLabel>{w.title}</SLabel><SBar><SFill style={{ width: `${w.progress_percent}%`, background: w.color || '#14B8A6' }} /></SBar><SPct>{w.progress_percent}%</SPct></Stream>
          ))}
        </Streams>
      )}

      <Grid $compact={compact}>
        {(snap.highlights?.length || 0) > 0 && (
          <Section icon="✓" title={t('weeklyReview.content.done', { defaultValue: '완료한 업무' })} n={snap.highlights!.length}>
            <TaskList tasks={snap.highlights!} tone="good" />
          </Section>
        )}
        {(snap.in_progress?.length || 0) > 0 && (
          <Section icon="▷" title={t('weeklyReview.content.inProgress', { defaultValue: '진행 중' })} n={snap.in_progress!.length}>
            <TaskList tasks={snap.in_progress!} tone="wait" />
          </Section>
        )}
        {((snap.risks?.length || 0) > 0 || (snap.issues?.length || 0) > 0) && (
          <Section icon="⚠" title={t('weeklyReview.content.issues', { defaultValue: '이슈 · 리스크' })} n={(snap.issues?.length || 0) + (snap.risks?.length || 0)}>
            {(snap.issues || []).map((i) => <IssueRow key={`i-${i.id}`}>{i.body}</IssueRow>)}
            {(snap.risks?.length || 0) > 0 && <TaskList tasks={snap.risks!} tone="bad" />}
          </Section>
        )}
        {(snap.blockers?.length || 0) > 0 && (
          <Section icon="🚧" title={t('weeklyReview.content.blockers', { defaultValue: '블로커' })} n={snap.blockers!.length}>
            <TaskList tasks={snap.blockers!} tone="bad" />
          </Section>
        )}
        {(snap.deliverables?.length || 0) > 0 && (
          <Section icon="📄" title={t('weeklyReview.content.deliverables', { defaultValue: '산출물' })} n={snap.deliverables!.length}>
            <List>{(snap.deliverables || []).map((d) => <DelivItem key={`${d.kind}-${d.id}`} type="button" onClick={() => navigate(d.link)}>{d.title}</DelivItem>)}</List>
          </Section>
        )}
        {(snap.next?.length || 0) > 0 && (
          <Section icon="→" title={t('weeklyReview.content.next', { defaultValue: '다음 계획' })} n={snap.next!.length}>
            <TaskList tasks={snap.next!} tone="plan" />
          </Section>
        )}
        {isProject && ((snap.team?.length || 0) > 0 || (snap.stakeholders?.length || 0) > 0) && (
          <Section icon="👥" title={t('weeklyReview.content.people', { defaultValue: '팀 · 이해관계자' })}>
            <People>
              {(snap.team || []).map((m) => <Person key={`t-${m.user_id}`}><PName>{m.name}</PName><Meta>완료 {m.completed}·진행 {m.active}</Meta></Person>)}
              {(snap.stakeholders || []).map((c) => <Person key={`c-${c.id}`} $client><PName>{c.name}</PName></Person>)}
            </People>
          </Section>
        )}
      </Grid>
    </Wrap>
  );
};

export default ReportContent;

const Wrap = styled.div`display:flex;flex-direction:column;gap:12px;`;
const Governing = styled.div`font-size:15px;font-weight:700;color:#0F766E;background:linear-gradient(135deg,#F0FDFA,#fff);border:1px solid #99F6E4;border-radius:10px;padding:12px 14px;line-height:1.5;`;
const GoalLine = styled.div`font-size:12px;font-weight:500;color:#64748B;margin-top:4px;`;
const Streams = styled.div`display:flex;flex-direction:column;gap:6px;`;
const Stream = styled.div`display:flex;align-items:center;gap:10px;`;
const SLabel = styled.span`flex:0 0 100px;font-size:12px;font-weight:600;color:#334155;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
const SBar = styled.div`flex:1;height:6px;background:#F1F5F9;border-radius:999px;overflow:hidden;`;
const SFill = styled.div`height:100%;border-radius:999px;`;
const SPct = styled.span`flex:0 0 34px;text-align:right;font-size:11px;font-weight:700;color:#64748B;`;
const Grid = styled.div<{ $compact?: boolean }>`display:grid;grid-template-columns:${(p) => (p.$compact ? '1fr' : '1fr 1fr')};gap:14px;@media (max-width:768px){grid-template-columns:1fr;}`;
const Sec = styled.div``;
const SecHead = styled.div`display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:#0F172A;margin-bottom:8px;`;
const SecIcon = styled.span`font-size:13px;`;
const Cnt = styled.span`display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:17px;padding:0 5px;background:#F1F5F9;color:#64748B;border-radius:999px;font-size:10px;font-weight:700;`;
const List = styled.div`display:flex;flex-direction:column;gap:5px;`;
const Item = styled.button<{ $tone: 'good' | 'bad' | 'wait' | 'plan' }>`display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:7px 9px;background:#F8FAFC;border:1px solid #E2E8F0;border-left:3px solid ${(p) => (p.$tone === 'bad' ? '#EF4444' : p.$tone === 'good' ? '#22C55E' : p.$tone === 'wait' ? '#14B8A6' : '#94A3B8')};border-radius:7px;cursor:pointer;font-family:inherit;&:hover{background:#F0FDFA;}&:focus-visible{outline:2px solid #14B8A6;outline-offset:1px;}`;
const Dot = styled.span`width:6px;height:6px;border-radius:50%;flex-shrink:0;`;
const ITitle = styled.span`flex:1;font-size:13px;color:#0F172A;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
const Meta = styled.span`font-size:11px;color:#94A3B8;flex-shrink:0;`;
const Tag = styled.span`font-size:10px;font-weight:600;color:#0F766E;background:#F0FDFA;border-radius:999px;padding:1px 7px;flex-shrink:0;`;
const IssueRow = styled.div`font-size:13px;color:#92400E;background:#FFFBEB;border:1px solid #FDE68A;border-radius:7px;padding:7px 9px;line-height:1.5;`;
const DelivItem = styled.button`display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:7px 9px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:7px;cursor:pointer;font-size:13px;color:#0F172A;font-family:inherit;&:hover{background:#F0FDFA;color:#0F766E;}&:focus-visible{outline:2px solid #14B8A6;}&::before{content:'📄';}`;
const People = styled.div`display:flex;flex-wrap:wrap;gap:8px;`;
const Person = styled.div<{ $client?: boolean }>`display:flex;flex-direction:column;gap:1px;padding:6px 10px;background:${(p) => (p.$client ? '#FFF1F2' : '#F8FAFC')};border:1px solid ${(p) => (p.$client ? '#FECDD3' : '#E2E8F0')};border-radius:8px;`;
const PName = styled.span`font-size:12px;font-weight:700;color:#0F172A;`;
