// ReportUnitView — 단위 보고서 (내용 중심). 나의 보고서 · 프로젝트 보고서 · 개별 보고서 공용.
//   헤더 한 줄(수치 최소) + 코멘트(narrative AutoSave) + ReportContent(실제 업무 내용) + 확정/되돌리기.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import ActionButton from '../Common/ActionButton';
import AutoSaveField from '../Common/AutoSaveField';
import ReportContent from './report/ReportContent';
import { joinRoom, leaveRoom, onSocket } from '../../services/socket';
import {
  getReportUnit, patchReportUnit, confirmReportUnit, reopenReportUnit, generateReportNarrative, periodStartOf, shiftPeriod,
  type ReportScope, type ReportPeriodType, type ReportUnitData,
} from '../../services/reportUnit';

interface Props { businessId: number; scope: ReportScope; refId: number; periodType: ReportPeriodType; }

const ReportUnitView: React.FC<Props> = ({ businessId, scope, refId, periodType }) => {
  const { t, i18n } = useTranslation('qtask');
  const [periodStart, setPeriodStart] = useState(() => periodStartOf(periodType));
  useEffect(() => { setPeriodStart(periodStartOf(periodType)); }, [periodType]);
  const [data, setData] = useState<ReportUnitData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [genErr, setGenErr] = useState(false);
  const [narrativeKey, setNarrativeKey] = useState(0);
  const narrativeRef = useRef('');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try { const d = await getReportUnit(businessId, { scope, ref_id: refId, period_type: periodType, period_start: periodStart }); setData(d); narrativeRef.current = d.narrative || ''; }
    catch { setData(null); } finally { setLoading(false); }
  }, [businessId, scope, refId, periodType, periodStart]);
  useEffect(() => { load(); }, [load]);

  const loadRef = useRef(load); loadRef.current = load;
  useEffect(() => {
    let pend: ReturnType<typeof setTimeout> | null = null;
    const onEvt = (p: { scope?: string; ref_id?: number }) => { if (p && (p.scope !== scope || Number(p.ref_id) !== Number(refId))) return; if (pend) clearTimeout(pend); pend = setTimeout(() => loadRef.current(true), 300); };
    joinRoom(`business:${Number(businessId)}`);
    const offReport = onSocket<{ scope?: string; ref_id?: number }>('report:updated', onEvt);
    return () => { if (pend) clearTimeout(pend); leaveRoom(`business:${Number(businessId)}`); offReport(); };
  }, [businessId, scope, refId]);

  const saveNarrative = useCallback(async () => { if (!data) return; setData(await patchReportUnit(businessId, data.id, { narrative: narrativeRef.current })); }, [businessId, data]);
  // #85 — SCR(상황·문제·해결) AI 초안 생성 → narrative 채움 + 저장. 사용자가 자유 편집 가능.
  const doGenerate = async () => {
    if (!data || genBusy) return;
    setGenBusy(true); setGenErr(false);
    try {
      const lang = (i18n.language || '').startsWith('en') ? 'en' : 'ko';
      const out = await generateReportNarrative(businessId, data.id, lang);
      if (out?.narrative) {
        narrativeRef.current = out.narrative;
        setData(await patchReportUnit(businessId, data.id, { narrative: out.narrative }));
        setNarrativeKey((k) => k + 1);
      }
    } catch { setGenErr(true); } finally { setGenBusy(false); }
  };
  const doConfirm = async () => { if (!data || busy) return; setBusy(true); try { setData(await confirmReportUnit(businessId, data.id)); } catch { /* */ } finally { setBusy(false); } };
  const doReopen = async () => { if (!data || busy) return; setBusy(true); try { setData(await reopenReportUnit(businessId, data.id)); } catch { /* */ } finally { setBusy(false); } };

  const periodLabel = (() => {
    const p = data?.snapshot?.period; if (!p) return periodStart;
    if (periodType === 'monthly') { const [y, m] = String(p.start).split('-'); return t('weeklyReview.integrated.monthLabelY', { y, m: Number(m), defaultValue: `${y}년 ${Number(m)}월` }); }
    return `${String(p.start).slice(5).replace('-', '/')} ~ ${String(p.end).slice(5).replace('-', '/')}`;
  })();

  if (loading) return <Skel><SkelBar style={{ width: '35%' }} /><SkelBlock /></Skel>;
  if (!data) return <Err>{t('weeklyReview.unit.loadError', { defaultValue: '보고서를 불러오지 못했습니다' })}<Retry onClick={() => load()}>{t('weeklyReview.unit.retry', { defaultValue: '다시 시도' })}</Retry></Err>;

  const snap = data.snapshot || {};
  const kpi = snap.kpi || {};
  const confirmed = data.status === 'confirmed';
  const name = (snap.subject?.name as string) || '';

  return (
    <Wrap>
      <Nav>
        <NavBtn type="button" aria-label={t('weeklyReview.unit.prev', { defaultValue: '이전' }) as string} onClick={() => setPeriodStart((s) => shiftPeriod(periodType, s, -1))}>‹</NavBtn>
        <PLabel>{periodLabel}</PLabel>
        <NavBtn type="button" aria-label={t('weeklyReview.unit.next', { defaultValue: '다음' }) as string} onClick={() => setPeriodStart((s) => shiftPeriod(periodType, s, 1))}>›</NavBtn>
        <Spacer />
        <StatusChip $on={confirmed}>{confirmed ? (data.finalized_by === 'auto' ? t('weeklyReview.integrated.autoConfirmed', { defaultValue: '자동 확정' }) : t('weeklyReview.unit.confirmed', { defaultValue: '확정됨' })) : t('weeklyReview.unit.draft', { defaultValue: '작성 중' })}</StatusChip>
        {data.can_edit && (confirmed
          ? <ActionButton tone="secondary" size="sm" loading={busy} onClick={doReopen}>{t('weeklyReview.unit.reopen', { defaultValue: '되돌리기' })}</ActionButton>
          : <ActionButton tone="primary" size="sm" loading={busy} onClick={doConfirm}>{t('weeklyReview.unit.confirm', { defaultValue: '확정하기' })}</ActionButton>)}
      </Nav>

      <Head>
        <HName>{name}{snap.subject?.department && <DeptTag>{snap.subject.department}</DeptTag>}</HName>
        <OneLine>
          {scope === 'project' && <span>{t('weeklyReview.unit.kpi.progress', { defaultValue: '진행' })} {kpi.progress_percent ?? 0}%</span>}
          <span>{t('weeklyReview.content.done', { defaultValue: '완료' })} {kpi.completed_in_period ?? kpi.completed_tasks ?? 0}</span>
          <span>{t('weeklyReview.content.inProgress', { defaultValue: '진행' })} {kpi.in_progress_count ?? 0}</span>
          <span>{t('weeklyReview.integrated.overdue', { defaultValue: '지연' })} {kpi.overdue_count ?? 0}</span>
          {scope === 'project' && <span>{t('weeklyReview.content.issues', { defaultValue: '이슈' })} {kpi.open_issues ?? 0}</span>}
        </OneLine>
      </Head>

      {/* 코멘트 */}
      <Section>
        <SecTitle>
          {scope === 'project' ? t('weeklyReview.unit.pmComment', { defaultValue: 'PM 업무보고' }) : t('weeklyReview.unit.myComment', { defaultValue: '내 코멘트' })}
          {confirmed && <Lock>{t('weeklyReview.unit.locked', { defaultValue: '확정됨 — 되돌려야 수정' })}</Lock>}
          {data.can_edit && !confirmed && (
            <GenBtn type="button" onClick={doGenerate} disabled={genBusy} title={t('weeklyReview.unit.genScrTitle', { defaultValue: '보고 데이터로 상황·문제·해결(SCR) 구조 요약을 자동 작성합니다' }) as string}>
              {genBusy ? t('weeklyReview.unit.genScrLoading', { defaultValue: 'AI 작성 중…' }) : t('weeklyReview.unit.genScr', { defaultValue: '✨ AI 요약 생성 (SCR)' })}
            </GenBtn>
          )}
        </SecTitle>
        {genErr && <GenErr role="alert">{t('weeklyReview.unit.genScrErr', { defaultValue: 'AI 요약 생성에 실패했습니다. 잠시 후 다시 시도해주세요.' })}</GenErr>}
        {data.can_edit && !confirmed ? (
          <AutoSaveField onSave={saveNarrative} type="input">
            <Area key={narrativeKey} defaultValue={data.narrative} placeholder={t('weeklyReview.unit.narrativePh', { defaultValue: '이번 기간 진행·판단·주요 메모를 적어주세요 (자동 저장)' }) as string} onChange={(e) => { narrativeRef.current = e.target.value; }} />
          </AutoSaveField>
        ) : (data.narrative ? <Read>{data.narrative}</Read> : <Muted>{t('weeklyReview.unit.noNarrative', { defaultValue: '작성된 코멘트가 없습니다' })}</Muted>)}
      </Section>

      {/* 실제 업무 내용 */}
      <ReportContent snap={snap} />
    </Wrap>
  );
};

export default ReportUnitView;

const Wrap = styled.div`display:flex;flex-direction:column;gap:14px;max-width:1100px;`;
const Nav = styled.div`display:flex;align-items:center;gap:10px;flex-wrap:wrap;`;
const NavBtn = styled.button`width:28px;height:28px;border:1px solid #E2E8F0;background:#fff;border-radius:6px;font-size:16px;color:#475569;cursor:pointer;&:hover{background:#F0FDFA;border-color:#99F6E4;color:#0F766E;}`;
const PLabel = styled.span`font-size:13px;font-weight:700;color:#0F172A;min-width:120px;text-align:center;`;
const Spacer = styled.div`flex:1;`;
const StatusChip = styled.span<{ $on: boolean }>`font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px;background:${(p) => (p.$on ? '#14B8A6' : '#E2E8F0')};color:${(p) => (p.$on ? '#fff' : '#475569')};`;
const Head = styled.div`display:flex;flex-direction:column;gap:4px;padding-bottom:10px;border-bottom:1px solid #F1F5F9;`;
const HName = styled.h2`font-size:18px;font-weight:700;color:#0F172A;margin:0;display:flex;align-items:center;gap:8px;`;
const DeptTag = styled.span`font-size:11px;font-weight:700;color:#475569;background:#E2E8F0;border-radius:999px;padding:2px 9px;`;
const OneLine = styled.div`display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:#64748B;font-weight:600;`;
const Section = styled.div`background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:14px 16px;`;
const SecTitle = styled.div`font-size:13px;font-weight:700;color:#0F172A;margin-bottom:8px;display:flex;align-items:center;gap:8px;`;
const Lock = styled.span`font-size:10px;font-weight:600;color:#A16207;background:#FEF9C3;border-radius:999px;padding:2px 8px;`;
const GenBtn = styled.button`margin-left:auto;font-size:12px;font-weight:600;color:#0F766E;background:#F0FDFA;border:1px solid #99F6E4;border-radius:8px;padding:5px 10px;cursor:pointer;transition:background .15s,border-color .15s;&:hover:not(:disabled){background:#CCFBF1;border-color:#5EEAD4;}&:disabled{opacity:.6;cursor:default;}`;
const GenErr = styled.div`font-size:12px;color:#EF4444;margin-bottom:8px;`;
const Area = styled.textarea`width:100%;min-height:80px;resize:vertical;border:1px solid #E2E8F0;border-radius:10px;padding:10px 12px;font-size:13px;line-height:1.6;color:#334155;font-family:inherit;&:focus{outline:none;border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,.15);}&::placeholder{color:#94A3B8;}`;
const Read = styled.div`font-size:13px;line-height:1.6;color:#334155;white-space:pre-wrap;`;
const Muted = styled.div`font-size:13px;color:#94A3B8;`;
const Skel = styled.div`display:flex;flex-direction:column;gap:14px;`;
const SkelBar = styled.div`height:20px;background:#F1F5F9;border-radius:8px;`;
const SkelBlock = styled.div`height:120px;background:#F1F5F9;border-radius:12px;`;
const Err = styled.div`display:flex;flex-direction:column;align-items:center;gap:10px;padding:40px;color:#92400E;font-size:14px;`;
const Retry = styled.button`height:34px;padding:0 16px;border:1px solid #E2E8F0;background:#fff;border-radius:8px;font-size:13px;font-weight:600;color:#0F766E;cursor:pointer;&:hover{background:#F0FDFA;}`;
