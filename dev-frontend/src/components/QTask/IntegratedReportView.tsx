// IntegratedReportView — 통합 보고서 (보기 전용). 프로젝트뷰/개인뷰 맥킨지 한눈 카드.
//   판단→핵심→material 이슈 (접힘). [자세히] 펼치면 ReportContent. 단위별 확정/미확정. 통합확정(owner).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import ActionButton from '../Common/ActionButton';
import ReportContent from './report/ReportContent';
import {
  getIntegrated, confirmIntegrated, reopenIntegrated, updateReportSettings, periodStartOf, shiftPeriod,
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try { setData(await getIntegrated(businessId, periodType, periodStart)); } catch { setData(null); } finally { setLoading(false); }
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

  const toggle = (key: string) => setExpanded((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const setSetting = async (key: 'report_integrated_confirm' | 'monthly_finalize_enabled', next: boolean) => {
    if (!data) return; setData({ ...data, settings: { ...data.settings, [key === 'report_integrated_confirm' ? 'integrated_confirm' : 'monthly_finalize']: next } });
    try { await updateReportSettings(businessId, { [key]: next }); } catch { load(true); }
  };
  const doConfirm = async () => { if (busy) return; setBusy(true); try { await confirmIntegrated(businessId, periodType, periodStart); await load(true); } catch { /* */ } finally { setBusy(false); } };
  const doReopen = async () => { if (busy) return; setBusy(true); try { await reopenIntegrated(businessId, periodType, periodStart); await load(true); } catch { /* */ } finally { setBusy(false); } };

  const label = (() => {
    const [y, m, d] = periodStart.split('-').map(Number);
    if (periodType === 'monthly') return t('weeklyReview.integrated.monthLabelY', { y, m, defaultValue: `${y}년 ${m}월` });
    return t('weeklyReview.integrated.weekLabel', { m, w: Math.ceil(d / 7), defaultValue: `${m}월 ${Math.ceil(d / 7)}주차` });
  })();

  if (loading) return <Skel><SkelBar style={{ width: '40%' }} /><SkelBlock /></Skel>;
  if (!data) return <Err>{t('weeklyReview.integrated.loadError', { defaultValue: '통합 현황을 불러오지 못했습니다' })}<Retry onClick={() => load()}>{t('weeklyReview.unit.retry', { defaultValue: '다시 시도' })}</Retry></Err>;

  const s = data.summary;
  const igConfirmed = data.integrated.status === 'confirmed';
  const units = dim === 'project' ? data.projects : data.members;

  return (
    <Wrap>
      <TopBar>
        <Nav>
          <NavBtn type="button" aria-label={t('weeklyReview.unit.prev', { defaultValue: '이전' }) as string} onClick={() => setPeriodStart((x) => shiftPeriod(periodType, x, -1))}>‹</NavBtn>
          <PLabel>{label} {t('weeklyReview.integrated.reportSuffix', { defaultValue: '통합보고서' })}</PLabel>
          <NavBtn type="button" aria-label={t('weeklyReview.unit.next', { defaultValue: '다음' }) as string} onClick={() => setPeriodStart((x) => shiftPeriod(periodType, x, 1))}>›</NavBtn>
        </Nav>
        <Spacer />
        {s.all_confirmed && <DoneChip>✓ {t('weeklyReview.integrated.allDone', { defaultValue: '전체 확정 완료' })}</DoneChip>}
        {canManage && data.settings.integrated_confirm && (igConfirmed
          ? <ActionButton tone="secondary" size="sm" loading={busy} onClick={doReopen}>{t('weeklyReview.unit.reopen', { defaultValue: '되돌리기' })}</ActionButton>
          : <ActionButton tone="primary" size="sm" loading={busy} onClick={doConfirm}>{t('weeklyReview.integrated.confirm', { defaultValue: '통합 확정' })}</ActionButton>)}
      </TopBar>

      <SummaryLine>
        <span>{t('weeklyReview.content.done', { defaultValue: '완료' })} {s.completed_in_period}</span><Sep>·</Sep>
        <span>{t('weeklyReview.content.inProgress', { defaultValue: '진행' })} {s.in_progress}</span><Sep>·</Sep>
        <span>{t('weeklyReview.content.issues', { defaultValue: '이슈' })} {s.open_issues}</span><Sep>·</Sep>
        <Danger>{t('weeklyReview.integrated.overdue', { defaultValue: '지연' })} {s.overdue}</Danger><Sep>·</Sep>
        <span>{t('weeklyReview.content.deliverables', { defaultValue: '산출물' })} {s.deliverables}</span>
        <ConfMeta>{t('weeklyReview.integrated.confProgress', { p: dim === 'project' ? s.projects_confirmed : s.members_confirmed, total: dim === 'project' ? s.projects_total : s.members_total, defaultValue: `확정 ${dim === 'project' ? s.projects_confirmed : s.members_confirmed}/${dim === 'project' ? s.projects_total : s.members_total}` })}</ConfMeta>
      </SummaryLine>

      <DimTabs role="tablist">
        <DimBtn type="button" role="tab" aria-selected={dim === 'project'} $on={dim === 'project'} onClick={() => setDim('project')}>{t('weeklyReview.integrated.byProject', { defaultValue: '프로젝트별' })} <DimN>{data.projects.length}</DimN></DimBtn>
        <DimBtn type="button" role="tab" aria-selected={dim === 'member'} $on={dim === 'member'} onClick={() => setDim('member')}>{t('weeklyReview.integrated.byMember', { defaultValue: '개인별' })} <DimN>{data.members.length}</DimN></DimBtn>
      </DimTabs>

      {units.length === 0 ? <Muted>{t('weeklyReview.integrated.noUnits', { defaultValue: '대상이 없습니다' })}</Muted> : (
        <Cards>
          {units.map((u: IntegratedUnitView) => {
            const key = `${u.scope}-${u.ref_id}`;
            const open = expanded.has(key);
            const snap = u.snap || {};
            const kpi = snap.kpi || {};
            const h = HEALTH[String(kpi.health)] || null;
            const issueTitles = [...(snap.issues || []).map((i) => i.body), ...(snap.risks || []).map((r) => r.title)].slice(0, 3);
            return (
              <Card key={key}>
                <CardHead>
                  <Bar />
                  <CName onClick={() => { if (u.scope === 'project') navigate(`/projects/p/${u.ref_id}`); }} $link={u.scope === 'project'}>{u.name}</CName>
                  {u.department && <DeptTag>{u.department}</DeptTag>}
                  {u.scope === 'project' && <Pct>{kpi.progress_percent ?? 0}%</Pct>}
                  {h && <HBadge style={{ background: h.bg, color: h.fg }}>{t(`weeklyReview.unit.health.${String(kpi.health)}`, { defaultValue: h.label })}</HBadge>}
                  <UStatus $on={u.confirmed}>{u.confirmed ? (u.finalized_by === 'auto' ? t('weeklyReview.unit.auto', { defaultValue: '자동' }) : t('weeklyReview.integrated.confirmed', { defaultValue: '확정' })) : t('weeklyReview.integrated.pending', { defaultValue: '미확정' })}</UStatus>
                </CardHead>
                {/* 판단 (핵심메시지 + PM/본인 코멘트 한 줄) */}
                {(u.scope === 'project' && snap.strategy?.governing_thought) && <Judge>“{snap.strategy.governing_thought}”{u.narrative && <JNarr> — {u.narrative}</JNarr>}</Judge>}
                {(u.scope === 'member' && u.narrative) && <Judge>{u.narrative}</Judge>}
                {/* 추진과제 한 줄 (프로젝트) */}
                {u.scope === 'project' && (snap.workstreams?.length || 0) > 0 && (
                  <StreamLine>{(snap.workstreams || []).map((w) => <SItem key={w.id}>{w.title} <b>{w.progress_percent}%</b></SItem>)}</StreamLine>
                )}
                {/* 한 줄 수치 */}
                <Mini>{t('weeklyReview.content.done', { defaultValue: '완료' })} {kpi.completed_in_period ?? kpi.completed_tasks ?? 0} · {t('weeklyReview.content.inProgress', { defaultValue: '진행' })} {kpi.in_progress_count ?? 0} · {t('weeklyReview.integrated.overdue', { defaultValue: '지연' })} {kpi.overdue_count ?? 0}</Mini>
                {/* material 이슈 */}
                {issueTitles.length > 0 && <IssueLine>⚠ {issueTitles.join(' · ')}</IssueLine>}
                <ExpandBtn type="button" onClick={() => toggle(key)}>{open ? t('weeklyReview.integrated.collapse', { defaultValue: '접기 ▴' }) : t('weeklyReview.integrated.detail', { defaultValue: '자세히 ▾' })}</ExpandBtn>
                {open && <Detail><ReportContent snap={snap} compact /></Detail>}
              </Card>
            );
          })}
        </Cards>
      )}

      {canManage && (
        <SettingsBox>
          <SetRow><div><SetTitle>{t('weeklyReview.integrated.setIntegrated', { defaultValue: '통합 확정 단계 사용' })}</SetTitle><SetHint>{t('weeklyReview.integrated.setIntegratedHint', { defaultValue: '켜면 대표가 통합본을 한 번 확정합니다.' })}</SetHint></div>
            <Switch type="button" role="switch" aria-checked={data.settings.integrated_confirm} $on={data.settings.integrated_confirm} onClick={() => setSetting('report_integrated_confirm', !data.settings.integrated_confirm)}><Knob $on={data.settings.integrated_confirm} /></Switch></SetRow>
          <SetRow><div><SetTitle>{t('weeklyReview.integrated.setMonthly', { defaultValue: '월간 자동 확정' })}</SetTitle><SetHint>{t('weeklyReview.integrated.setMonthlyHint', { defaultValue: '월 마감 시 미확정 보고서를 자동 확정합니다.' })}</SetHint></div>
            <Switch type="button" role="switch" aria-checked={data.settings.monthly_finalize} $on={data.settings.monthly_finalize} onClick={() => setSetting('monthly_finalize_enabled', !data.settings.monthly_finalize)}><Knob $on={data.settings.monthly_finalize} /></Switch></SetRow>
        </SettingsBox>
      )}
    </Wrap>
  );
};

export default IntegratedReportView;

const Wrap = styled.div`display:flex;flex-direction:column;gap:14px;max-width:1100px;`;
const TopBar = styled.div`display:flex;align-items:center;gap:10px;flex-wrap:wrap;`;
const Nav = styled.div`display:inline-flex;align-items:center;gap:8px;`;
const NavBtn = styled.button`width:28px;height:28px;border:1px solid #E2E8F0;background:#fff;border-radius:6px;font-size:16px;color:#475569;cursor:pointer;&:hover{background:#F0FDFA;border-color:#99F6E4;color:#0F766E;}`;
const PLabel = styled.span`font-size:16px;font-weight:700;color:#0F172A;`;
const Spacer = styled.div`flex:1;`;
const DoneChip = styled.span`font-size:12px;font-weight:700;color:#15803D;background:#DCFCE7;border-radius:999px;padding:3px 10px;`;
const SummaryLine = styled.div`display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:13px;font-weight:600;color:#475569;`;
const Sep = styled.span`color:#CBD5E1;`;
const Danger = styled.span`color:#B91C1C;`;
const ConfMeta = styled.span`margin-left:auto;font-size:12px;color:#94A3B8;`;
const DimTabs = styled.div`display:inline-flex;background:#F1F5F9;padding:3px;border-radius:8px;gap:2px;align-self:flex-start;`;
const DimBtn = styled.button<{ $on: boolean }>`display:inline-flex;align-items:center;gap:6px;padding:6px 16px;border:none;background:${(p) => (p.$on ? '#fff' : 'transparent')};color:${(p) => (p.$on ? '#0F766E' : '#64748B')};border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:${(p) => (p.$on ? '0 1px 2px rgba(0,0,0,.06)' : 'none')};`;
const DimN = styled.span`font-size:10px;font-weight:700;color:#94A3B8;`;
const Cards = styled.div`display:flex;flex-direction:column;gap:10px;`;
const Card = styled.div`background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:14px 16px;`;
const CardHead = styled.div`display:flex;align-items:center;gap:8px;flex-wrap:wrap;`;
const Bar = styled.span`width:4px;height:18px;background:#14B8A6;border-radius:2px;flex-shrink:0;`;
const CName = styled.span<{ $link?: boolean }>`font-size:15px;font-weight:700;color:#0F172A;${(p) => p.$link && 'cursor:pointer;&:hover{color:#0F766E;}'}`;
const DeptTag = styled.span`font-size:10px;font-weight:700;color:#475569;background:#E2E8F0;border-radius:999px;padding:2px 8px;`;
const Pct = styled.span`font-size:13px;font-weight:700;color:#0F172A;`;
const HBadge = styled.span`font-size:10px;font-weight:700;border-radius:999px;padding:2px 8px;`;
const UStatus = styled.span<{ $on: boolean }>`margin-left:auto;font-size:11px;font-weight:700;border-radius:999px;padding:2px 9px;background:${(p) => (p.$on ? '#CCFBF1' : '#FEF9C3')};color:${(p) => (p.$on ? '#0F766E' : '#A16207')};`;
const Judge = styled.div`font-size:13px;font-weight:600;color:#0F766E;margin-top:8px;line-height:1.5;`;
const JNarr = styled.span`font-weight:500;color:#475569;`;
const StreamLine = styled.div`display:flex;gap:12px;flex-wrap:wrap;margin-top:6px;font-size:12px;color:#64748B;& b{color:#0F172A;}`;
const SItem = styled.span``;
const Mini = styled.div`font-size:12px;color:#94A3B8;margin-top:6px;font-weight:600;`;
const IssueLine = styled.div`font-size:12px;color:#92400E;margin-top:6px;line-height:1.5;`;
const ExpandBtn = styled.button`margin-top:8px;padding:4px 10px;background:transparent;border:1px solid #E2E8F0;border-radius:6px;font-size:12px;font-weight:600;color:#0F766E;cursor:pointer;&:hover{background:#F0FDFA;border-color:#99F6E4;}`;
const Detail = styled.div`margin-top:12px;padding-top:12px;border-top:1px solid #F1F5F9;`;
const Muted = styled.div`font-size:13px;color:#94A3B8;padding:20px;text-align:center;`;
const SettingsBox = styled.div`background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:8px 16px;`;
const SetRow = styled.div`display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 0;&:not(:last-child){border-bottom:1px solid #E2E8F0;}`;
const SetTitle = styled.div`font-size:13px;font-weight:700;color:#0F172A;`;
const SetHint = styled.div`font-size:11px;color:#94A3B8;margin-top:2px;`;
const Switch = styled.button<{ $on: boolean }>`width:40px;height:22px;border:none;border-radius:999px;background:${(p) => (p.$on ? '#14B8A6' : '#CBD5E1')};position:relative;cursor:pointer;flex-shrink:0;`;
const Knob = styled.span<{ $on: boolean }>`position:absolute;top:2px;left:${(p) => (p.$on ? '20px' : '2px')};width:18px;height:18px;border-radius:50%;background:#fff;transition:left .15s;box-shadow:0 1px 3px rgba(0,0,0,.2);`;
const Skel = styled.div`display:flex;flex-direction:column;gap:14px;`;
const SkelBar = styled.div`height:20px;background:#F1F5F9;border-radius:8px;`;
const SkelBlock = styled.div`height:120px;background:#F1F5F9;border-radius:12px;`;
const Err = styled.div`display:flex;flex-direction:column;align-items:center;gap:10px;padding:40px;color:#92400E;font-size:14px;`;
const Retry = styled.button`height:34px;padding:0 16px;border:1px solid #E2E8F0;background:#fff;border-radius:8px;font-size:13px;font-weight:600;color:#0F766E;cursor:pointer;&:hover{background:#F0FDFA;}`;
