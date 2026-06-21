// ReportsList — 프로젝트별 / 개별 보고서. TeamTab 리스트 패턴 재사용.
//   기간 필터(이동) + 리스트(테이블) + 행 클릭 → DetailDrawer 안에 전체 보고서(ReportContent).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import DetailDrawer from '../Common/DetailDrawer';
import ActionButton from '../Common/ActionButton';
import ReportContent from './report/ReportContent';
import {
  TableWrap, Table, Tr, Th, Td, ChartCard, ChartEmpty,
} from '../../pages/Insights/components';
import {
  getIntegrated, periodStartOf, shiftPeriod,
  type ReportPeriodType, type IntegratedRollup, type IntegratedUnitView,
} from '../../services/reportUnit';

interface Props { businessId: number; periodType: ReportPeriodType; dim: 'project' | 'member'; }

const HEALTH: Record<string, { bg: string; fg: string; label: string }> = {
  green: { bg: '#DCFCE7', fg: '#15803D', label: '순항' }, yellow: { bg: '#FEF9C3', fg: '#A16207', label: '주의' }, red: { bg: '#FEE2E2', fg: '#B91C1C', label: '위험' },
};

const ReportsList: React.FC<Props> = ({ businessId, periodType, dim }) => {
  const { t } = useTranslation('qtask');
  const navigate = useNavigate();
  const [periodStart, setPeriodStart] = useState(() => periodStartOf(periodType));
  useEffect(() => { setPeriodStart(periodStartOf(periodType)); }, [periodType]);
  const [data, setData] = useState<IntegratedRollup | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<IntegratedUnitView | null>(null);

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

  const label = (() => {
    const [y, m, d] = periodStart.split('-').map(Number);
    if (periodType === 'monthly') return t('weeklyReview.integrated.monthLabelY', { y, m, defaultValue: `${y}년 ${m}월` });
    return t('weeklyReview.integrated.weekLabel', { m, w: Math.ceil(d / 7), defaultValue: `${m}월 ${Math.ceil(d / 7)}주차` });
  })();

  const units = data ? (dim === 'project' ? data.projects : data.members) : [];
  const isProject = dim === 'project';
  const onRow = (u: IntegratedUnitView) => { if (selected && selected.ref_id === u.ref_id) { setSelected(null); return; } setSelected(u); };

  return (
    <Wrap>
      <FilterBar>
        <NavBtn type="button" aria-label={t('weeklyReview.unit.prev', { defaultValue: '이전' }) as string} onClick={() => setPeriodStart((x) => shiftPeriod(periodType, x, -1))}>‹</NavBtn>
        <PeriodText>{label}</PeriodText>
        <NavBtn type="button" aria-label={t('weeklyReview.unit.next', { defaultValue: '다음' }) as string} onClick={() => setPeriodStart((x) => shiftPeriod(periodType, x, 1))}>›</NavBtn>
        <ThisBtn type="button" onClick={() => setPeriodStart(periodStartOf(periodType))}>{t('weeklyReview.integrated.thisPeriod', { defaultValue: '이번 기간' })}</ThisBtn>
      </FilterBar>

      {loading ? <ChartCard><ChartEmpty>{t('common.loading', { defaultValue: '불러오는 중…' })}</ChartEmpty></ChartCard>
        : units.length === 0 ? <ChartCard><ChartEmpty>{isProject ? t('weeklyReview.integrated.noProjects', { defaultValue: '이 기간에 보고할 프로젝트가 없습니다.' }) : t('weeklyReview.integrated.noMembers', { defaultValue: '이 기간에 보고할 멤버가 없습니다.' })}</ChartEmpty></ChartCard>
        : (
          <TableWrap>
            <Table>
              <thead>
                <Tr>
                  <Th>{isProject ? t('weeklyReview.list.project', { defaultValue: '프로젝트' }) : t('weeklyReview.list.member', { defaultValue: '멤버' })}</Th>
                  {isProject && <Th $num>{t('weeklyReview.list.progress', { defaultValue: '진행률' })}</Th>}
                  <Th $num>{t('weeklyReview.content.done', { defaultValue: '완료' })}</Th>
                  <Th $num>{t('weeklyReview.content.inProgress', { defaultValue: '진행' })}</Th>
                  <Th $num>{t('weeklyReview.integrated.overdue', { defaultValue: '지연' })}</Th>
                  {isProject && <Th $num>{t('weeklyReview.content.issues', { defaultValue: '이슈' })}</Th>}
                  <Th>{t('weeklyReview.list.status', { defaultValue: '상태' })}</Th>
                </Tr>
              </thead>
              <tbody>
                {units.map((u) => {
                  const kpi = u.snap?.kpi || {};
                  const h = HEALTH[String(kpi.health)] || null;
                  return (
                    <ClickTr key={`${u.scope}-${u.ref_id}`} onClick={() => onRow(u)} $active={selected?.ref_id === u.ref_id}>
                      <Td>
                        <RowName>{u.name}</RowName>
                        {u.department && <RowSub>{u.department}</RowSub>}
                        {isProject && h && <RowDot style={{ background: h.fg }} title={h.label} />}
                      </Td>
                      {isProject && <Td $num>{kpi.progress_percent ?? 0}%</Td>}
                      <Td $num>{kpi.completed_in_period ?? kpi.completed_tasks ?? 0}</Td>
                      <Td $num>{kpi.in_progress_count ?? 0}</Td>
                      <Td $num style={{ color: (kpi.overdue_count ?? 0) > 0 ? '#B91C1C' : undefined }}>{kpi.overdue_count ?? 0}</Td>
                      {isProject && <Td $num>{kpi.open_issues ?? 0}</Td>}
                      <Td><UStatus $on={u.confirmed}>{u.confirmed ? (u.finalized_by === 'auto' ? t('weeklyReview.unit.auto', { defaultValue: '자동확정' }) : t('weeklyReview.integrated.confirmed', { defaultValue: '확정' })) : t('weeklyReview.integrated.pending', { defaultValue: '작성 중' })}</UStatus></Td>
                    </ClickTr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        )}

      <DetailDrawer open={!!selected} onClose={() => setSelected(null)} width={560} ariaLabel={selected?.name || ''}>
        <DetailDrawer.Header onClose={() => setSelected(null)}>
          <DrawerTitle>{selected?.name}</DrawerTitle>
          <DrawerSub>{label}{selected?.department && ` · ${selected.department}`}{selected?.confirmed && ` · ${t('weeklyReview.integrated.confirmed', { defaultValue: '확정' })}`}</DrawerSub>
        </DetailDrawer.Header>
        <DetailDrawer.Body>
          {selected && (
            <>
              {selected.narrative && (
                <Commentary>
                  <ComLabel>{isProject ? t('weeklyReview.unit.pmComment', { defaultValue: 'PM 업무보고' }) : t('weeklyReview.unit.myComment', { defaultValue: '담당 코멘트' })}</ComLabel>
                  <ComBody>{selected.narrative}</ComBody>
                </Commentary>
              )}
              <ReportContent snap={selected.snap || {}} compact />
            </>
          )}
        </DetailDrawer.Body>
        {isProject && selected && (
          <DetailDrawer.Footer>
            <ActionButton tone="secondary" size="md" onClick={() => navigate(`/projects/p/${selected.ref_id}?tab=report`)}>{t('weeklyReview.list.openProject', { defaultValue: '프로젝트 보고서 열기' })}</ActionButton>
          </DetailDrawer.Footer>
        )}
      </DetailDrawer>
    </Wrap>
  );
};

export default ReportsList;

const Wrap = styled.div`display:flex;flex-direction:column;gap:14px;`;
const FilterBar = styled.div`display:flex;align-items:center;gap:8px;flex-wrap:wrap;`;
const NavBtn = styled.button`width:30px;height:30px;border:1px solid #E2E8F0;background:#fff;border-radius:8px;font-size:16px;color:#475569;cursor:pointer;&:hover{background:#F0FDFA;border-color:#99F6E4;color:#0F766E;}`;
const PeriodText = styled.span`font-size:14px;font-weight:700;color:#0F172A;min-width:104px;text-align:center;`;
const ThisBtn = styled.button`height:30px;padding:0 12px;border:1px solid #E2E8F0;background:#fff;border-radius:8px;font-size:12px;font-weight:600;color:#475569;cursor:pointer;&:hover{background:#F0FDFA;border-color:#99F6E4;color:#0F766E;}`;
const ClickTr = styled(Tr)<{ $active?: boolean }>`cursor:pointer;background:${(p) => (p.$active ? '#F0FDFA' : 'transparent')};transition:background .15s;&:hover{background:${(p) => (p.$active ? '#CCFBF1' : '#F8FAFC')};}`;
const RowName = styled.span`font-weight:700;color:#0F172A;`;
const RowSub = styled.span`margin-left:8px;font-size:11px;font-weight:700;color:#475569;background:#E2E8F0;border-radius:999px;padding:1px 8px;`;
const RowDot = styled.span`display:inline-block;width:8px;height:8px;border-radius:50%;margin-left:8px;vertical-align:middle;`;
const UStatus = styled.span<{ $on: boolean }>`font-size:11px;font-weight:700;border-radius:999px;padding:2px 9px;background:${(p) => (p.$on ? '#CCFBF1' : '#FEF9C3')};color:${(p) => (p.$on ? '#0F766E' : '#A16207')};`;
const DrawerTitle = styled.div`font-size:16px;font-weight:700;color:#0F172A;`;
const DrawerSub = styled.div`font-size:12px;color:#64748B;margin-top:2px;`;
const Commentary = styled.div`margin-bottom:14px;padding:12px 14px;background:#F8FAFC;border-left:3px solid #14B8A6;border-radius:0 8px 8px 0;`;
const ComLabel = styled.div`font-size:11px;font-weight:800;color:#0F766E;letter-spacing:.03em;margin-bottom:4px;`;
const ComBody = styled.p`font-size:14px;line-height:1.7;color:#334155;white-space:pre-wrap;margin:0;`;
