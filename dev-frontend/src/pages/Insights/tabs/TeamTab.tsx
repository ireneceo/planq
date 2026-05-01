import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { fetchTab, type RangePreset } from '../../../services/insights';
import {
  InsightRow, InsightCard, InsightStripe, InsightBody, InsightTitle, InsightValue, InsightHint, InsightAction,
  KpiGrid, KpiCard, KpiLabel, KpiValueBig,
  SectionLabel, SectionRow, DownloadBtn, DownloadIcon, ChartCard, ChartEmpty,
  TableWrap, Table, Tr, Th, Td,
  SkeletonGrid, SkeletonCard, ErrorBanner,
  fmtKRW, fmtNum, fmtPct,
} from '../components';
import { downloadRowsAsCsv } from '../csvUtils';
import DetailDrawer from '../../../components/Common/DetailDrawer';

interface CategoryRow {
  category: string;
  count: number;
  hours: number;
  accuracy_pct: number | null;
  bias_pct: number | null;
  avg_leadtime_days: number | null;
}
interface Row {
  user_id: number; name: string; role: string;
  utilization_pct: number | null; accuracy_pct: number | null; bias_pct: number | null;
  completed_tasks: number; avg_leadtime_days: number | null;
  revenue_share: number; effective_rate: number | null; actual_hours: number;
  categories?: CategoryRow[];
}
interface Data {
  period: { from: string; to: string; label: string };
  kpis: Record<string, { value: number | null }>;
  util_buckets: { under60: number; normal: number; over90: number; over100: number };
  table: Row[];
  insights: { severity: string; title: string; value: string; hint?: string; action_label?: string; action_link?: string }[];
}

const TeamTab: React.FC<{ businessId: number; range: RangePreset }> = ({ businessId, range }) => {
  const { t } = useTranslation('insights');
  const navigate = useNavigate();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Row | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchTab<Data>(businessId, 'team', range)
      .then((d) => { setData(d); setErr(null); })
      .catch((e) => setErr(e?.message || 'failed'))
      .finally(() => setLoading(false));
  }, [businessId, range]);

  if (err) return <ErrorBanner>{t('error.summary')} — {err}</ErrorBanner>;
  if (loading || !data) return <SkeletonGrid>{[0,1,2,3,4,5].map((i) => <SkeletonCard key={i} />)}</SkeletonGrid>;

  const utilBars = data.table
    .filter((r) => r.utilization_pct != null)
    .sort((a, b) => (b.utilization_pct || 0) - (a.utilization_pct || 0))
    .slice(0, 12);

  const handleRowClick = (row: Row) => {
    if (selected && selected.user_id === row.user_id) { setSelected(null); return; }
    setSelected(row);
  };

  return (
    <>
      <InsightRow>
        {data.insights.map((ins, i) => (
          <InsightCard key={i} $severity={ins.severity} $clickable={!!ins.action_link}
            onClick={() => ins.action_link && navigate(ins.action_link)}>
            <InsightStripe $severity={ins.severity} />
            <InsightBody>
              <InsightTitle>{ins.title}</InsightTitle>
              <InsightValue>{ins.value}</InsightValue>
              {ins.hint && <InsightHint>{ins.hint}</InsightHint>}
              {ins.action_label && <InsightAction>{ins.action_label} →</InsightAction>}
            </InsightBody>
          </InsightCard>
        ))}
      </InsightRow>

      <KpiGrid>
        <KpiCard><KpiLabel>{t('team.kpi.members', '활성 멤버')}</KpiLabel><KpiValueBig>{fmtNum(data.kpis.members.value)}</KpiValueBig></KpiCard>
        <KpiCard><KpiLabel>{t('team.kpi.avgUtil', '팀 평균 가동률')}</KpiLabel><KpiValueBig>{fmtPct(data.kpis.avg_utilization.value)}</KpiValueBig></KpiCard>
        <KpiCard><KpiLabel>{t('team.kpi.topRevenue', '인당 매출 1위')}</KpiLabel><KpiValueBig>{fmtKRW(data.kpis.top_revenue.value)}</KpiValueBig></KpiCard>
        <KpiCard><KpiLabel>{t('team.kpi.topAccuracy', '정확도 1위')}</KpiLabel><KpiValueBig>{fmtPct(data.kpis.top_accuracy.value)}</KpiValueBig></KpiCard>
        <KpiCard><KpiLabel>{t('team.kpi.overUtil', '가동률 초과')}</KpiLabel><KpiValueBig>{fmtNum(data.kpis.over_util_count.value)}</KpiValueBig></KpiCard>
        <KpiCard><KpiLabel>{t('team.kpi.totalCompleted', '완료 업무 합계')}</KpiLabel><KpiValueBig>{fmtNum(data.kpis.total_completed.value)}</KpiValueBig></KpiCard>
      </KpiGrid>

      <SectionLabel>{t('team.chart.utilization.title', '직원별 가동률')}</SectionLabel>
      <ChartCard>
        {utilBars.length === 0 ? (
          <ChartEmpty>{t('team.chart.utilization.empty', '직원별 시간 데이터가 누적되면 표시됩니다')}</ChartEmpty>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={utilBars} margin={{ top: 16, right: 24, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748B' }} />
              <YAxis tick={{ fontSize: 11, fill: '#64748B' }} unit="%" />
              <Tooltip />
              <ReferenceLine y={100} stroke="#EF4444" strokeDasharray="4 4" label={{ value: '100%', position: 'right', fill: '#EF4444', fontSize: 11 }} />
              <Bar dataKey="utilization_pct" name={t('team.chart.utilization.bar', '가동률') as string} fill="#14B8A6" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <SectionRow style={{ marginTop: 24 }}>
        <SectionLabel>{t('team.table.title', '직원 순위')}</SectionLabel>
        <DownloadBtn type="button" disabled={data.table.length === 0}
          onClick={() => downloadRowsAsCsv(`team_${data.period.from}_${data.period.to}.csv`, data.table, [
            { key: 'name', header: t('team.col.name', '이름') as string },
            { key: 'role', header: t('team.col.role', '역할') as string },
            { key: 'utilization_pct', header: t('team.col.utilization', '가동률') as string },
            { key: 'accuracy_pct', header: t('team.col.accuracy', '정확도') as string },
            { key: 'bias_pct', header: t('team.col.bias', 'Bias') as string },
            { key: 'completed_tasks', header: t('team.col.completed', '완료') as string },
            { key: 'avg_leadtime_days', header: t('team.col.leadtime', '리드타임(일)') as string },
            { key: 'revenue_share', header: t('team.col.revenue', '매출 비중') as string },
            { key: 'effective_rate', header: t('team.col.effectiveRate', '시간당 매출') as string },
            { key: 'actual_hours', header: t('team.col.actualHours', '실제 시간(h)') as string },
          ])}>
          <DownloadIcon /> {t('download.csv', 'CSV (Excel)')}
        </DownloadBtn>
      </SectionRow>
      {data.table.length === 0 ? (
        <ChartCard><ChartEmpty>{t('team.table.empty', '활성 멤버가 없습니다')}</ChartEmpty></ChartCard>
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <Tr>
                <Th>{t('team.col.name', '이름')}</Th>
                <Th>{t('team.col.role', '역할')}</Th>
                <Th $num>{t('team.col.utilization', '가동률')}</Th>
                <Th $num>{t('team.col.accuracy', '정확도')}</Th>
                <Th $num>{t('team.col.bias', 'Bias')}</Th>
                <Th $num>{t('team.col.completed', '완료')}</Th>
                <Th $num>{t('team.col.leadtime', '리드타임')}</Th>
                <Th $num>{t('team.col.revenue', '매출 비중')}</Th>
                <Th $num>{t('team.col.effectiveRate', '시간당 매출')}</Th>
              </Tr>
            </thead>
            <tbody>
              {data.table.map((r) => (
                <ClickableTr key={r.user_id} onClick={() => handleRowClick(r)} $active={selected?.user_id === r.user_id}>
                  <Td>{r.name}</Td>
                  <Td>{r.role}</Td>
                  <Td $num style={{ color: (r.utilization_pct || 0) > 100 ? '#B91C1C' : '#0F172A' }}>{fmtPct(r.utilization_pct)}</Td>
                  <Td $num>{fmtPct(r.accuracy_pct)}</Td>
                  <Td $num>{fmtPct(r.bias_pct, { signed: true })}</Td>
                  <Td $num>{fmtNum(r.completed_tasks)}</Td>
                  <Td $num>{r.avg_leadtime_days == null ? '—' : `${r.avg_leadtime_days}d`}</Td>
                  <Td $num>{fmtKRW(r.revenue_share)}</Td>
                  <Td $num>{r.effective_rate == null ? '—' : `${fmtKRW(r.effective_rate)}/h`}</Td>
                </ClickableTr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}

      <DetailDrawer
        open={!!selected}
        onClose={() => setSelected(null)}
        width={460}
        ariaLabel={t('team.drawer.title', '직원 카테고리 분석') as string}
      >
        <DetailDrawer.Header onClose={() => setSelected(null)}>
          <DrawerTitle>{selected?.name}</DrawerTitle>
          <DrawerSub>{selected?.role} · {fmtNum(selected?.completed_tasks)} {t('team.drawer.completedSuffix', '완료')}</DrawerSub>
        </DetailDrawer.Header>
        <DetailDrawer.Body>
          <DrawerSectionLabel>{t('team.drawer.summary', '요약')}</DrawerSectionLabel>
          <SummaryGrid>
            <SummaryCell>
              <SummaryLabel>{t('team.col.utilization', '가동률')}</SummaryLabel>
              <SummaryValue>{fmtPct(selected?.utilization_pct ?? null)}</SummaryValue>
            </SummaryCell>
            <SummaryCell>
              <SummaryLabel>{t('team.col.accuracy', '정확도')}</SummaryLabel>
              <SummaryValue>{fmtPct(selected?.accuracy_pct ?? null)}</SummaryValue>
            </SummaryCell>
            <SummaryCell>
              <SummaryLabel>{t('team.col.bias', 'Bias')}</SummaryLabel>
              <SummaryValue>{selected?.bias_pct == null ? '—' : fmtPct(selected.bias_pct, { signed: true })}</SummaryValue>
            </SummaryCell>
            <SummaryCell>
              <SummaryLabel>{t('team.col.leadtime', '리드타임')}</SummaryLabel>
              <SummaryValue>{selected?.avg_leadtime_days == null ? '—' : `${selected.avg_leadtime_days}d`}</SummaryValue>
            </SummaryCell>
          </SummaryGrid>

          <DrawerSectionLabel style={{ marginTop: 18 }}>
            {t('team.drawer.categoryTitle', '카테고리별 강점·약점')}
          </DrawerSectionLabel>
          {(!selected?.categories || selected.categories.length === 0) ? (
            <DrawerEmpty>{t('team.drawer.empty', '이 멤버의 분석할 업무가 누적되지 않았습니다.')}</DrawerEmpty>
          ) : (
            <CatTable>
              <thead>
                <tr>
                  <th>{t('team.drawer.col.category', '카테고리')}</th>
                  <th className="num">{t('team.drawer.col.count', '건수')}</th>
                  <th className="num">{t('team.drawer.col.accuracy', '정확도')}</th>
                  <th className="num">{t('team.drawer.col.hours', '시간(h)')}</th>
                  <th>{t('team.drawer.col.tag', '태그')}</th>
                </tr>
              </thead>
              <tbody>
                {selected.categories.map((c) => {
                  const isStrong = c.accuracy_pct != null && c.accuracy_pct >= 80 && c.count >= 2;
                  const isWeak = c.accuracy_pct != null && c.accuracy_pct < 50 && c.count >= 2;
                  return (
                    <tr key={c.category}>
                      <td>{c.category}</td>
                      <td className="num">{c.count}</td>
                      <td className="num">{fmtPct(c.accuracy_pct)}</td>
                      <td className="num">{c.hours}</td>
                      <td>
                        {isStrong && <Tag $kind="strength">{t('team.tag.strength', '강점')}</Tag>}
                        {isWeak && <Tag $kind="weakness">{t('team.tag.weakness', '약점')}</Tag>}
                        {!isStrong && !isWeak && <Tag $kind="neutral">{t('team.tag.neutral', '보통')}</Tag>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </CatTable>
          )}
        </DetailDrawer.Body>
      </DetailDrawer>
    </>
  );
};

export default TeamTab;

const ClickableTr = styled(Tr)<{ $active?: boolean }>`
  cursor: pointer;
  background: ${(p) => p.$active ? '#F0FDFA' : 'transparent'};
  transition: background 0.15s;
  &:hover { background: ${(p) => p.$active ? '#CCFBF1' : '#F8FAFC'}; }
`;
const DrawerTitle = styled.div`font-size: 16px; font-weight: 700; color: #0F172A;`;
const DrawerSub = styled.div`font-size: 12px; color: #64748B; margin-top: 2px;`;
const DrawerSectionLabel = styled.div`
  font-size: 11px; font-weight: 700; color: #475569;
  text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 8px;
`;
const SummaryGrid = styled.div`
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;
`;
const SummaryCell = styled.div`
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;
  padding: 10px 12px; display: flex; flex-direction: column; gap: 2px;
`;
const SummaryLabel = styled.div`font-size: 10px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.3px;`;
const SummaryValue = styled.div`font-size: 14px; font-weight: 700; color: #0F172A; font-variant-numeric: tabular-nums;`;
const DrawerEmpty = styled.div`
  background: #F8FAFC; border: 1px dashed #CBD5E1; border-radius: 8px;
  padding: 24px 16px; text-align: center; font-size: 12px; color: #94A3B8;
`;
const CatTable = styled.table`
  width: 100%; border-collapse: collapse; font-size: 12px;
  th, td { padding: 8px; border-bottom: 1px solid #F1F5F9; text-align: left; }
  th { background: #F8FAFC; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.3px; font-size: 10px; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
`;
const Tag = styled.span<{ $kind: 'strength' | 'weakness' | 'neutral' }>`
  display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 700;
  background: ${(p) => p.$kind === 'strength' ? '#DCFCE7' : p.$kind === 'weakness' ? '#FEE2E2' : '#F1F5F9'};
  color: ${(p) => p.$kind === 'strength' ? '#15803D' : p.$kind === 'weakness' ? '#B91C1C' : '#64748B'};
`;
