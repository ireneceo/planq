import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, LineChart, Line, Legend, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { fetchTab, type RangePreset } from '../../../services/insights';
import {
  InsightRow, InsightCard, InsightStripe, InsightBody, InsightTitle, InsightValue, InsightHint, InsightAction,
  KpiGrid, KpiCard, KpiLabel, KpiValueBig,
  SectionLabel, SectionRow, DownloadBtn, DownloadIcon, ChartCard, ChartEmpty,
  TableWrap, Table, Tr, Th, Td,
  SkeletonGrid, SkeletonCard, ErrorBanner,
  fmtKRW, fmtPct,
} from '../components';
import { downloadRowsAsCsv } from '../csvUtils';

interface Data {
  period: { from: string; to: string; label: string };
  kpis: Record<string, { value: number | null }>;
  cost_trend?: { month: string; revenue: number; cost: number; profit: number }[];
  expenses_by_category: { category: string; amount: number }[];
  insights: { severity: string; title: string; value: string; hint?: string; action_label?: string; action_link?: string }[];
}

const FinanceTab: React.FC<{ businessId: number; range: RangePreset }> = ({ businessId, range }) => {
  const { t } = useTranslation('insights');
  const navigate = useNavigate();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchTab<Data>(businessId, 'finance', range)
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
        <KpiCard><KpiLabel>{t('finance.kpi.revenue', '매출')}</KpiLabel><KpiValueBig>{fmtKRW(data.kpis.revenue.value)}</KpiValueBig></KpiCard>
        <KpiCard><KpiLabel>{t('finance.kpi.totalCost', '총 비용')}</KpiLabel><KpiValueBig>{fmtKRW(data.kpis.total_cost.value)}</KpiValueBig></KpiCard>
        <KpiCard><KpiLabel>{t('finance.kpi.profit', '이익')}</KpiLabel><KpiValueBig>{fmtKRW(data.kpis.profit.value)}</KpiValueBig></KpiCard>
        <KpiCard><KpiLabel>{t('finance.kpi.margin', '마진')}</KpiLabel><KpiValueBig>{fmtPct(data.kpis.margin_pct.value)}</KpiValueBig></KpiCard>
        <KpiCard><KpiLabel>{t('finance.kpi.receivable', '미수금')}</KpiLabel><KpiValueBig>{fmtKRW(data.kpis.receivable.value)}</KpiValueBig></KpiCard>
        <KpiCard><KpiLabel>{t('finance.kpi.overhead', '고정비')}</KpiLabel><KpiValueBig>{fmtKRW(data.kpis.overhead.value)}</KpiValueBig></KpiCard>
      </KpiGrid>

      <SectionLabel>{t('finance.chart.trend.title', '12개월 매출·비용·이익 추이')}</SectionLabel>
      <ChartCard>
        {!data.cost_trend || data.cost_trend.every((m) => m.revenue === 0 && m.cost === 0) ? (
          <ChartEmpty>{t('finance.chart.trend.empty', '결제·비용 데이터가 누적되면 표시됩니다')}</ChartEmpty>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data.cost_trend} margin={{ top: 16, right: 24, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748B' }} tickFormatter={(v) => String(v).slice(2)} />
              <YAxis tick={{ fontSize: 11, fill: '#64748B' }} tickFormatter={(v) => fmtKRW(v)} />
              <Tooltip formatter={(v) => fmtKRW(typeof v === 'number' ? v : Number(v))} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="revenue" name={t('finance.chart.trend.revenue', '매출') as string} stroke="#14B8A6" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="cost" name={t('finance.chart.trend.cost', '비용') as string} stroke="#F43F5E" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="profit" name={t('finance.chart.trend.profit', '이익') as string} stroke="#0F172A" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <SectionLabel style={{ marginTop: 24 }}>{t('finance.chart.expenses.title', '카테고리별 지출')}</SectionLabel>
      <ChartCard>
        {data.expenses_by_category.length === 0 ? (
          <ChartEmpty>{t('finance.chart.expenses.empty', '비용·고정비를 등록하면 표시됩니다')}</ChartEmpty>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={data.expenses_by_category.slice(0, 10)} margin={{ top: 16, right: 24, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="category" tick={{ fontSize: 11, fill: '#64748B' }} />
              <YAxis tick={{ fontSize: 11, fill: '#64748B' }} tickFormatter={(v) => fmtKRW(v)} />
              <Tooltip formatter={(v) => fmtKRW(typeof v === 'number' ? v : Number(v))} />
              <Bar dataKey="amount" name={t('finance.chart.expenses.bar', '금액') as string} fill="#F43F5E" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <SectionRow style={{ marginTop: 24 }}>
        <SectionLabel>{t('finance.table.title', '카테고리별 상세')}</SectionLabel>
        <DownloadBtn type="button" disabled={data.expenses_by_category.length === 0}
          onClick={() => downloadRowsAsCsv(`finance_${data.period.from}_${data.period.to}.csv`, data.expenses_by_category, [
            { key: 'category', header: t('finance.col.category', '카테고리') as string },
            { key: 'amount', header: t('finance.col.amount', '금액') as string },
          ])}>
          <DownloadIcon /> {t('download.csv', 'CSV (Excel)')}
        </DownloadBtn>
      </SectionRow>
      {data.expenses_by_category.length === 0 ? (
        <ChartCard><ChartEmpty>{t('finance.table.empty', '데이터가 없습니다')}</ChartEmpty></ChartCard>
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <Tr>
                <Th>{t('finance.col.category', '카테고리')}</Th>
                <Th $num>{t('finance.col.amount', '금액')}</Th>
              </Tr>
            </thead>
            <tbody>
              {data.expenses_by_category.map((r) => (
                <Tr key={r.category}>
                  <Td>{r.category}</Td>
                  <Td $num>{fmtKRW(r.amount)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </>
  );
};

export default FinanceTab;
