// 프로젝트 보고서뷰 (#64) — Live 파생 상태 보고서 (읽기전용, 보고 포맷).
import { useEffect, useState, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getProjectReport, HEALTH_META, type ProjectReport } from '../../services/projectReport';
import { WORKSTREAM_PALETTE } from '../../services/projectCanvas';
import { STATUS_COLOR, type StatusCode } from '../../utils/taskLabel';
import { AlertTriangleIcon, FileTextIcon } from '../Common/Icons';

export default function ProjectReportView({ projectId }: { projectId: number }) {
  const { t } = useTranslation('qtask');
  const navigate = useNavigate();
  const [data, setData] = useState<ProjectReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await getProjectReport(projectId)); setError(false); }
    catch { setError(true); }
    finally { setLoading(false); }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <Skel><SkelBar style={{ width: '50%' }} /><SkelBlock /><SkelBlock /></Skel>;
  if (error || !data) return <ErrBox><AlertTriangleIcon size={20} /><div>{t('weeklyReview.project.loadError', { defaultValue: '보고서를 불러오지 못했습니다' })}</div><Retry type="button" onClick={load}>{t('weeklyReview.project.retry', { defaultValue: '다시 시도' })}</Retry></ErrBox>;

  const { kpi, strategy } = data;
  const hm = HEALTH_META[kpi.health] || HEALTH_META.yellow;
  const deltaStr = (kpi.progress_delta > 0 ? '+' : '') + kpi.progress_delta;
  const wsColor = (ws: { color: string | null; order_index: number }, i: number) => ws.color || WORKSTREAM_PALETTE[(ws.order_index ?? i) % WORKSTREAM_PALETTE.length];
  const taskRow = (tk: { id: number; title: string; status: string; assignee_name: string | null; due_date: string | null }) => {
    const sc = STATUS_COLOR[tk.status as StatusCode] || { bg: '#F1F5F9', fg: '#64748B' };
    return (
      <TaskItem key={tk.id} onClick={() => navigate(`/projects/p/${projectId}?tab=tasks&task=${tk.id}`)}>
        <Dot style={{ background: sc.fg }} /><TName>{tk.title}</TName>
        {tk.assignee_name && <TMeta>{tk.assignee_name}</TMeta>}
        {tk.due_date && <TMeta>{String(tk.due_date).slice(5, 10)}</TMeta>}
      </TaskItem>
    );
  };

  return (
    <Wrap>
      {/* 헤더 — 프로젝트명 + 기간 + health */}
      <RepHead>
        <div>
          <RepTitle>{data.project.name}</RepTitle>
          <RepPeriod>{data.period.week_start} ~ {data.period.week_end}</RepPeriod>
        </div>
        <HealthBadge style={{ background: hm.bg, color: hm.fg }}>{t(`weeklyReview.project.health.${kpi.health}`, { defaultValue: kpi.health })}</HealthBadge>
      </RepHead>

      {/* KPI */}
      <KpiGrid>
        <Kpi><KNum>{kpi.progress_percent}%<KDelta $up={kpi.progress_delta >= 0}>{deltaStr}</KDelta></KNum><KLbl>{t('weeklyReview.project.kpi.progress', { defaultValue: '진행률' })}</KLbl></Kpi>
        <Kpi><KNum>{kpi.completed_tasks}/{kpi.total_tasks}</KNum><KLbl>{t('weeklyReview.project.kpi.tasks', { defaultValue: '완료/전체' })}</KLbl></Kpi>
        <Kpi><KNum $danger={kpi.overdue_count > 0}>{kpi.overdue_count}</KNum><KLbl>{t('weeklyReview.project.kpi.overdue', { defaultValue: '지연' })}</KLbl></Kpi>
        <Kpi><KNum $danger={kpi.open_issues > 0}>{kpi.open_issues}</KNum><KLbl>{t('weeklyReview.project.kpi.issues', { defaultValue: '이슈' })}</KLbl></Kpi>
        <Kpi><KNum>{kpi.this_week_completed}</KNum><KLbl>{t('weeklyReview.project.kpi.thisWeek', { defaultValue: '금주 완료' })}</KLbl></Kpi>
        {kpi.d_day != null && kpi.d_day >= 0 && <Kpi><KNum>D-{kpi.d_day}</KNum><KLbl>{t('weeklyReview.project.kpi.dday', { defaultValue: '마감까지' })}</KLbl></Kpi>}
      </KpiGrid>

      {/* 전략 요약 */}
      {(strategy.governing_thought || strategy.goal) && (
        <StratBox>
          {strategy.governing_thought && <Govern>{strategy.governing_thought}</Govern>}
          {strategy.goal && <Goal><GLabel>{t('weeklyReview.project.goal', { defaultValue: '목표' })}</GLabel>{strategy.goal}</Goal>}
        </StratBox>
      )}

      {/* 성공 지표 */}
      {data.success_metrics.length > 0 && (
        <Section>
          <SecTitle>{t('weeklyReview.project.metrics', { defaultValue: '성공 지표' })}</SecTitle>
          <Metrics>
            {data.success_metrics.map((m, i) => (
              <Metric key={m.id || i}><MLabel>{m.label}</MLabel><MVal>{m.current || '—'}<MArrow>→</MArrow>{m.target || '—'}{m.unit && <MUnit>{m.unit}</MUnit>}</MVal></Metric>
            ))}
          </Metrics>
        </Section>
      )}

      {/* 워크스트림 진행 */}
      {data.workstreams.length > 0 && (
        <Section>
          <SecTitle>{t('weeklyReview.project.workstreams', { defaultValue: '추진과제 진행' })}</SecTitle>
          {data.workstreams.map((ws, i) => (
            <WsRow key={ws.id}>
              <WsName><WsDot style={{ background: wsColor(ws, i) }} />{ws.title}</WsName>
              <WsTrack><WsFill style={{ width: `${ws.rollup.progress_pct}%`, background: wsColor(ws, i) }} /></WsTrack>
              <WsPct>{ws.rollup.progress_pct}%</WsPct>
              <WsMeta>{ws.rollup.completed}/{ws.rollup.total}{ws.rollup.overdue > 0 && <Over> · {ws.rollup.overdue}{t('weeklyReview.project.overdueShort', { defaultValue: ' 지연' })}</Over>}</WsMeta>
            </WsRow>
          ))}
        </Section>
      )}

      {/* 금주 하이라이트 / 리스크 */}
      <TwoCol>
        <Section>
          <SecTitle>{t('weeklyReview.project.highlights', { defaultValue: '금주 완료' })} ({data.highlights.length})</SecTitle>
          {data.highlights.length === 0 ? <Empty>{t('weeklyReview.project.noHighlights', { defaultValue: '금주 완료한 업무가 없습니다' })}</Empty> : <List>{data.highlights.map(taskRow)}</List>}
        </Section>
        <Section>
          <SecTitle $danger>{t('weeklyReview.project.risks', { defaultValue: '지연 업무' })} ({data.risks.length})</SecTitle>
          {data.risks.length === 0 ? <Empty>{t('weeklyReview.project.noRisks', { defaultValue: '지연된 업무가 없습니다' })}</Empty> : <List>{data.risks.map(taskRow)}</List>}
        </Section>
      </TwoCol>

      {/* 차주 계획 */}
      <Section>
        <SecTitle>{t('weeklyReview.project.nextWeek', { defaultValue: '차주 계획' })} ({data.next_week.length})</SecTitle>
        {data.next_week.length === 0 ? <Empty>{t('weeklyReview.project.noNextWeek', { defaultValue: '차주 계획 업무가 없습니다' })}</Empty> : <List>{data.next_week.map(taskRow)}</List>}
      </Section>

      {/* 산출물 / 팀 */}
      <TwoCol>
        <Section>
          <SecTitle>{t('weeklyReview.project.deliverables', { defaultValue: '산출물' })}</SecTitle>
          {data.deliverables.length === 0 ? <Empty>{t('weeklyReview.project.noDeliverables', { defaultValue: '산출물이 없습니다' })}</Empty> : (
            <List>{data.deliverables.map((d) => <DelivItem key={`${d.kind}-${d.id}`} onClick={() => navigate(d.link)}><FileTextIcon size={14} /><TName>{d.title}</TName></DelivItem>)}</List>
          )}
        </Section>
        <Section>
          <SecTitle>{t('weeklyReview.project.team', { defaultValue: '팀' })}</SecTitle>
          {data.team.length === 0 ? <Empty>{t('weeklyReview.project.noTeam', { defaultValue: '참여자가 없습니다' })}</Empty> : (
            <List>{data.team.map((m) => (
              <TeamRow key={m.user_id}><TName>{m.name}</TName>{m.dept && <DeptB>{m.dept}</DeptB>}<TeamMeta>{m.completed}/{m.active + m.completed}</TeamMeta></TeamRow>
            ))}</List>
          )}
        </Section>
      </TwoCol>
    </Wrap>
  );
}

const Wrap = styled.div`display:flex;flex-direction:column;gap:16px;max-width:1000px;`;
const RepHead = styled.div`display:flex;align-items:flex-start;justify-content:space-between;gap:12px;`;
const RepTitle = styled.div`font-size:18px;font-weight:700;color:#0F172A;`;
const RepPeriod = styled.div`font-size:12px;color:#64748B;margin-top:2px;`;
const HealthBadge = styled.span`font-size:12px;font-weight:700;border-radius:999px;padding:4px 12px;flex-shrink:0;`;
const KpiGrid = styled.div`display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;`;
const Kpi = styled.div`background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:14px 16px;`;
const KNum = styled.div<{ $danger?: boolean }>`font-size:22px;font-weight:700;color:${(p) => (p.$danger ? '#EF4444' : '#0F172A')};display:flex;align-items:baseline;gap:6px;`;
const KDelta = styled.span<{ $up: boolean }>`font-size:12px;font-weight:600;color:${(p) => (p.$up ? '#22C55E' : '#EF4444')};`;
const KLbl = styled.div`font-size:11px;color:#64748B;margin-top:4px;`;
const StratBox = styled.div`background:linear-gradient(135deg,#F0FDFA,#fff);border:1px solid #99F6E4;border-radius:12px;padding:16px 18px;`;
const Govern = styled.div`font-size:16px;font-weight:700;color:#0F172A;line-height:1.5;`;
const Goal = styled.div`font-size:13px;color:#334155;margin-top:8px;line-height:1.5;`;
const GLabel = styled.span`font-size:11px;font-weight:700;color:#0F766E;margin-right:8px;`;
const Section = styled.div`background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:14px 16px;`;
const SecTitle = styled.div<{ $danger?: boolean }>`font-size:13px;font-weight:700;color:${(p) => (p.$danger ? '#B91C1C' : '#0F172A')};margin-bottom:10px;`;
const TwoCol = styled.div`display:grid;grid-template-columns:1fr 1fr;gap:14px;@media (max-width:768px){grid-template-columns:1fr;}`;
const Metrics = styled.div`display:flex;flex-wrap:wrap;gap:10px;`;
const Metric = styled.div`background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:8px 12px;`;
const MLabel = styled.div`font-size:11px;color:#64748B;`;
const MVal = styled.div`font-size:15px;font-weight:700;color:#0F172A;display:flex;align-items:center;gap:4px;`;
const MArrow = styled.span`color:#CBD5E1;`;
const MUnit = styled.span`font-size:12px;color:#94A3B8;margin-left:2px;`;
const WsRow = styled.div`display:flex;align-items:center;gap:10px;padding:6px 0;`;
const WsName = styled.div`flex:0 0 200px;display:flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:#0F172A;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
const WsDot = styled.span`width:9px;height:9px;border-radius:50%;flex-shrink:0;`;
const WsTrack = styled.div`flex:1;height:8px;background:#F1F5F9;border-radius:999px;overflow:hidden;`;
const WsFill = styled.div`height:100%;border-radius:999px;`;
const WsPct = styled.div`flex:0 0 40px;text-align:right;font-size:12px;font-weight:700;color:#334155;`;
const WsMeta = styled.div`flex:0 0 90px;text-align:right;font-size:11px;color:#64748B;`;
const Over = styled.span`color:#EF4444;font-weight:600;`;
const List = styled.div`display:flex;flex-direction:column;gap:5px;`;
const TaskItem = styled.div`display:flex;align-items:center;gap:8px;padding:7px 9px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;cursor:pointer;&:hover{background:#F0FDFA;border-color:#99F6E4;}`;
const DelivItem = styled.div`display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:8px;cursor:pointer;color:#475569;&:hover{background:#F8FAFC;}`;
const TeamRow = styled.div`display:flex;align-items:center;gap:8px;padding:7px 9px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;`;
const Dot = styled.span`width:7px;height:7px;border-radius:50%;flex-shrink:0;`;
const TName = styled.span`flex:1;font-size:13px;color:#0F172A;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
const TMeta = styled.span`font-size:11px;color:#94A3B8;flex-shrink:0;`;
const TeamMeta = styled.span`font-size:11px;color:#64748B;font-weight:600;flex-shrink:0;`;
const DeptB = styled.span`font-size:10px;font-weight:700;color:#475569;background:#E2E8F0;border-radius:999px;padding:1px 7px;flex-shrink:0;`;
const Empty = styled.div`font-size:12px;color:#94A3B8;padding:8px 0;`;
const Skel = styled.div`display:flex;flex-direction:column;gap:14px;`;
const SkelBar = styled.div`height:22px;background:#F1F5F9;border-radius:8px;`;
const SkelBlock = styled.div`height:80px;background:#F1F5F9;border-radius:12px;`;
const ErrBox = styled.div`display:flex;flex-direction:column;align-items:center;gap:10px;padding:40px;color:#92400E;`;
const Retry = styled.button`height:34px;padding:0 16px;border:1px solid #E2E8F0;background:#fff;border-radius:8px;font-size:13px;font-weight:600;color:#0F766E;cursor:pointer;&:hover{background:#F0FDFA;}`;
