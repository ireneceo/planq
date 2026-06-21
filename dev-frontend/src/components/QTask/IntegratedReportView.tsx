// IntegratedReportView — 통합보고서 (프로젝트뷰/멤버뷰). Insights 디자인 언어 재사용.
//   KpiGrid 전사 집계 + 전사요약 + 단위별 카드(헤더 + ReportContent 펼침). 접기 X. 웹페이지 구성.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import ActionButton from '../Common/ActionButton';
import AutoSaveField from '../Common/AutoSaveField';
import ReportContent from './report/ReportContent';
import {
  KpiGrid, KpiCard, KpiLabel, KpiValueBig, KpiHint,
  SectionLabel, ChartCard,
} from '../../pages/Insights/components';
import {
  getIntegrated, confirmIntegrated, reopenIntegrated, updateReportSettings, patchReportUnit,
  periodStartOf, shiftPeriod,
  type ReportPeriodType, type IntegratedRollup, type IntegratedUnitView,
} from '../../services/reportUnit';

interface Props { businessId: number; canManage: boolean; periodType: ReportPeriodType; }
type ViewDim = 'project' | 'member';

const HEALTH: Record<string, { bg: string; fg: string; label: string }> = {
  green: { bg: '#DCFCE7', fg: '#15803D', label: '순항' }, yellow: { bg: '#FEF9C3', fg: '#A16207', label: '주의' }, red: { bg: '#FEE2E2', fg: '#B91C1C', label: '위험' },
};

const IntegratedReportView: React.FC<Props> = ({ businessId, canManage, periodType }) => {
  const { t } = useTranslation('qtask');
  const navigate = useNavigate();
  const [periodStart, setPeriodStart] = useState(() => periodStartOf(periodType));
  useEffect(() => { setPeriodStart(periodStartOf(periodType)); }, [periodType]);
  const [dim, setDim] = useState<ViewDim>('project');
  const [data, setData] = useState<IntegratedRollup | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const execRef = useRef('');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try { const d = await getIntegrated(businessId, periodType, periodStart); setData(d); execRef.current = d.executive_summary || ''; }
    catch { setData(null); } finally { setLoading(false); }
  }, [businessId, periodType, periodStart]);
  useEffect(() => { load(); }, [load]);

  const loadRef = useRef(load); loadRef.current = load;
  useEffect(() => {
    let socket: { disconnect: () => void } | null = null; let pend: ReturnType<typeof setTimeout> | null = null;
    const onEvt = () => { if (pend) clearTimeout(pend); pend = setTimeout(() => loadRef.current(true), 300); };
    import('socket.io-client').then(({ io }) => import('../../contexts/AuthContext').then(({ getAccessToken }) => {
      if (!getAccessToken()) return;
      const s = io({ auth: (cb: (d: { token: string | null }) => void) => cb({ token: getAccessToken() }), transports: ['websocket', 'polling'], reconnection: true });
      socket = s; s.on('connect', () => s.emit('join:business', Number(businessId))); s.on('report:updated', onEvt);
    }));
    return () => { if (pend) clearTimeout(pend); if (socket) socket.disconnect(); };
  }, [businessId]);

  const setSetting = async (key: 'report_integrated_confirm' | 'monthly_finalize_enabled', next: boolean) => {
    if (!data) return; setData({ ...data, settings: { ...data.settings, [key === 'report_integrated_confirm' ? 'integrated_confirm' : 'monthly_finalize']: next } });
    try { await updateReportSettings(businessId, { [key]: next }); } catch { load(true); }
  };
  const saveExec = useCallback(async () => {
    if (!data?.integrated.id) return;
    try { await patchReportUnit(businessId, data.integrated.id, { narrative: execRef.current }); } catch { /* */ }
  }, [businessId, data]);
  const doConfirm = async () => { if (busy) return; setBusy(true); try { await confirmIntegrated(businessId, periodType, periodStart, execRef.current); await load(true); } catch { /* */ } finally { setBusy(false); } };
  const doReopen = async () => { if (busy) return; setBusy(true); try { await reopenIntegrated(businessId, periodType, periodStart); await load(true); } catch { /* */ } finally { setBusy(false); } };
  const doPrint = () => window.print();

  const label = (() => {
    const [y, m, d] = periodStart.split('-').map(Number);
    if (periodType === 'monthly') return t('weeklyReview.integrated.monthLabelY', { y, m, defaultValue: `${y}년 ${m}월` });
    return t('weeklyReview.integrated.weekLabel', { m, w: Math.ceil(d / 7), defaultValue: `${m}월 ${Math.ceil(d / 7)}주차` });
  })();

  if (loading) return <KpiGrid><KpiCard><Skel /></KpiCard><KpiCard><Skel /></KpiCard><KpiCard><Skel /></KpiCard><KpiCard><Skel /></KpiCard></KpiGrid>;
  if (!data) return <ErrBox>{t('weeklyReview.integrated.loadError', { defaultValue: '통합 현황을 불러오지 못했습니다' })} <Retry onClick={() => load()}>{t('weeklyReview.unit.retry', { defaultValue: '다시 시도' })}</Retry></ErrBox>;

  const s = data.summary;
  const igConfirmed = data.integrated.status === 'confirmed';
  const units = dim === 'project' ? data.projects : data.members;
  const confN = dim === 'project' ? s.projects_confirmed : s.members_confirmed;
  const confTotal = dim === 'project' ? s.projects_total : s.members_total;

  return (
    <Wrap>
      {/* 헤더: 기간 이동 + 액션 */}
      <HeaderRow>
        <PeriodNav>
          <NavBtn type="button" aria-label={t('weeklyReview.unit.prev', { defaultValue: '이전' }) as string} onClick={() => setPeriodStart((x) => shiftPeriod(periodType, x, -1))}>‹</NavBtn>
          <PeriodText>{label}</PeriodText>
          <NavBtn type="button" aria-label={t('weeklyReview.unit.next', { defaultValue: '다음' }) as string} onClick={() => setPeriodStart((x) => shiftPeriod(periodType, x, 1))}>›</NavBtn>
        </PeriodNav>
        <Flex1 />
        {s.all_confirmed
          ? <DoneChip>✓ {t('weeklyReview.integrated.allDone', { defaultValue: '전체 확정 완료' })}</DoneChip>
          : <PendChip>{t('weeklyReview.integrated.confProgress', { p: confN, total: confTotal, defaultValue: `확정 ${confN}/${confTotal}` })}</PendChip>}
        <ActionButton tone="secondary" size="sm" onClick={doPrint}>{t('weeklyReview.integrated.print', { defaultValue: '인쇄 · PDF' })}</ActionButton>
        {canManage && data.settings.integrated_confirm && (igConfirmed
          ? <ActionButton tone="secondary" size="sm" loading={busy} onClick={doReopen}>{t('weeklyReview.unit.reopen', { defaultValue: '되돌리기' })}</ActionButton>
          : <ActionButton tone="primary" size="sm" loading={busy} onClick={doConfirm}>{t('weeklyReview.integrated.confirm', { defaultValue: '통합 확정' })}</ActionButton>)}
      </HeaderRow>

      {/* 전사 집계 KPI */}
      <KpiGrid>
        <KpiCard><KpiLabel>{t('weeklyReview.content.done', { defaultValue: '완료' })}</KpiLabel><KpiValueBig>{s.completed_in_period}</KpiValueBig></KpiCard>
        <KpiCard><KpiLabel>{t('weeklyReview.content.inProgress', { defaultValue: '진행' })}</KpiLabel><KpiValueBig>{s.in_progress}</KpiValueBig></KpiCard>
        <KpiCard><KpiLabel>{t('weeklyReview.content.issues', { defaultValue: '이슈' })}</KpiLabel><KpiValueBig>{s.open_issues}</KpiValueBig></KpiCard>
        <KpiCard><KpiLabel>{t('weeklyReview.integrated.overdue', { defaultValue: '지연' })}</KpiLabel><KpiValueBig style={{ color: s.overdue > 0 ? '#B91C1C' : undefined }}>{s.overdue}</KpiValueBig></KpiCard>
        <KpiCard><KpiLabel>{t('weeklyReview.content.deliverables', { defaultValue: '산출물' })}</KpiLabel><KpiValueBig>{s.deliverables}</KpiValueBig></KpiCard>
        <KpiCard><KpiLabel>{t('weeklyReview.integrated.projectsLabel', { defaultValue: '프로젝트' })}</KpiLabel><KpiValueBig>{s.projects_total}</KpiValueBig><KpiHint>{t('weeklyReview.integrated.membersN', { n: s.members_total, defaultValue: `멤버 ${s.members_total}` })}</KpiHint></KpiCard>
      </KpiGrid>

      {/* 전사 요약 */}
      <SectionLabel>{t('weeklyReview.integrated.execSummary', { defaultValue: '전사 요약' })}</SectionLabel>
      <ChartCard>
        {canManage && !igConfirmed ? (
          <AutoSaveField onSave={saveExec} type="input">
            <ExecArea defaultValue={data.executive_summary} placeholder={t('weeklyReview.integrated.execPh', { defaultValue: '이번 기간 전사 차원의 판단·성과·리스크를 요약해 주세요 (자동 저장)' }) as string} onChange={(e) => { execRef.current = e.target.value; }} />
          </AutoSaveField>
        ) : (data.executive_summary ? <ExecRead>{data.executive_summary}</ExecRead> : <ExecMuted>{t('weeklyReview.integrated.execEmpty', { defaultValue: '작성된 전사 요약이 없습니다.' })}</ExecMuted>)}
      </ChartCard>

      {/* 뷰 전환 */}
      <ViewToggle role="tablist">
        <ViewTab type="button" role="tab" aria-selected={dim === 'project'} $on={dim === 'project'} onClick={() => setDim('project')}>{t('weeklyReview.integrated.byProject', { defaultValue: '프로젝트뷰' })} <ViewN>{data.projects.length}</ViewN></ViewTab>
        <ViewTab type="button" role="tab" aria-selected={dim === 'member'} $on={dim === 'member'} onClick={() => setDim('member')}>{t('weeklyReview.integrated.byMember', { defaultValue: '멤버뷰' })} <ViewN>{data.members.length}</ViewN></ViewTab>
      </ViewToggle>

      {/* 단위별 카드 (펼침) */}
      {units.length === 0 ? (
        <ChartCard><EmptyUnit>{t('weeklyReview.integrated.noUnits', { defaultValue: '이 기간에 보고할 대상이 없습니다.' })}</EmptyUnit></ChartCard>
      ) : units.map((u: IntegratedUnitView) => {
        const snap = u.snap || {};
        const kpi = snap.kpi || {};
        const h = HEALTH[String(kpi.health)] || null;
        return (
          <UnitCard key={`${u.scope}-${u.ref_id}`}>
            <UnitHead>
              <UnitName onClick={() => { if (u.scope === 'project') navigate(`/projects/p/${u.ref_id}`); }} $link={u.scope === 'project'}>{u.name}</UnitName>
              {u.department && <DeptTag>{u.department}</DeptTag>}
              <Flex1 />
              {u.scope === 'project' && <Pct>{kpi.progress_percent ?? 0}%</Pct>}
              {h && <HBadge style={{ background: h.bg, color: h.fg }}>{t(`weeklyReview.unit.health.${String(kpi.health)}`, { defaultValue: h.label })}</HBadge>}
              <UStatus $on={u.confirmed}>{u.confirmed ? (u.finalized_by === 'auto' ? t('weeklyReview.unit.auto', { defaultValue: '자동확정' }) : t('weeklyReview.integrated.confirmed', { defaultValue: '확정' })) : t('weeklyReview.integrated.pending', { defaultValue: '작성 중' })}</UStatus>
            </UnitHead>
            {u.narrative && (
              <Commentary>
                <ComLabel>{u.scope === 'project' ? t('weeklyReview.unit.pmComment', { defaultValue: 'PM 업무보고' }) : t('weeklyReview.unit.myComment', { defaultValue: '담당 코멘트' })}</ComLabel>
                <ComBody>{u.narrative}</ComBody>
              </Commentary>
            )}
            <ReportContent snap={snap} />
          </UnitCard>
        );
      })}

      {/* 설정 (owner) */}
      {canManage && (
        <SettingsBox>
          <SetRow><div><SetT>{t('weeklyReview.integrated.setIntegrated', { defaultValue: '통합 확정 단계 사용' })}</SetT><SetH>{t('weeklyReview.integrated.setIntegratedHint', { defaultValue: '켜면 대표가 통합본을 한 번 확정합니다.' })}</SetH></div>
            <Switch type="button" role="switch" aria-checked={data.settings.integrated_confirm} $on={data.settings.integrated_confirm} onClick={() => setSetting('report_integrated_confirm', !data.settings.integrated_confirm)}><Knob $on={data.settings.integrated_confirm} /></Switch></SetRow>
          <SetRow><div><SetT>{t('weeklyReview.integrated.setMonthly', { defaultValue: '월간 자동 확정' })}</SetT><SetH>{t('weeklyReview.integrated.setMonthlyHint', { defaultValue: '월 마감 시 미확정 보고서를 자동 확정합니다.' })}</SetH></div>
            <Switch type="button" role="switch" aria-checked={data.settings.monthly_finalize} $on={data.settings.monthly_finalize} onClick={() => setSetting('monthly_finalize_enabled', !data.settings.monthly_finalize)}><Knob $on={data.settings.monthly_finalize} /></Switch></SetRow>
        </SettingsBox>
      )}
    </Wrap>
  );
};

export default IntegratedReportView;

const Wrap = styled.div`display:flex;flex-direction:column;gap:16px;`;
const HeaderRow = styled.div`display:flex;align-items:center;gap:8px;flex-wrap:wrap;@media print{display:none;}`;
const PeriodNav = styled.div`display:inline-flex;align-items:center;gap:8px;`;
const NavBtn = styled.button`width:30px;height:30px;border:1px solid #E2E8F0;background:#fff;border-radius:8px;font-size:16px;color:#475569;cursor:pointer;&:hover{background:#F0FDFA;border-color:#99F6E4;color:#0F766E;}`;
const PeriodText = styled.span`font-size:15px;font-weight:700;color:#0F172A;min-width:104px;text-align:center;`;
const Flex1 = styled.div`flex:1;`;
const DoneChip = styled.span`font-size:12px;font-weight:700;color:#15803D;background:#DCFCE7;border-radius:999px;padding:4px 12px;`;
const PendChip = styled.span`font-size:12px;font-weight:700;color:#A16207;background:#FEF9C3;border-radius:999px;padding:4px 12px;`;

const ExecArea = styled.textarea`width:100%;min-height:84px;resize:vertical;border:1px solid #E2E8F0;border-radius:10px;padding:12px 14px;font-size:14px;line-height:1.7;color:#334155;font-family:inherit;&:focus{outline:none;border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,.15);}&::placeholder{color:#94A3B8;}`;
const ExecRead = styled.p`font-size:14px;line-height:1.75;color:#334155;white-space:pre-wrap;margin:0;`;
const ExecMuted = styled.p`font-size:13px;color:#94A3B8;margin:0;`;

const ViewToggle = styled.div`display:inline-flex;background:#F1F5F9;padding:3px;border-radius:9px;gap:2px;align-self:flex-start;@media print{display:none;}`;
const ViewTab = styled.button<{ $on: boolean }>`display:inline-flex;align-items:center;gap:6px;padding:8px 18px;border:none;background:${(p) => (p.$on ? '#fff' : 'transparent')};color:${(p) => (p.$on ? '#0F766E' : '#64748B')};border-radius:7px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:${(p) => (p.$on ? '0 1px 2px rgba(0,0,0,.06)' : 'none')};`;
const ViewN = styled.span`font-size:10px;font-weight:700;color:#94A3B8;`;

const UnitCard = styled.div`background:#fff;border:1px solid #E2E8F0;border-radius:14px;padding:20px 22px;box-shadow:0 1px 2px rgba(0,0,0,.04);@media (max-width:768px){padding:16px;}@media print{break-inside:avoid;box-shadow:none;}`;
const UnitHead = styled.div`display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px;`;
const UnitName = styled.h3<{ $link?: boolean }>`font-size:17px;font-weight:800;color:#0F172A;margin:0;min-width:0;word-break:break-word;${(p) => p.$link && 'cursor:pointer;&:hover{color:#0F766E;}'}`;
const DeptTag = styled.span`font-size:11px;font-weight:700;color:#475569;background:#E2E8F0;border-radius:999px;padding:2px 9px;`;
const Pct = styled.span`font-size:15px;font-weight:800;color:#0F172A;`;
const HBadge = styled.span`font-size:11px;font-weight:700;border-radius:999px;padding:3px 10px;`;
const UStatus = styled.span<{ $on: boolean }>`font-size:11px;font-weight:700;border-radius:999px;padding:3px 10px;background:${(p) => (p.$on ? '#CCFBF1' : '#FEF9C3')};color:${(p) => (p.$on ? '#0F766E' : '#A16207')};`;
const Commentary = styled.div`margin-bottom:14px;padding:12px 14px;background:#F8FAFC;border-left:3px solid #14B8A6;border-radius:0 8px 8px 0;`;
const ComLabel = styled.div`font-size:11px;font-weight:800;color:#0F766E;letter-spacing:.03em;margin-bottom:4px;`;
const ComBody = styled.p`font-size:14px;line-height:1.7;color:#334155;white-space:pre-wrap;margin:0;`;
const EmptyUnit = styled.div`font-size:14px;color:#94A3B8;padding:32px 20px;text-align:center;`;

const SettingsBox = styled.div`background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:8px 16px;@media print{display:none;}`;
const SetRow = styled.div`display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 0;&:not(:last-child){border-bottom:1px solid #E2E8F0;}`;
const SetT = styled.div`font-size:13px;font-weight:700;color:#0F172A;`;
const SetH = styled.div`font-size:11px;color:#94A3B8;margin-top:2px;`;
const Switch = styled.button<{ $on: boolean }>`width:40px;height:22px;border:none;border-radius:999px;background:${(p) => (p.$on ? '#14B8A6' : '#CBD5E1')};position:relative;cursor:pointer;flex-shrink:0;`;
const Knob = styled.span<{ $on: boolean }>`position:absolute;top:2px;left:${(p) => (p.$on ? '20px' : '2px')};width:18px;height:18px;border-radius:50%;background:#fff;transition:left .15s;box-shadow:0 1px 3px rgba(0,0,0,.2);`;
const Skel = styled.div`height:40px;background:#F1F5F9;border-radius:8px;`;
const ErrBox = styled.div`display:flex;align-items:center;gap:10px;padding:40px;color:#92400E;font-size:14px;justify-content:center;`;
const Retry = styled.button`height:34px;padding:0 16px;border:1px solid #E2E8F0;background:#fff;border-radius:8px;font-size:13px;font-weight:600;color:#0F766E;cursor:pointer;&:hover{background:#F0FDFA;}`;
