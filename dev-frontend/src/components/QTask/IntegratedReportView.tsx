// IntegratedReportView — 통합 보고서 롤업 (R3-C2, 마스터설계 §4.4·§7.3)
//   확정/미확정 현황 매트릭스 + 포트폴리오 롤업 + (설정 ON·owner/admin) 통합확정 + 설정 토글.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import ActionButton from '../Common/ActionButton';
import {
  getIntegrated, confirmIntegrated, reopenIntegrated, updateReportSettings,
  periodStartOf, shiftPeriod,
  type ReportPeriodType, type IntegratedRollup, type IntegratedUnitRow,
} from '../../services/reportUnit';

interface Props { businessId: number; canManage: boolean; }

const HEALTH: Record<string, { bg: string; fg: string }> = {
  green: { bg: '#DCFCE7', fg: '#15803D' }, yellow: { bg: '#FEF9C3', fg: '#A16207' }, red: { bg: '#FEE2E2', fg: '#B91C1C' },
};

const IntegratedReportView: React.FC<Props> = ({ businessId, canManage }) => {
  const { t } = useTranslation('qtask');
  const [periodType, setPeriodType] = useState<ReportPeriodType>('weekly');
  const [periodStart, setPeriodStart] = useState<string>(() => periodStartOf('weekly'));
  const [data, setData] = useState<IntegratedRollup | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try { setData(await getIntegrated(businessId, periodType, periodStart)); } catch { setData(null); }
    finally { setLoading(false); }
  }, [businessId, periodType, periodStart]);
  useEffect(() => { load(); }, [load]);

  // §16 실시간 — 단위/통합 확정 변경 시 갱신
  const loadRef = useRef(load); loadRef.current = load;
  useEffect(() => {
    let socket: { disconnect: () => void } | null = null; let pending: ReturnType<typeof setTimeout> | null = null;
    const onEvt = () => { if (pending) clearTimeout(pending); pending = setTimeout(() => loadRef.current(true), 300); };
    import('socket.io-client').then(({ io }) => import('../../contexts/AuthContext').then(({ getAccessToken }) => {
      if (!getAccessToken()) return;
      const s = io({ auth: (cb: (d: { token: string | null }) => void) => cb({ token: getAccessToken() }), transports: ['websocket', 'polling'], reconnection: true });
      socket = s; s.on('connect', () => s.emit('join:business', Number(businessId))); s.on('report:updated', onEvt);
    }));
    return () => { if (pending) clearTimeout(pending); if (socket) socket.disconnect(); };
  }, [businessId]);

  const toggleSetting = async (key: 'report_integrated_confirm' | 'monthly_finalize_enabled', next: boolean) => {
    if (!data) return;
    setData({ ...data, settings: { ...data.settings, [key === 'report_integrated_confirm' ? 'integrated_confirm' : 'monthly_finalize']: next } });
    try { await updateReportSettings(businessId, { [key]: next }); } catch { load(true); }
  };
  const doConfirm = async () => { if (busy) return; setBusy(true); try { await confirmIntegrated(businessId, periodType, periodStart); await load(true); } catch { /* */ } finally { setBusy(false); } };
  const doReopen = async () => { if (busy) return; setBusy(true); try { await reopenIntegrated(businessId, periodType, periodStart); await load(true); } catch { /* */ } finally { setBusy(false); } };

  if (loading) return <Skel><SkelBar style={{ width: '40%' }} /><SkelBlock /></Skel>;
  if (!data) return <ErrorBox>{t('weeklyReview.integrated.loadError', { defaultValue: '통합 현황을 불러오지 못했습니다' })}<Retry onClick={() => load()}>{t('weeklyReview.unit.retry', { defaultValue: '다시 시도' })}</Retry></ErrorBox>;

  const s = data.summary;
  const confirmed = data.integrated.status === 'confirmed';
  const periodLabel = periodType === 'monthly'
    ? (() => { const [y, m] = periodStart.split('-'); return t('weeklyReview.unit.monthLabel', { y, m: Number(m), defaultValue: `${y}년 ${Number(m)}월` }); })()
    : periodStart;

  const Row = (r: IntegratedUnitRow) => (
    <MRow key={`${r.scope}-${r.ref_id}`}>
      <MName>{r.name}</MName>
      <UnitStatus $on={r.confirmed}>{r.confirmed ? t('weeklyReview.integrated.confirmed', { defaultValue: '확정' }) : t('weeklyReview.integrated.pending', { defaultValue: '미확정' })}</UnitStatus>
      <span>{r.progress_percent}%</span>
      <MOverdue $n={r.overdue_count}>{r.overdue_count}</MOverdue>
      {r.health ? <HBadge style={{ background: (HEALTH[r.health] || HEALTH.yellow).bg, color: (HEALTH[r.health] || HEALTH.yellow).fg }}>{t(`weeklyReview.unit.health.${r.health}`, { defaultValue: r.health })}</HBadge> : <span>—</span>}
    </MRow>
  );

  return (
    <Wrap>
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
          <NavBtn type="button" aria-label={t('weeklyReview.unit.prev', { defaultValue: '이전' }) as string} onClick={() => setPeriodStart((x) => shiftPeriod(periodType, x, -1))}>‹</NavBtn>
          <PeriodLbl>{periodLabel}</PeriodLbl>
          <NavBtn type="button" aria-label={t('weeklyReview.unit.next', { defaultValue: '다음' }) as string} onClick={() => setPeriodStart((x) => shiftPeriod(periodType, x, 1))}>›</NavBtn>
        </PeriodNav>
      </TopBar>

      {/* 요약 KPI */}
      <KpiRow>
        <KpiCard><KpiVal>{s.avg_progress}<KpiUnit>%</KpiUnit></KpiVal><KpiLbl>{t('weeklyReview.integrated.avgProgress', { defaultValue: '평균 진행률' })}</KpiLbl></KpiCard>
        <KpiCard><KpiVal>{s.completed_tasks}</KpiVal><KpiLbl>{t('weeklyReview.integrated.completed', { defaultValue: '완료 업무' })}</KpiLbl></KpiCard>
        <KpiCard $danger={s.overdue_count > 0}><KpiVal>{s.overdue_count}</KpiVal><KpiLbl>{t('weeklyReview.integrated.overdue', { defaultValue: '지연' })}</KpiLbl></KpiCard>
        <KpiCard><KpiVal>{s.projects_confirmed}<KpiUnit>/{s.projects_total}</KpiUnit></KpiVal><KpiLbl>{t('weeklyReview.integrated.projConfirmed', { defaultValue: '프로젝트 확정' })}</KpiLbl></KpiCard>
        <KpiCard><KpiVal>{s.departments_confirmed}<KpiUnit>/{s.departments_total}</KpiUnit></KpiVal><KpiLbl>{t('weeklyReview.integrated.deptConfirmed', { defaultValue: '부서 확정' })}</KpiLbl></KpiCard>
      </KpiRow>

      {/* 통합확정 상태 + 액션 */}
      <StatusBar $confirmed={confirmed}>
        <StatusChip $confirmed={confirmed}>{confirmed ? t('weeklyReview.integrated.statusConfirmed', { defaultValue: '통합 확정됨' }) : t('weeklyReview.integrated.statusLive', { defaultValue: 'live 롤업' })}</StatusChip>
        {confirmed && data.integrated.confirmed_at && <StatusMeta>{String(data.integrated.confirmed_at).slice(0, 10)}{data.integrated.finalized_by === 'auto' && ` · ${t('weeklyReview.unit.auto', { defaultValue: '자동' })}`}</StatusMeta>}
        {!data.settings.integrated_confirm && <StatusMeta>{t('weeklyReview.integrated.autoVisible', { defaultValue: '하위 확정 시 자동 노출 (통합확정 단계 꺼짐)' })}</StatusMeta>}
        <Spacer />
        {canManage && data.settings.integrated_confirm && (confirmed
          ? <ActionButton tone="secondary" size="sm" loading={busy} onClick={doReopen}>{t('weeklyReview.unit.reopen', { defaultValue: '되돌리기' })}</ActionButton>
          : <ActionButton tone="primary" size="sm" loading={busy} onClick={doConfirm}>{t('weeklyReview.integrated.confirm', { defaultValue: '통합 확정' })}</ActionButton>)}
      </StatusBar>

      {/* 확정현황 매트릭스 */}
      {data.projects.length > 0 && (
        <Section>
          <SecTitle>{t('weeklyReview.integrated.projects', { defaultValue: '프로젝트' })}<Cnt>{data.projects.length}</Cnt></SecTitle>
          <MatrixScroll>
            <MHead><span>{t('weeklyReview.integrated.name', { defaultValue: '이름' })}</span><span>{t('weeklyReview.integrated.status', { defaultValue: '상태' })}</span><span>{t('weeklyReview.unit.kpi.progress', { defaultValue: '진행률' })}</span><span>{t('weeklyReview.integrated.overdue', { defaultValue: '지연' })}</span><span>{t('weeklyReview.unit.kpi.health', { defaultValue: '상태' })}</span></MHead>
            {data.projects.map(Row)}
          </MatrixScroll>
        </Section>
      )}
      {data.departments.length > 0 && (
        <Section>
          <SecTitle>{t('weeklyReview.integrated.departments', { defaultValue: '부서' })}<Cnt>{data.departments.length}</Cnt></SecTitle>
          <MatrixScroll>
            <MHead><span>{t('weeklyReview.integrated.name', { defaultValue: '이름' })}</span><span>{t('weeklyReview.integrated.status', { defaultValue: '상태' })}</span><span>{t('weeklyReview.unit.kpi.progress', { defaultValue: '진행률' })}</span><span>{t('weeklyReview.integrated.overdue', { defaultValue: '지연' })}</span><span>{t('weeklyReview.unit.kpi.health', { defaultValue: '상태' })}</span></MHead>
            {data.departments.map(Row)}
          </MatrixScroll>
        </Section>
      )}

      {/* 설정 (owner/admin) */}
      {canManage && (
        <SettingsBox>
          <SetRow>
            <div><SetTitle>{t('weeklyReview.integrated.setIntegrated', { defaultValue: '통합 확정 단계 사용' })}</SetTitle><SetHint>{t('weeklyReview.integrated.setIntegratedHint', { defaultValue: '켜면 대표가 통합본을 한 번 확정합니다. 끄면 하위 확정 시 자동 노출.' })}</SetHint></div>
            <Switch type="button" role="switch" aria-checked={data.settings.integrated_confirm} $on={data.settings.integrated_confirm} onClick={() => toggleSetting('report_integrated_confirm', !data.settings.integrated_confirm)}><Knob $on={data.settings.integrated_confirm} /></Switch>
          </SetRow>
          <SetRow>
            <div><SetTitle>{t('weeklyReview.integrated.setMonthly', { defaultValue: '월간 자동 확정' })}</SetTitle><SetHint>{t('weeklyReview.integrated.setMonthlyHint', { defaultValue: '월 마감 시 미확정 단위 보고서를 자동 확정합니다.' })}</SetHint></div>
            <Switch type="button" role="switch" aria-checked={data.settings.monthly_finalize} $on={data.settings.monthly_finalize} onClick={() => toggleSetting('monthly_finalize_enabled', !data.settings.monthly_finalize)}><Knob $on={data.settings.monthly_finalize} /></Switch>
          </SetRow>
        </SettingsBox>
      )}
    </Wrap>
  );
};

export default IntegratedReportView;

// ─── styles ───
const Wrap = styled.div`display:flex;flex-direction:column;gap:16px;max-width:1100px;`;
const TopBar = styled.div`display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;`;
const PeriodToggle = styled.div`display:inline-flex;background:#F1F5F9;padding:3px;border-radius:8px;gap:2px;`;
const PToggleBtn = styled.button<{ $on: boolean }>`padding:6px 14px;border:none;background:${p => p.$on ? '#fff' : 'transparent'};color:${p => p.$on ? '#0F766E' : '#64748B'};border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;box-shadow:${p => p.$on ? '0 1px 2px rgba(0,0,0,.06)' : 'none'};`;
const PeriodNav = styled.div`display:inline-flex;align-items:center;gap:8px;`;
const NavBtn = styled.button`width:28px;height:28px;border:1px solid #E2E8F0;background:#fff;border-radius:6px;font-size:16px;color:#475569;cursor:pointer;&:hover{background:#F0FDFA;border-color:#99F6E4;color:#0F766E;}`;
const PeriodLbl = styled.span`font-size:13px;font-weight:700;color:#0F172A;min-width:120px;text-align:center;`;
const KpiRow = styled.div`display:grid;grid-template-columns:repeat(5,1fr);gap:12px;@media (max-width:768px){grid-template-columns:repeat(2,1fr);}`;
const KpiCard = styled.div<{ $danger?: boolean }>`display:flex;flex-direction:column;gap:4px;background:#fff;border:1px solid ${p => p.$danger ? '#FECACA' : '#E2E8F0'};border-radius:12px;padding:14px 16px;`;
const KpiVal = styled.div`font-size:22px;font-weight:700;color:#0F172A;font-variant-numeric:tabular-nums;display:flex;align-items:baseline;gap:3px;`;
const KpiUnit = styled.span`font-size:12px;font-weight:600;color:#94A3B8;`;
const KpiLbl = styled.div`font-size:11px;font-weight:600;color:#94A3B8;`;
const StatusBar = styled.div<{ $confirmed: boolean }>`display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 14px;border-radius:10px;border:1px solid ${p => p.$confirmed ? '#99F6E4' : '#E2E8F0'};background:${p => p.$confirmed ? '#F0FDFA' : '#F8FAFC'};`;
const StatusChip = styled.span<{ $confirmed: boolean }>`font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px;background:${p => p.$confirmed ? '#14B8A6' : '#E2E8F0'};color:${p => p.$confirmed ? '#fff' : '#475569'};`;
const StatusMeta = styled.span`font-size:12px;color:#64748B;`;
const Spacer = styled.div`flex:1;`;
const Section = styled.div`background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:16px 18px;`;
const SecTitle = styled.div`font-size:14px;font-weight:700;color:#0F172A;margin-bottom:12px;display:flex;align-items:center;gap:8px;`;
const Cnt = styled.span`display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:18px;padding:0 6px;background:#F1F5F9;color:#64748B;border-radius:999px;font-size:11px;font-weight:700;`;
const MatrixScroll = styled.div`overflow-x:auto;`;
const MHead = styled.div`display:grid;grid-template-columns:2.4fr 1fr 1fr 0.8fr 1fr;gap:8px;padding:6px 8px;min-width:440px;font-size:11px;font-weight:700;color:#94A3B8;border-bottom:1px solid #E2E8F0;& > span:not(:first-child){text-align:center;}`;
const MRow = styled.div`display:grid;grid-template-columns:2.4fr 1fr 1fr 0.8fr 1fr;gap:8px;padding:9px 8px;min-width:440px;font-size:13px;color:#334155;border-bottom:1px solid #F1F5F9;align-items:center;& > span{text-align:center;}`;
const MName = styled.span`font-weight:600;color:#0F172A;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left !important;`;
const UnitStatus = styled.span<{ $on: boolean }>`font-size:11px;font-weight:700;border-radius:999px;padding:2px 8px;justify-self:center;background:${p => p.$on ? '#CCFBF1' : '#FEF3C7'};color:${p => p.$on ? '#0F766E' : '#A16207'};`;
const MOverdue = styled.span<{ $n: number }>`font-weight:700;color:${p => p.$n > 0 ? '#B91C1C' : '#CBD5E1'};`;
const HBadge = styled.span`font-size:10px;font-weight:700;border-radius:999px;padding:2px 8px;justify-self:center;`;
const SettingsBox = styled.div`background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:8px 16px;`;
const SetRow = styled.div`display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 0;&:not(:last-child){border-bottom:1px solid #E2E8F0;}`;
const SetTitle = styled.div`font-size:13px;font-weight:700;color:#0F172A;`;
const SetHint = styled.div`font-size:11px;color:#94A3B8;margin-top:2px;max-width:520px;`;
const Switch = styled.button<{ $on: boolean }>`width:40px;height:22px;border:none;border-radius:999px;background:${p => p.$on ? '#14B8A6' : '#CBD5E1'};position:relative;cursor:pointer;flex-shrink:0;transition:background .15s;`;
const Knob = styled.span<{ $on: boolean }>`position:absolute;top:2px;left:${p => p.$on ? '20px' : '2px'};width:18px;height:18px;border-radius:50%;background:#fff;transition:left .15s;box-shadow:0 1px 3px rgba(0,0,0,.2);`;
const Skel = styled.div`display:flex;flex-direction:column;gap:14px;`;
const SkelBar = styled.div`height:20px;background:#F1F5F9;border-radius:8px;`;
const SkelBlock = styled.div`height:120px;background:#F1F5F9;border-radius:12px;`;
const ErrorBox = styled.div`display:flex;flex-direction:column;align-items:center;gap:10px;padding:40px;color:#92400E;font-size:14px;`;
const Retry = styled.button`height:34px;padding:0 16px;border:1px solid #E2E8F0;background:#fff;border-radius:8px;font-size:13px;font-weight:600;color:#0F766E;cursor:pointer;&:hover{background:#F0FDFA;}`;
