// ReportUnitView — 책임 기반 단위 보고서 (R2-C2, 마스터설계 §7.3)
//   자동초안(KPI·타임라인·하이라이트·리스크) + 책임자 수정(서술 AutoSave) + [확정]/[되돌리기].
//   확정 시 박제(snapshot). project 는 ScheduleTimeline readonly 재사용. §16 report:updated 실시간.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import ActionButton from '../Common/ActionButton';
import AutoSaveField from '../Common/AutoSaveField';
import ScheduleTimeline from '../Common/ScheduleTimeline';
import { STATUS_COLOR, type StatusCode } from '../../utils/taskLabel';
import { getTimeline, type TimelineData } from '../../services/projectTimeline';
import {
  getReportUnit, patchReportUnit, confirmReportUnit, reopenReportUnit,
  periodStartOf, shiftPeriod,
  type ReportScope, type ReportPeriodType, type ReportUnitData, type TaskBrief,
} from '../../services/reportUnit';

interface Props { businessId: number; scope: ReportScope; refId: number; }

const HEALTH: Record<string, { bg: string; fg: string; key: string }> = {
  green: { bg: '#DCFCE7', fg: '#15803D', key: 'green' },
  yellow: { bg: '#FEF9C3', fg: '#A16207', key: 'yellow' },
  red: { bg: '#FEE2E2', fg: '#B91C1C', key: 'red' },
};

const ReportUnitView: React.FC<Props> = ({ businessId, scope, refId }) => {
  const { t } = useTranslation('qtask');
  const navigate = useNavigate();
  const [periodType, setPeriodType] = useState<ReportPeriodType>('weekly');
  const [periodStart, setPeriodStart] = useState<string>(() => periodStartOf('weekly'));
  const [data, setData] = useState<ReportUnitData | null>(null);
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const narrativeRef = useRef('');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const d = await getReportUnit(businessId, { scope, ref_id: refId, period_type: periodType, period_start: periodStart });
      setData(d); narrativeRef.current = d.narrative || ''; setError(false);
      if (scope === 'project') getTimeline(refId).then(setTimeline).catch(() => setTimeline(null));
    } catch { setError(true); }
    finally { setLoading(false); }
  }, [businessId, scope, refId, periodType, periodStart]);

  useEffect(() => { load(); }, [load]);

  // §16 실시간 — 다른 책임자가 같은 단위 보고서 확정/수정 시 즉시 반영
  const loadRef = useRef(load); loadRef.current = load;
  useEffect(() => {
    let socket: { disconnect: () => void } | null = null; let pending: ReturnType<typeof setTimeout> | null = null;
    const onEvt = (p: { scope?: string; ref_id?: number; period_type?: string; period_start?: string }) => {
      if (p && (p.scope !== scope || Number(p.ref_id) !== Number(refId))) return;
      if (pending) clearTimeout(pending); pending = setTimeout(() => loadRef.current(true), 250);
    };
    import('socket.io-client').then(({ io }) => import('../../contexts/AuthContext').then(({ getAccessToken }) => {
      if (!getAccessToken()) return;
      const s = io({ auth: (cb: (d: { token: string | null }) => void) => cb({ token: getAccessToken() }), transports: ['websocket', 'polling'], reconnection: true });
      socket = s;
      s.on('connect', () => s.emit('join:business', Number(businessId)));
      s.on('report:updated', onEvt);
    }));
    return () => { if (pending) clearTimeout(pending); if (socket) socket.disconnect(); };
  }, [businessId, scope, refId]);

  const saveNarrative = useCallback(async () => {
    if (!data) return;
    const updated = await patchReportUnit(businessId, data.id, { narrative: narrativeRef.current });
    setData(updated);
  }, [businessId, data]);

  const doConfirm = async () => {
    if (!data || busy) return; setBusy(true);
    try { setData(await confirmReportUnit(businessId, data.id)); } catch { /* ignore */ } finally { setBusy(false); }
  };
  const doReopen = async () => {
    if (!data || busy) return; setBusy(true);
    try { setData(await reopenReportUnit(businessId, data.id)); } catch { /* ignore */ } finally { setBusy(false); }
  };

  const periodLabel = useMemo(() => {
    const p = data?.snapshot?.period;
    if (!p) return periodStart;
    if (periodType === 'monthly') { const [y, m] = String(p.start).split('-'); return t('weeklyReview.unit.monthLabel', { y, m: Number(m), defaultValue: `${y}년 ${Number(m)}월` }); }
    return `${String(p.start).slice(5).replace('-', '/')} ~ ${String(p.end).slice(5).replace('-', '/')}`;
  }, [data, periodType, periodStart, t]);

  if (loading) return <Skel><SkelBar style={{ width: '30%' }} /><SkelBlock /><SkelBlock /></Skel>;
  if (error || !data) return <ErrorBox>{t('weeklyReview.unit.loadError', { defaultValue: '보고서를 불러오지 못했습니다' })}<Retry onClick={() => load()}>{t('weeklyReview.unit.retry', { defaultValue: '다시 시도' })}</Retry></ErrorBox>;

  const snap = data.snapshot || {};
  const kpi = snap.kpi || {};
  const confirmed = data.status === 'confirmed';

  return (
    <Wrap>
      {/* 기간 네비 + 주간/월간 */}
      <TopBar>
        <PeriodToggle role="tablist">
          {(['weekly', 'monthly'] as ReportPeriodType[]).map((pt) => (
            <PToggleBtn key={pt} type="button" role="tab" aria-selected={periodType === pt} $on={periodType === pt}
              onClick={() => { setPeriodType(pt); setPeriodStart(periodStartOf(pt)); }}>
              {pt === 'weekly' ? t('weeklyReview.unit.weekly', { defaultValue: '주간' }) : t('weeklyReview.unit.monthly', { defaultValue: '월간' })}
            </PToggleBtn>
          ))}
        </PeriodToggle>
        <PeriodNav>
          <NavBtn type="button" aria-label={t('weeklyReview.unit.prev', { defaultValue: '이전' }) as string} onClick={() => setPeriodStart((s) => shiftPeriod(periodType, s, -1))}>‹</NavBtn>
          <PeriodLbl>{periodLabel}</PeriodLbl>
          <NavBtn type="button" aria-label={t('weeklyReview.unit.next', { defaultValue: '다음' }) as string} onClick={() => setPeriodStart((s) => shiftPeriod(periodType, s, 1))}>›</NavBtn>
        </PeriodNav>
      </TopBar>

      {/* 상태바 — 초안/확정 + 책임자/시각 + 액션 */}
      <StatusBar $confirmed={confirmed}>
        <StatusChip $confirmed={confirmed}>
          {confirmed ? t('weeklyReview.unit.confirmed', { defaultValue: '확정됨' }) : t('weeklyReview.unit.draft', { defaultValue: '자동 초안' })}
        </StatusChip>
        {confirmed && data.confirmed_at && (
          <StatusMeta>{t('weeklyReview.unit.confirmedAt', { d: String(data.confirmed_at).slice(0, 10), defaultValue: `${String(data.confirmed_at).slice(0, 10)} 확정` })}{data.finalized_by === 'auto' && ` · ${t('weeklyReview.unit.auto', { defaultValue: '자동' })}`}</StatusMeta>
        )}
        {!confirmed && <StatusMeta>{t('weeklyReview.unit.draftHint', { defaultValue: 'live 집계 — 책임자가 검토·확정하면 박제됩니다' })}</StatusMeta>}
        <Spacer />
        {data.can_edit && (confirmed
          ? <ActionButton tone="secondary" size="sm" loading={busy} onClick={doReopen}>{t('weeklyReview.unit.reopen', { defaultValue: '되돌리기' })}</ActionButton>
          : <ActionButton tone="primary" size="sm" loading={busy} onClick={doConfirm}>{t('weeklyReview.unit.confirm', { defaultValue: '확정하기' })}</ActionButton>)}
      </StatusBar>

      {/* KPI */}
      <KpiRow>
        {scope === 'project' ? (<>
          <KpiCard><KpiVal>{kpi.progress_percent ?? 0}<KpiUnit>%</KpiUnit></KpiVal><KpiLbl>{t('weeklyReview.unit.kpi.progress', { defaultValue: '진행률' })}</KpiLbl>{kpi.progress_delta != null && <KpiDelta $up={kpi.progress_delta >= 0}>{kpi.progress_delta >= 0 ? '▲' : '▼'} {Math.abs(kpi.progress_delta)}</KpiDelta>}</KpiCard>
          <KpiCard><KpiVal>{kpi.completed_tasks ?? 0}<KpiUnit>/{kpi.total_tasks ?? 0}</KpiUnit></KpiVal><KpiLbl>{t('weeklyReview.unit.kpi.completed', { defaultValue: '완료/전체' })}</KpiLbl></KpiCard>
          <KpiCard $danger={(kpi.overdue_count ?? 0) > 0}><KpiVal>{kpi.overdue_count ?? 0}</KpiVal><KpiLbl>{t('weeklyReview.unit.kpi.overdue', { defaultValue: '지연' })}</KpiLbl></KpiCard>
          <KpiCard><HealthBadge style={{ background: (HEALTH[String(kpi.health)] || HEALTH.yellow).bg, color: (HEALTH[String(kpi.health)] || HEALTH.yellow).fg }}>{t(`weeklyReview.unit.health.${HEALTH[String(kpi.health)]?.key || 'yellow'}`, { defaultValue: String(kpi.health || 'yellow') })}</HealthBadge><KpiLbl>{t('weeklyReview.unit.kpi.health', { defaultValue: '상태' })}</KpiLbl></KpiCard>
        </>) : (<>
          <KpiCard><KpiVal>{kpi.progress_percent ?? 0}<KpiUnit>%</KpiUnit></KpiVal><KpiLbl>{t('weeklyReview.unit.kpi.progress', { defaultValue: '진행률' })}</KpiLbl></KpiCard>
          <KpiCard><KpiVal>{kpi.completed_tasks ?? 0}<KpiUnit>/{kpi.total_tasks ?? 0}</KpiUnit></KpiVal><KpiLbl>{t('weeklyReview.unit.kpi.completed', { defaultValue: '완료/전체' })}</KpiLbl></KpiCard>
          <KpiCard $danger={(kpi.overdue_count ?? 0) > 0}><KpiVal>{kpi.overdue_count ?? 0}</KpiVal><KpiLbl>{t('weeklyReview.unit.kpi.overdue', { defaultValue: '지연' })}</KpiLbl></KpiCard>
          <KpiCard><KpiVal>{kpi.completed_in_period ?? 0}</KpiVal><KpiLbl>{t('weeklyReview.unit.kpi.completedInPeriod', { defaultValue: '기간 내 완료' })}</KpiLbl></KpiCard>
        </>)}
      </KpiRow>

      {/* 타임라인 (project readonly) */}
      {scope === 'project' && timeline && (
        <Section>
          <SecTitle>{t('weeklyReview.unit.timeline', { defaultValue: '일정 진행' })}</SecTitle>
          <ScheduleTimeline data={timeline} keyOnly={false} />
        </Section>
      )}

      {/* 책임자 서술 */}
      <Section>
        <SecTitle>{t('weeklyReview.unit.narrative', { defaultValue: '책임자 코멘트' })}{confirmed && <Lock>{t('weeklyReview.unit.locked', { defaultValue: '확정됨 — 되돌려야 수정 가능' })}</Lock>}</SecTitle>
        {data.can_edit && !confirmed ? (
          <AutoSaveField onSave={saveNarrative} type="input">
            <NarrativeArea defaultValue={data.narrative} placeholder={t('weeklyReview.unit.narrativePh', { defaultValue: '이번 기간 핵심 성과·이슈·다음 계획을 적어주세요 (자동 저장)' }) as string}
              onChange={(e) => { narrativeRef.current = e.target.value; }} />
          </AutoSaveField>
        ) : (
          data.narrative ? <NarrativeRead>{data.narrative}</NarrativeRead> : <Muted>{t('weeklyReview.unit.noNarrative', { defaultValue: '작성된 코멘트가 없습니다' })}</Muted>
        )}
      </Section>

      {/* 하이라이트 / 리스크 */}
      <Grid2>
        <TaskColumn title={t('weeklyReview.unit.highlights', { defaultValue: '이번 기간 완료' })} tone="good" tasks={snap.highlights || []} empty={t('weeklyReview.unit.noHighlights', { defaultValue: '완료된 업무가 없습니다' })} navigate={navigate} scope={scope} refId={refId} />
        <TaskColumn title={t('weeklyReview.unit.risks', { defaultValue: '지연·리스크' })} tone="bad" tasks={snap.risks || []} empty={t('weeklyReview.unit.noRisks', { defaultValue: '지연된 업무가 없습니다' })} navigate={navigate} scope={scope} refId={refId} />
      </Grid2>

      {/* 차주 (project) / 멤버 (department) */}
      {scope === 'project' && (snap.next?.length || 0) > 0 && (
        <Section>
          <SecTitle>{t('weeklyReview.unit.next', { defaultValue: '다음 기간 계획' })}</SecTitle>
          <TaskChips>{(snap.next || []).map((tk) => <TaskChip key={tk.id} type="button" onClick={() => navigate(`/projects/p/${refId}?tab=tasks&task=${tk.id}`)}><StatusDot style={{ background: (STATUS_COLOR[tk.status as StatusCode] || STATUS_COLOR.not_started).fg }} />{tk.title}{tk.assignee_name && <ChipMeta>{tk.assignee_name}</ChipMeta>}</TaskChip>)}</TaskChips>
        </Section>
      )}
      {scope === 'project' && (snap.team?.length || 0) > 0 && (
        <Section>
          <SecTitle>{t('weeklyReview.unit.team', { defaultValue: '팀 기여' })}</SecTitle>
          <People>{(snap.team || []).map((m) => <Person key={m.user_id}><PName>{m.name}</PName><PMeta>{t('weeklyReview.unit.memberStat', { active: m.active, done: m.completed, defaultValue: `진행 ${m.active} · 완료 ${m.completed}` })}</PMeta></Person>)}</People>
        </Section>
      )}
      {scope === 'department' && (snap.members?.length || 0) > 0 && (
        <Section>
          <SecTitle>{t('weeklyReview.unit.members', { defaultValue: '멤버별 기여' })}</SecTitle>
          <MemberTable>
            <MemberHead><span>{t('weeklyReview.unit.member', { defaultValue: '멤버' })}</span><span>{t('weeklyReview.unit.active', { defaultValue: '진행' })}</span><span>{t('weeklyReview.unit.done', { defaultValue: '완료' })}</span><span>{t('weeklyReview.unit.overdue', { defaultValue: '지연' })}</span></MemberHead>
            {(snap.members || []).map((m) => (
              <MemberRow key={m.user_id}>
                <MName>{m.name}</MName><span>{m.active}</span><span>{m.completed}</span><MOverdue $n={m.overdue}>{m.overdue}</MOverdue>
              </MemberRow>
            ))}
          </MemberTable>
        </Section>
      )}
    </Wrap>
  );
};

// 완료/리스크 공통 컬럼
const TaskColumn: React.FC<{ title: string; tone: 'good' | 'bad'; tasks: TaskBrief[]; empty: string; navigate: ReturnType<typeof useNavigate>; scope: ReportScope; refId: number }> = ({ title, tone, tasks, empty, navigate, scope, refId }) => (
  <Section>
    <SecTitle>{title}<Cnt>{tasks.length}</Cnt></SecTitle>
    {tasks.length === 0 ? <Muted>{empty}</Muted> : (
      <TaskList>
        {tasks.map((tk) => (
          <TaskItem key={tk.id} type="button" $tone={tone}
            onClick={() => { if (scope === 'project') navigate(`/projects/p/${refId}?tab=tasks&task=${tk.id}`); }}>
            <StatusDot style={{ background: (STATUS_COLOR[tk.status as StatusCode] || STATUS_COLOR.not_started).fg }} />
            <TaskTitle>{tk.title}</TaskTitle>
            {tk.assignee_name && <ChipMeta>{tk.assignee_name}</ChipMeta>}
            {tk.due_date && <ChipMeta>{String(tk.due_date).slice(5, 10)}</ChipMeta>}
          </TaskItem>
        ))}
      </TaskList>
    )}
  </Section>
);

export default ReportUnitView;

// ─── styles ───
const Wrap = styled.div`display:flex;flex-direction:column;gap:16px;max-width:1100px;`;
const TopBar = styled.div`display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;`;
const PeriodToggle = styled.div`display:inline-flex;background:#F1F5F9;padding:3px;border-radius:8px;gap:2px;`;
const PToggleBtn = styled.button<{ $on: boolean }>`padding:6px 14px;border:none;background:${p => p.$on ? '#fff' : 'transparent'};color:${p => p.$on ? '#0F766E' : '#64748B'};border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;box-shadow:${p => p.$on ? '0 1px 2px rgba(0,0,0,.06)' : 'none'};`;
const PeriodNav = styled.div`display:inline-flex;align-items:center;gap:8px;`;
const NavBtn = styled.button`width:28px;height:28px;border:1px solid #E2E8F0;background:#fff;border-radius:6px;font-size:16px;color:#475569;cursor:pointer;&:hover{background:#F0FDFA;border-color:#99F6E4;color:#0F766E;}`;
const PeriodLbl = styled.span`font-size:13px;font-weight:700;color:#0F172A;min-width:120px;text-align:center;`;
const StatusBar = styled.div<{ $confirmed: boolean }>`display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 14px;border-radius:10px;border:1px solid ${p => p.$confirmed ? '#99F6E4' : '#E2E8F0'};background:${p => p.$confirmed ? '#F0FDFA' : '#F8FAFC'};`;
const StatusChip = styled.span<{ $confirmed: boolean }>`font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px;background:${p => p.$confirmed ? '#14B8A6' : '#E2E8F0'};color:${p => p.$confirmed ? '#fff' : '#475569'};`;
const StatusMeta = styled.span`font-size:12px;color:#64748B;`;
const Spacer = styled.div`flex:1;`;
const KpiRow = styled.div`display:grid;grid-template-columns:repeat(4,1fr);gap:12px;@media (max-width:768px){grid-template-columns:repeat(2,1fr);}`;
const KpiCard = styled.div<{ $danger?: boolean }>`display:flex;flex-direction:column;gap:4px;background:#fff;border:1px solid ${p => p.$danger ? '#FECACA' : '#E2E8F0'};border-radius:12px;padding:14px 16px;position:relative;`;
const KpiVal = styled.div`font-size:24px;font-weight:700;color:#0F172A;font-variant-numeric:tabular-nums;display:flex;align-items:baseline;gap:3px;`;
const KpiUnit = styled.span`font-size:13px;font-weight:600;color:#94A3B8;`;
const KpiLbl = styled.div`font-size:11px;font-weight:600;color:#94A3B8;`;
const KpiDelta = styled.span<{ $up: boolean }>`position:absolute;top:12px;right:14px;font-size:11px;font-weight:700;color:${p => p.$up ? '#15803D' : '#B91C1C'};`;
const HealthBadge = styled.span`font-size:12px;font-weight:700;border-radius:999px;padding:4px 12px;align-self:flex-start;`;
const Section = styled.div`background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:16px 18px;`;
const SecTitle = styled.div`font-size:14px;font-weight:700;color:#0F172A;margin-bottom:12px;display:flex;align-items:center;gap:8px;`;
const Cnt = styled.span`display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:18px;padding:0 6px;background:#F1F5F9;color:#64748B;border-radius:999px;font-size:11px;font-weight:700;`;
const Lock = styled.span`font-size:11px;font-weight:500;color:#A16207;background:#FEF9C3;border-radius:999px;padding:2px 8px;`;
const NarrativeArea = styled.textarea`width:100%;min-height:90px;resize:vertical;border:1px solid #E2E8F0;border-radius:10px;padding:10px 12px;font-size:13px;line-height:1.6;color:#334155;font-family:inherit;&:focus{outline:none;border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,.15);}&::placeholder{color:#94A3B8;}`;
const NarrativeRead = styled.div`font-size:13px;line-height:1.6;color:#334155;white-space:pre-wrap;`;
const Muted = styled.div`font-size:13px;color:#94A3B8;padding:6px 0;`;
const Grid2 = styled.div`display:grid;grid-template-columns:1fr 1fr;gap:14px;@media (max-width:768px){grid-template-columns:1fr;}`;
const TaskList = styled.div`display:flex;flex-direction:column;gap:6px;`;
const TaskItem = styled.button<{ $tone: 'good' | 'bad' }>`display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:8px 10px;background:#F8FAFC;border:1px solid #E2E8F0;border-left:3px solid ${p => p.$tone === 'bad' ? '#EF4444' : '#22C55E'};border-radius:8px;cursor:pointer;font:inherit;&:hover{background:#F0FDFA;}&:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;}`;
const TaskTitle = styled.span`flex:1;font-size:13px;color:#0F172A;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
const ChipMeta = styled.span`font-size:11px;color:#94A3B8;flex-shrink:0;`;
const StatusDot = styled.span`width:7px;height:7px;border-radius:50%;flex-shrink:0;`;
const TaskChips = styled.div`display:flex;flex-wrap:wrap;gap:8px;`;
const TaskChip = styled.button`display:inline-flex;align-items:center;gap:7px;padding:6px 11px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:999px;cursor:pointer;font-size:12px;color:#0F172A;font-family:inherit;&:hover{background:#F0FDFA;border-color:#99F6E4;}&:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;}`;
const People = styled.div`display:flex;flex-wrap:wrap;gap:10px;`;
const Person = styled.div`display:flex;flex-direction:column;gap:2px;padding:8px 12px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;min-width:120px;`;
const PName = styled.span`font-size:12px;font-weight:700;color:#0F172A;`;
const PMeta = styled.span`font-size:11px;color:#64748B;`;
const MemberTable = styled.div`display:flex;flex-direction:column;overflow-x:auto;`;
const MemberHead = styled.div`display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:8px;padding:6px 8px;min-width:340px;font-size:11px;font-weight:700;color:#94A3B8;border-bottom:1px solid #E2E8F0;& > span:not(:first-child){text-align:center;}`;
const MemberRow = styled.div`display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:8px;padding:8px;min-width:340px;font-size:13px;color:#334155;border-bottom:1px solid #F1F5F9;align-items:center;& > span{text-align:center;}`;
const MName = styled.span`font-weight:600;color:#0F172A;`;
const MOverdue = styled.span<{ $n: number }>`text-align:center;font-weight:700;color:${p => p.$n > 0 ? '#B91C1C' : '#CBD5E1'};`;
const Skel = styled.div`display:flex;flex-direction:column;gap:14px;`;
const SkelBar = styled.div`height:20px;background:#F1F5F9;border-radius:8px;`;
const SkelBlock = styled.div`height:90px;background:#F1F5F9;border-radius:12px;`;
const ErrorBox = styled.div`display:flex;flex-direction:column;align-items:center;gap:10px;padding:40px;color:#92400E;font-size:14px;`;
const Retry = styled.button`height:34px;padding:0 16px;border:1px solid #E2E8F0;background:#fff;border-radius:8px;font-size:13px;font-weight:600;color:#0F766E;cursor:pointer;&:hover{background:#F0FDFA;}`;
