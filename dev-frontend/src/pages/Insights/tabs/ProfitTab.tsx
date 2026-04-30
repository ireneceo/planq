import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { fetchTab, type RangePreset } from '../../../services/insights';
import {
  InsightRow, InsightCard, InsightStripe, InsightBody, InsightTitle, InsightValue, InsightHint, InsightAction,
  KpiGrid, KpiCard, KpiLabel, KpiValueBig,
  SectionLabel, SectionRow, DownloadBtn, DownloadIcon, ChartCard, ChartEmpty,
  TableWrap, Table, Tr, Th, Td,
  SkeletonGrid, SkeletonCard, ErrorBanner,
  fmtKRW, fmtNum,
} from '../components';
import { downloadRowsAsCsv } from '../csvUtils';

interface Row {
  project_id: number; name: string; client: string; status: string;
  revenue: number; labor_cost: number; direct_cost: number; profit: number;
  margin_pct: number | null; hours: number; est_hours: number; profit_per_hour: number | null;
}
interface Data {
  period: { from: string; to: string; label: string };
  kpis: Record<string, { value: number | null }>;
  bubble: { project_id: number; name: string; hours: number; revenue: number; profit: number; margin_pct: number | null }[];
  table: Row[];
  insights: { severity: string; title: string; value: string; hint?: string; action_label?: string; action_link?: string }[];
}

const ProfitTab: React.FC<{ businessId: number; range: RangePreset }> = ({ businessId, range }) => {
  const { t } = useTranslation('insights');
  const navigate = useNavigate();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchTab<Data>(businessId, 'profit', range)
      .then((d) => { setData(d); setErr(null); })
      .catch((e) => setErr(e?.message || 'failed'))
      .finally(() => setLoading(false));
  }, [businessId, range]);

  if (err) return <ErrorBanner>{t('error.summary')} — {err}</ErrorBanner>;
  if (loading || !data) return <SkeletonGrid>{[0,1,2,3,4,5].map((i) => <SkeletonCard key={i} />)}</SkeletonGrid>;

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
        <KpiCard><KpiLabel>{t('profit.kpi.activeProjects', '활성 프로젝트')}</KpiLabel><KpiValueBig>{fmtNum(data.kpis.active_projects.value)}</KpiValueBig></KpiCard>
        <KpiCard><KpiLabel>{t('profit.kpi.negativeMargin', '마진 음수')}</KpiLabel><KpiValueBig>{fmtNum(data.kpis.negative_margin.value)}</KpiValueBig></KpiCard>
        <KpiCard><KpiLabel>{t('profit.kpi.avgPph', 'Profit per Hour')}</KpiLabel><KpiValueBig>{data.kpis.avg_profit_per_hour.value == null ? '—' : `${fmtKRW(data.kpis.avg_profit_per_hour.value)}/h`}</KpiValueBig></KpiCard>
        <KpiCard><KpiLabel>{t('profit.kpi.totalRevenue', '매출 합계')}</KpiLabel><KpiValueBig>{fmtKRW(data.kpis.total_revenue.value)}</KpiValueBig></KpiCard>
        <KpiCard><KpiLabel>{t('profit.kpi.totalProfit', '이익 합계')}</KpiLabel><KpiValueBig>{fmtKRW(data.kpis.total_profit.value)}</KpiValueBig></KpiCard>
        <KpiCard><KpiLabel>{t('profit.kpi.totalHours', '총 투입 시간')}</KpiLabel><KpiValueBig>{fmtNum(data.kpis.total_hours.value, 'h')}</KpiValueBig></KpiCard>
      </KpiGrid>

      <SectionLabel>{t('profit.chart.bubble.title', '프로젝트 손익 분포')}</SectionLabel>
      <ChartCard>
        {data.bubble.length === 0 ? (
          <ChartEmpty>{t('profit.chart.bubble.empty', '프로젝트 시간·매출 데이터가 누적되면 표시됩니다')}</ChartEmpty>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <ScatterChart margin={{ top: 16, right: 24, bottom: 32, left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis type="number" dataKey="hours" name={t('profit.chart.axis.hours', '시간') as string}
                tick={{ fontSize: 11, fill: '#64748B' }}
                label={{ value: t('profit.chart.axis.hours', '투입 시간 (h)') as string, position: 'insideBottom', offset: -8, fill: '#64748B', fontSize: 11 }} />
              <YAxis type="number" dataKey="revenue" name={t('profit.chart.axis.revenue', '매출') as string}
                tick={{ fontSize: 11, fill: '#64748B' }} tickFormatter={(v) => fmtKRW(v)}
                label={{ value: t('profit.chart.axis.revenue', '매출') as string, angle: -90, position: 'insideLeft', fill: '#64748B', fontSize: 11 }} />
              <ZAxis range={[60, 60]} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload;
                  return (
                    <div style={{ background: '#0F172A', color: '#FFF', padding: '10px 12px', borderRadius: 8, fontSize: 11, lineHeight: 1.6 }}>
                      <div><strong style={{ color: '#5EEAD4' }}>{p.name}</strong></div>
                      <div>{t('profit.tooltip.hours', '시간')}: {p.hours}h</div>
                      <div>{t('profit.tooltip.revenue', '매출')}: {fmtKRW(p.revenue)}</div>
                      <div>{t('profit.tooltip.profit', '이익')}: {fmtKRW(p.profit)}</div>
                      {p.margin_pct != null && <div>{t('profit.tooltip.margin', '마진')}: {p.margin_pct.toFixed(1)}%</div>}
                    </div>
                  );
                }}
              />
              <Scatter data={data.bubble} fill="#14B8A6" />
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <SectionRow style={{ marginTop: 24 }}>
        <SectionLabel>{t('profit.table.title', '프로젝트 손익 상세')}</SectionLabel>
        <DownloadBtn type="button" disabled={data.table.length === 0}
          onClick={() => downloadRowsAsCsv(`profit_${data.period.from}_${data.period.to}.csv`, data.table, [
            { key: 'project_id', header: 'ID' },
            { key: 'name', header: t('profit.col.name', '프로젝트') as string },
            { key: 'client', header: t('profit.col.client', '고객') as string },
            { key: 'revenue', header: t('profit.col.revenue', '매출') as string },
            { key: 'labor_cost', header: t('profit.col.laborCost', '노동비') as string },
            { key: 'direct_cost', header: t('profit.col.directCost', '직접비') as string },
            { key: 'profit', header: t('profit.col.profit', '이익') as string },
            { key: 'margin_pct', header: t('profit.col.margin', '마진') as string },
            { key: 'hours', header: t('profit.col.hours', '시간') as string },
            { key: 'profit_per_hour', header: t('profit.col.pph', 'Profit/Hr') as string },
          ])}>
          <DownloadIcon /> {t('download.csv', 'CSV (Excel)')}
        </DownloadBtn>
      </SectionRow>
      {data.table.length === 0 ? (
        <ChartCard><ChartEmpty>{t('profit.table.empty', '프로젝트가 없습니다')}</ChartEmpty></ChartCard>
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <Tr>
                <Th>{t('profit.col.name', '프로젝트')}</Th>
                <Th>{t('profit.col.client', '고객')}</Th>
                <Th $num>{t('profit.col.revenue', '매출')}</Th>
                <Th $num>{t('profit.col.cost', '비용')}</Th>
                <Th $num>{t('profit.col.profit', '이익')}</Th>
                <Th $num>{t('profit.col.margin', '마진')}</Th>
                <Th $num>{t('profit.col.hours', '시간')}</Th>
                <Th $num>{t('profit.col.pph', 'Profit/Hr')}</Th>
              </Tr>
            </thead>
            <tbody>
              {data.table.slice(0, 50).map((r) => (
                <Tr key={r.project_id} $clickable onClick={() => navigate(`/projects/p/${r.project_id}`)}>
                  <Td>{r.name}</Td>
                  <Td>{r.client}</Td>
                  <Td $num>{fmtKRW(r.revenue)}</Td>
                  <Td $num>{fmtKRW(r.labor_cost + r.direct_cost)}</Td>
                  <Td $num style={{ color: r.profit < 0 ? '#B91C1C' : '#0F172A' }}>{fmtKRW(r.profit)}</Td>
                  <Td $num>{r.margin_pct == null ? '—' : `${r.margin_pct.toFixed(1)}%`}</Td>
                  <Td $num>{fmtNum(r.hours, 'h')}</Td>
                  <Td $num>{r.profit_per_hour == null ? '—' : `${fmtKRW(r.profit_per_hour)}/h`}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </>
  );
};

export default ProfitTab;
