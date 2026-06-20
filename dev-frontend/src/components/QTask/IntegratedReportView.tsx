// IntegratedReportView — 통합 보고서 (R3' 재설계, 피드백 #64)
//   기간별 생성 보고서(주간 매주 + 월간 매월) 목록 → 선택 → 한 페이지 통합 문서.
//   문서 = 전사 요약 + 프로젝트별(대시보드 형태) + 멤버별 + 부서별. 통합확정/설정(owner·admin).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import ActionButton from '../Common/ActionButton';
import PlanQSelect, { type PlanQSelectOption } from '../Common/PlanQSelect';
import {
  getIntegrated, getIntegratedPeriods, confirmIntegrated, reopenIntegrated, updateReportSettings,
  periodStartOf, shiftPeriod,
  type ReportPeriodType, type IntegratedRollup, type IntegratedUnitRow, type IntegratedPeriodItem,
} from '../../services/reportUnit';

interface Props { businessId: number; canManage: boolean; }

const HEALTH: Record<string, { bg: string; fg: string }> = {
  green: { bg: '#DCFCE7', fg: '#15803D' }, yellow: { bg: '#FEF9C3', fg: '#A16207' }, red: { bg: '#FEE2E2', fg: '#B91C1C' },
};

const IntegratedReportView: React.FC<Props> = ({ businessId, canManage }) => {
  const { t } = useTranslation('qtask');
  const navigate = useNavigate();
  const [periods, setPeriods] = useState<{ weekly: IntegratedPeriodItem[]; monthly: IntegratedPeriodItem[] }>({ weekly: [], monthly: [] });
  const [sel, setSel] = useState<{ period_type: ReportPeriodType; period_start: string } | null>(null);
  const [data, setData] = useState<IntegratedRollup | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const periodLabel = useCallback((pt: ReportPeriodType, ps: string) => {
    const [y, m, d] = ps.split('-').map(Number);
    if (pt === 'monthly') return t('weeklyReview.unit.monthLabel', { y, m, defaultValue: `${y}년 ${m}월` });
    const w = Math.ceil(d / 7);
    return t('weeklyReview.integrated.weekLabel', { m, w, defaultValue: `${m}월 ${w}주차` });
  }, [t]);

  // 기간 목록 로드 + 기본 선택(이번 주)
  const loadPeriods = useCallback(async () => {
    try {
      const p = await getIntegratedPeriods(businessId);
      setPeriods(p);
      setSel((prev) => prev || (p.weekly[0] ? { period_type: 'weekly', period_start: p.weekly[0].period_start } : null));
    } catch { /* keep */ }
  }, [businessId]);

  const loadReport = useCallback(async (silent = false) => {
    if (!sel) return;
    if (!silent) setLoading(true);
    try { setData(await getIntegrated(businessId, sel.period_type, sel.period_start)); } catch { setData(null); }
    finally { setLoading(false); }
  }, [businessId, sel]);

  useEffect(() => { loadPeriods(); }, [loadPeriods]);
  useEffect(() => { if (sel) loadReport(); }, [sel, loadReport]);

  // §16 실시간 — 확정/수정 시 목록·문서 갱신
  const refRef = useRef<() => void>(() => {});
  refRef.current = () => { loadPeriods(); loadReport(true); };
  useEffect(() => {
    let socket: { disconnect: () => void } | null = null; let pend: ReturnType<typeof setTimeout> | null = null;
    const onEvt = () => { if (pend) clearTimeout(pend); pend = setTimeout(() => refRef.current(), 300); };
    import('socket.io-client').then(({ io }) => import('../../contexts/AuthContext').then(({ getAccessToken }) => {
      if (!getAccessToken()) return;
      const s = io({ auth: (cb: (d: { token: string | null }) => void) => cb({ token: getAccessToken() }), transports: ['websocket', 'polling'], reconnection: true });
      socket = s; s.on('connect', () => s.emit('join:business', Number(businessId))); s.on('report:updated', onEvt);
    }));
    return () => { if (pend) clearTimeout(pend); if (socket) socket.disconnect(); };
  }, [businessId]);

  const toggleSetting = async (key: 'report_integrated_confirm' | 'monthly_finalize_enabled', next: boolean) => {
    if (!data) return;
    setData({ ...data, settings: { ...data.settings, [key === 'report_integrated_confirm' ? 'integrated_confirm' : 'monthly_finalize']: next } });
    try { await updateReportSettings(businessId, { [key]: next }); } catch { loadReport(true); }
  };
  const doConfirm = async () => { if (!sel || busy) return; setBusy(true); try { await confirmIntegrated(businessId, sel.period_type, sel.period_start); await refRef.current(); } catch { /* */ } finally { setBusy(false); } };
  const doReopen = async () => { if (!sel || busy) return; setBusy(true); try { await reopenIntegrated(businessId, sel.period_type, sel.period_start); await refRef.current(); } catch { /* */ } finally { setBusy(false); } };

  const statusBadge = (it: IntegratedPeriodItem) => {
    if (it.status === 'confirmed') return it.finalized_by === 'auto' ? t('weeklyReview.unit.auto', { defaultValue: '자동' }) : t('weeklyReview.integrated.confirmed', { defaultValue: '확정' });
    return t('weeklyReview.integrated.live', { defaultValue: 'live' });
  };

  return (
    <Wrap>
      {/* 기간별 보고서 목록 */}
      <PeriodBar>
        <PGroup>
          <PGroupLabel>{t('weeklyReview.unit.weekly', { defaultValue: '주간' })}</PGroupLabel>
          <PChips>
            {periods.weekly.map((it) => {
              const active = sel?.period_type === 'weekly' && sel.period_start === it.period_start;
              return (
                <PChip key={`w-${it.period_start}`} type="button" $active={active} onClick={() => setSel({ period_type: 'weekly', period_start: it.period_start })}>
                  {periodLabel('weekly', it.period_start)}<PStatus $confirmed={it.status === 'confirmed'}>{statusBadge(it)}</PStatus>
                </PChip>
              );
            })}
          </PChips>
        </PGroup>
        <PGroup>
          <PGroupLabel>{t('weeklyReview.unit.monthly', { defaultValue: '월간' })}</PGroupLabel>
          <PChips>
            {periods.monthly.map((it) => {
              const active = sel?.period_type === 'monthly' && sel.period_start === it.period_start;
              return (
                <PChip key={`m-${it.period_start}`} type="button" $active={active} onClick={() => setSel({ period_type: 'monthly', period_start: it.period_start })}>
                  {periodLabel('monthly', it.period_start)}<PStatus $confirmed={it.status === 'confirmed'}>{statusBadge(it)}</PStatus>
                </PChip>
              );
            })}
          </PChips>
        </PGroup>
      </PeriodBar>

      {/* 선택 기간 보고서 문서 */}
      {loading || !data || !sel ? (
        <Skel><SkelBar style={{ width: '40%' }} /><SkelBlock /><SkelBlock /></Skel>
      ) : (() => {
        const s = data.summary;
        const confirmed = data.integrated.status === 'confirmed';
        return (
          <Doc>
            <DocHeader>
              <DocTitle>{t('weeklyReview.integrated.reportTitle', { period: periodLabel(sel.period_type, sel.period_start), defaultValue: `${periodLabel(sel.period_type, sel.period_start)} 통합보고서` })}</DocTitle>
              <StatusChip $confirmed={confirmed}>{confirmed ? (data.integrated.finalized_by === 'auto' ? t('weeklyReview.integrated.autoConfirmed', { defaultValue: '자동 확정' }) : t('weeklyReview.integrated.statusConfirmed', { defaultValue: '확정됨' })) : t('weeklyReview.integrated.statusLive', { defaultValue: 'live 롤업' })}</StatusChip>
              {confirmed && data.integrated.confirmed_at && <DocMeta>{String(data.integrated.confirmed_at).slice(0, 10)}</DocMeta>}
              <Spacer />
              {canManage && data.settings.integrated_confirm && (confirmed
                ? <ActionButton tone="secondary" size="sm" loading={busy} onClick={doReopen}>{t('weeklyReview.unit.reopen', { defaultValue: '되돌리기' })}</ActionButton>
                : <ActionButton tone="primary" size="sm" loading={busy} onClick={doConfirm}>{t('weeklyReview.integrated.confirm', { defaultValue: '통합 확정' })}</ActionButton>)}
            </DocHeader>

            {/* ① 전사 요약 */}
            <SecTitle>{t('weeklyReview.integrated.summary', { defaultValue: '전사 요약' })}</SecTitle>
            <KpiRow>
              <KpiCard><KpiVal>{s.avg_progress}<KpiUnit>%</KpiUnit></KpiVal><KpiLbl>{t('weeklyReview.integrated.avgProgress', { defaultValue: '평균 진행률' })}</KpiLbl></KpiCard>
              <KpiCard><KpiVal>{s.completed_in_period}</KpiVal><KpiLbl>{t('weeklyReview.integrated.completedInPeriod', { defaultValue: '기간 내 완료' })}</KpiLbl></KpiCard>
              <KpiCard $danger={s.overdue_count > 0}><KpiVal>{s.overdue_count}</KpiVal><KpiLbl>{t('weeklyReview.integrated.overdue', { defaultValue: '지연' })}</KpiLbl></KpiCard>
              <KpiCard><KpiVal>{s.projects_confirmed}<KpiUnit>/{s.projects_total}</KpiUnit></KpiVal><KpiLbl>{t('weeklyReview.integrated.projConfirmed', { defaultValue: '프로젝트 확정' })}</KpiLbl></KpiCard>
              <KpiCard><HealthSplit><HDot style={{ background: HEALTH.green.fg }} />{s.health_counts.green}<HDot style={{ background: HEALTH.yellow.fg }} />{s.health_counts.yellow}<HDot style={{ background: HEALTH.red.fg }} />{s.health_counts.red}</HealthSplit><KpiLbl>{t('weeklyReview.integrated.health', { defaultValue: '순항/주의/위험' })}</KpiLbl></KpiCard>
            </KpiRow>

            {/* ② 프로젝트별 — 대시보드 형태 카드 */}
            <SecTitle>{t('weeklyReview.integrated.byProject', { defaultValue: '프로젝트별' })}<Cnt>{data.projects.length}</Cnt></SecTitle>
            {data.projects.length === 0 ? <Muted>{t('weeklyReview.integrated.noProjects', { defaultValue: '활성 프로젝트가 없습니다' })}</Muted> : (
              <ProjGrid>
                {data.projects.map((p: IntegratedUnitRow) => {
                  const h = HEALTH[p.health || 'yellow'] || HEALTH.yellow;
                  return (
                    <ProjCard key={p.ref_id} type="button" onClick={() => navigate(`/projects/p/${p.ref_id}`)}>
                      <ProjTop><ProjName>{p.name}</ProjName><HBadge style={{ background: h.bg, color: h.fg }}>{t(`weeklyReview.unit.health.${p.health || 'yellow'}`, { defaultValue: p.health || 'yellow' })}</HBadge></ProjTop>
                      <BarTrack><BarFill style={{ width: `${p.progress_percent}%` }} /></BarTrack>
                      <ProjMeta>
                        <Pct>{p.progress_percent}%</Pct>
                        <MetaItem>{t('weeklyReview.integrated.completedFull', { defaultValue: '완료' })} {p.completed_tasks}/{p.total_tasks}</MetaItem>
                        {p.overdue_count > 0 && <OverdueChip>{t('weeklyReview.integrated.overdue', { defaultValue: '지연' })} {p.overdue_count}</OverdueChip>}
                        <UStatus $on={p.confirmed}>{p.confirmed ? t('weeklyReview.integrated.confirmed', { defaultValue: '확정' }) : t('weeklyReview.integrated.pending', { defaultValue: '미확정' })}</UStatus>
                      </ProjMeta>
                    </ProjCard>
                  );
                })}
              </ProjGrid>
            )}

            {/* ③ 멤버별 */}
            <SecTitle>{t('weeklyReview.integrated.byMember', { defaultValue: '멤버별' })}<Cnt>{data.members.length}</Cnt></SecTitle>
            {data.members.length === 0 ? <Muted>{t('weeklyReview.integrated.noMembers', { defaultValue: '멤버가 없습니다' })}</Muted> : (
              <Scroll>
                <MHead $cols="2fr 1fr 1fr 1fr 1.2fr"><span>{t('weeklyReview.integrated.name', { defaultValue: '이름' })}</span><span>{t('weeklyReview.unit.active', { defaultValue: '진행' })}</span><span>{t('weeklyReview.unit.done', { defaultValue: '완료' })}</span><span>{t('weeklyReview.integrated.overdue', { defaultValue: '지연' })}</span><span>{t('weeklyReview.integrated.completedInPeriod', { defaultValue: '기간 내 완료' })}</span></MHead>
                {data.members.map((m) => (
                  <MRow key={m.user_id} $cols="2fr 1fr 1fr 1fr 1.2fr"><MName>{m.name}</MName><span>{m.active}</span><span>{m.completed}</span><MOverdue $n={m.overdue}>{m.overdue}</MOverdue><span>{m.completed_in_period}</span></MRow>
                ))}
              </Scroll>
            )}

            {/* ④ 부서별 */}
            {data.departments.length > 0 && (<>
              <SecTitle>{t('weeklyReview.integrated.byDept', { defaultValue: '부서별' })}<Cnt>{data.departments.length}</Cnt></SecTitle>
              <Scroll>
                <MHead $cols="2.4fr 1fr 1fr 0.8fr 1fr"><span>{t('weeklyReview.integrated.name', { defaultValue: '이름' })}</span><span>{t('weeklyReview.integrated.status', { defaultValue: '상태' })}</span><span>{t('weeklyReview.unit.kpi.progress', { defaultValue: '진행률' })}</span><span>{t('weeklyReview.integrated.overdue', { defaultValue: '지연' })}</span><span>{t('weeklyReview.unit.kpi.health', { defaultValue: '상태' })}</span></MHead>
                {data.departments.map((d: IntegratedUnitRow) => {
                  const h = HEALTH[d.health || 'yellow'] || HEALTH.yellow;
                  return (
                    <MRow key={d.ref_id} $cols="2.4fr 1fr 1fr 0.8fr 1fr"><MName>{d.name}</MName><UStatus $on={d.confirmed} style={{ justifySelf: 'center' }}>{d.confirmed ? t('weeklyReview.integrated.confirmed', { defaultValue: '확정' }) : t('weeklyReview.integrated.pending', { defaultValue: '미확정' })}</UStatus><span>{d.progress_percent}%</span><MOverdue $n={d.overdue_count}>{d.overdue_count}</MOverdue>{d.health ? <HBadge style={{ background: h.bg, color: h.fg, justifySelf: 'center' }}>{t(`weeklyReview.unit.health.${d.health}`, { defaultValue: d.health })}</HBadge> : <span>—</span>}</MRow>
                  );
                })}
              </Scroll>
            </>)}

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
          </Doc>
        );
      })()}
    </Wrap>
  );
};

export default IntegratedReportView;

// ─── styles ───
const Wrap = styled.div`display:flex;flex-direction:column;gap:16px;max-width:1100px;`;
const PeriodBar = styled.div`display:flex;flex-direction:column;gap:10px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:12px 14px;`;
const PGroup = styled.div`display:flex;align-items:center;gap:10px;`;
const PGroupLabel = styled.span`flex-shrink:0;width:40px;font-size:12px;font-weight:700;color:#64748B;`;
const PChips = styled.div`display:flex;gap:6px;overflow-x:auto;padding-bottom:2px;&::-webkit-scrollbar{height:5px;}&::-webkit-scrollbar-thumb{background:#CBD5E1;border-radius:3px;}`;
const PChip = styled.button<{ $active: boolean }>`display:inline-flex;align-items:center;gap:6px;flex-shrink:0;padding:6px 11px;border-radius:999px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;white-space:nowrap;border:1px solid ${(p) => (p.$active ? '#14B8A6' : '#E2E8F0')};background:${(p) => (p.$active ? '#F0FDFA' : '#fff')};color:${(p) => (p.$active ? '#0F766E' : '#475569')};&:hover{border-color:#14B8A6;}&:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;}`;
const PStatus = styled.span<{ $confirmed: boolean }>`font-size:10px;font-weight:700;border-radius:999px;padding:1px 6px;background:${(p) => (p.$confirmed ? '#CCFBF1' : '#F1F5F9')};color:${(p) => (p.$confirmed ? '#0F766E' : '#94A3B8')};`;
const Doc = styled.div`display:flex;flex-direction:column;gap:14px;background:#fff;border:1px solid #E2E8F0;border-radius:14px;padding:20px 22px;`;
const DocHeader = styled.div`display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding-bottom:14px;border-bottom:1px solid #F1F5F9;`;
const DocTitle = styled.h2`font-size:18px;font-weight:700;color:#0F172A;margin:0;`;
const StatusChip = styled.span<{ $confirmed: boolean }>`font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px;background:${(p) => (p.$confirmed ? '#14B8A6' : '#E2E8F0')};color:${(p) => (p.$confirmed ? '#fff' : '#475569')};`;
const DocMeta = styled.span`font-size:12px;color:#64748B;`;
const Spacer = styled.div`flex:1;`;
const SecTitle = styled.div`font-size:14px;font-weight:700;color:#0F172A;margin-top:6px;display:flex;align-items:center;gap:8px;`;
const Cnt = styled.span`display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:18px;padding:0 6px;background:#F1F5F9;color:#64748B;border-radius:999px;font-size:11px;font-weight:700;`;
const KpiRow = styled.div`display:grid;grid-template-columns:repeat(5,1fr);gap:12px;@media (max-width:768px){grid-template-columns:repeat(2,1fr);}`;
const KpiCard = styled.div<{ $danger?: boolean }>`display:flex;flex-direction:column;gap:4px;background:#fff;border:1px solid ${(p) => (p.$danger ? '#FECACA' : '#E2E8F0')};border-radius:12px;padding:14px 16px;`;
const KpiVal = styled.div`font-size:22px;font-weight:700;color:#0F172A;font-variant-numeric:tabular-nums;display:flex;align-items:baseline;gap:3px;`;
const KpiUnit = styled.span`font-size:12px;font-weight:600;color:#94A3B8;`;
const KpiLbl = styled.div`font-size:11px;font-weight:600;color:#94A3B8;`;
const HealthSplit = styled.div`display:flex;align-items:center;gap:4px;font-size:16px;font-weight:700;color:#0F172A;font-variant-numeric:tabular-nums;`;
const HDot = styled.span`width:8px;height:8px;border-radius:50%;&:not(:first-child){margin-left:6px;}`;
const Muted = styled.div`font-size:13px;color:#94A3B8;padding:6px 0;`;
const ProjGrid = styled.div`display:grid;grid-template-columns:repeat(2,1fr);gap:12px;@media (max-width:768px){grid-template-columns:1fr;}`;
const ProjCard = styled.button`display:flex;flex-direction:column;gap:9px;width:100%;text-align:left;background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:14px 16px;cursor:pointer;font-family:inherit;&:hover{border-color:#99F6E4;box-shadow:0 2px 10px rgba(20,184,166,.08);}&:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;}`;
const ProjTop = styled.div`display:flex;align-items:center;gap:8px;`;
const ProjName = styled.span`flex:1;font-size:14px;font-weight:700;color:#0F172A;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
const HBadge = styled.span`font-size:10px;font-weight:700;border-radius:999px;padding:2px 8px;flex-shrink:0;`;
const BarTrack = styled.div`height:6px;background:#F1F5F9;border-radius:999px;overflow:hidden;`;
const BarFill = styled.div`height:100%;background:linear-gradient(90deg,#99F6E4,#14B8A6);border-radius:999px;`;
const ProjMeta = styled.div`display:flex;align-items:center;gap:8px;flex-wrap:wrap;`;
const Pct = styled.span`font-size:13px;font-weight:700;color:#0F172A;font-variant-numeric:tabular-nums;`;
const MetaItem = styled.span`font-size:12px;color:#64748B;`;
const OverdueChip = styled.span`font-size:11px;font-weight:700;color:#B91C1C;background:#FEE2E2;border-radius:999px;padding:1px 8px;`;
const UStatus = styled.span<{ $on: boolean }>`font-size:11px;font-weight:700;border-radius:999px;padding:2px 8px;margin-left:auto;background:${(p) => (p.$on ? '#CCFBF1' : '#FEF9C3')};color:${(p) => (p.$on ? '#0F766E' : '#A16207')};`;
const Scroll = styled.div`overflow-x:auto;`;
const MHead = styled.div<{ $cols: string }>`display:grid;grid-template-columns:${(p) => p.$cols};gap:8px;padding:6px 8px;min-width:440px;font-size:11px;font-weight:700;color:#94A3B8;border-bottom:1px solid #E2E8F0;& > span:not(:first-child){text-align:center;}`;
const MRow = styled.div<{ $cols: string }>`display:grid;grid-template-columns:${(p) => p.$cols};gap:8px;padding:9px 8px;min-width:440px;font-size:13px;color:#334155;border-bottom:1px solid #F1F5F9;align-items:center;& > span{text-align:center;}`;
const MName = styled.span`font-weight:600;color:#0F172A;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left !important;`;
const MOverdue = styled.span<{ $n: number }>`text-align:center;font-weight:700;color:${(p) => (p.$n > 0 ? '#B91C1C' : '#CBD5E1')};`;
const SettingsBox = styled.div`background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:8px 16px;margin-top:6px;`;
const SetRow = styled.div`display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 0;&:not(:last-child){border-bottom:1px solid #E2E8F0;}`;
const SetTitle = styled.div`font-size:13px;font-weight:700;color:#0F172A;`;
const SetHint = styled.div`font-size:11px;color:#94A3B8;margin-top:2px;max-width:520px;`;
const Switch = styled.button<{ $on: boolean }>`width:40px;height:22px;border:none;border-radius:999px;background:${(p) => (p.$on ? '#14B8A6' : '#CBD5E1')};position:relative;cursor:pointer;flex-shrink:0;transition:background .15s;`;
const Knob = styled.span<{ $on: boolean }>`position:absolute;top:2px;left:${(p) => (p.$on ? '20px' : '2px')};width:18px;height:18px;border-radius:50%;background:#fff;transition:left .15s;box-shadow:0 1px 3px rgba(0,0,0,.2);`;
const Skel = styled.div`display:flex;flex-direction:column;gap:14px;`;
const SkelBar = styled.div`height:20px;background:#F1F5F9;border-radius:8px;`;
const SkelBlock = styled.div`height:120px;background:#F1F5F9;border-radius:12px;`;
