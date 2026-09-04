import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useNavigate } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { fetchTab, type RangePreset, type StatsSegment } from '../../../services/insights';
import {
  InsightRow, InsightCard, InsightStripe, InsightBody, InsightTitle, InsightValue, InsightHint, InsightAction,
  KpiGrid, KpiCard, KpiLabel, KpiValueBig, KpiHint,
  SectionLabel, SectionRow, DownloadBtn, DownloadIcon, ChartCard, ChartEmpty,
  SkeletonGrid, SkeletonCard, ErrorBanner,
  fmtMoney, fmtNum, fmtPct, CurrencyBreakdown,
} from '../components';
import { downloadRowsAsCsv } from '../../../utils/csv';

interface Data {
  period: { from: string; to: string; label: string };
  home_currency?: string;
  kpis: {
    revenue: { value: number | null; by_currency?: Record<string, number> };
    profit: { value: number | null };
    utilization_pct: { value: number | null };
    issued: { value: number | null; by_currency?: Record<string, number> };
    active_projects: { value: number | null };
    new_clients: { value: number | null };
    /** #211 ④ — 고객이 말을 걸고 우리가 답하기까지(중앙값, 분). 표본 없으면 value=null */
    first_response_minutes?: { value: number | null; samples?: number };
  };
  trend: { month: string; revenue: number; profit: number }[];
  insights: { severity: string; title: string; value: string; hint?: string; action_label?: string; action_link?: string }[];
}

/** 분 → 사람이 읽는 시간. 그대로 두면 "64743분" 이 화면에 나온다.
 *  문구는 t() 로 — 시간 단위 표기는 언어마다 다르다(4시간/4 hr). */
function fmtDuration(min: number | null | undefined, t: TFunction): string {
  if (min == null) return '—';
  if (min < 1) return t('duration.under1m');
  if (min < 60) return t('duration.min', { n: Math.round(min) });
  if (min < 60 * 24) {
    const h = Math.floor(min / 60); const m = Math.round(min % 60);
    return m ? t('duration.hourMin', { h, m }) : t('duration.hour', { h });
  }
  const d = Math.floor(min / (60 * 24)); const h = Math.round((min % (60 * 24)) / 60);
  return h ? t('duration.dayHour', { d, h }) : t('duration.day', { d });
}

const OverviewTab: React.FC<{ businessId: number; range: RangePreset; segment?: StatsSegment }> = ({ businessId, range, segment = 'client' }) => {
  const { t } = useTranslation('insights');
  const navigate = useNavigate();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchTab<Data>(businessId, 'overview', range, segment)
      .then((d) => { setData(d); setErr(null); })
      .catch((e) => setErr(e?.message || 'failed'))
      .finally(() => setLoading(false));
  }, [businessId, range, segment]);

  if (err) return <ErrorBanner>{t('error.summary')} — {err}</ErrorBanner>;
  if (loading || !data) return <SkeletonGrid>{[0,1,2,3,4,5].map((i) => <SkeletonCard key={i} />)}</SkeletonGrid>;

  const home = data.home_currency || 'KRW';
  const foreignLabel = t('foreignLabel', '외화') as string;

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
        <KpiCard><KpiLabel>{t('overview.kpi.revenue', '매출 (수금)')}</KpiLabel><KpiValueBig>{fmtMoney(data.kpis.revenue.value, home)}</KpiValueBig><CurrencyBreakdown map={data.kpis.revenue.by_currency} label={foreignLabel} /></KpiCard>
        <KpiCard><KpiLabel>{t('overview.kpi.profit', '영업이익')}</KpiLabel><KpiValueBig>{fmtMoney(data.kpis.profit.value, home)}</KpiValueBig></KpiCard>
        <KpiCard><KpiLabel>{t('overview.kpi.utilization', '가동률')}</KpiLabel><KpiValueBig>{fmtPct(data.kpis.utilization_pct.value)}</KpiValueBig></KpiCard>
        <KpiCard><KpiLabel>{t('overview.kpi.issued', '발행 청구액')}</KpiLabel><KpiValueBig>{fmtMoney(data.kpis.issued.value, home)}</KpiValueBig><CurrencyBreakdown map={data.kpis.issued.by_currency} label={foreignLabel} /></KpiCard>
        <KpiCard><KpiLabel>{t('overview.kpi.activeProjects', '활성 프로젝트')}</KpiLabel><KpiValueBig>{fmtNum(data.kpis.active_projects.value)}</KpiValueBig></KpiCard>
        <KpiCard><KpiLabel>{t('overview.kpi.newClients', '신규 고객')}</KpiLabel><KpiValueBig>{fmtNum(data.kpis.new_clients.value)}</KpiValueBig></KpiCard>
        {/* #211 ④ — "0분" 과 "잰 적이 없다" 는 다른 상태다. 표본 수를 같이 보여주고,
            표본이 없으면 왜 비었는지 말한다(빈 값만 두면 고장으로 읽힌다). */}
        <KpiCard>
          <KpiLabel>{t('overview.kpi.firstResponse', '첫 응답 시간')}</KpiLabel>
          <KpiValueBig>{fmtDuration(data.kpis.first_response_minutes?.value, t)}</KpiValueBig>
          <KpiHint>
            {data.kpis.first_response_minutes?.samples
              ? t('overview.kpi.firstResponseSamples', '고객 문의 {{n}}건 기준 (중앙값)', { n: data.kpis.first_response_minutes.samples })
              : t('overview.kpi.firstResponseEmpty', '이 기간에 고객 문의가 없었습니다')}
          </KpiHint>
        </KpiCard>
      </KpiGrid>

      <SectionRow>
        <SectionLabel>{t('overview.chart.trend.title', '12개월 매출·이익 추이')}</SectionLabel>
        <DownloadBtn type="button" disabled={data.trend.length === 0}
          onClick={() => downloadRowsAsCsv(`overview_${data.period.from}_${data.period.to}.csv`, data.trend, [
            { key: 'month', header: t('overview.chart.trend.month', '월') as string },
            { key: 'revenue', header: t('overview.chart.trend.revenue', '매출') as string },
            { key: 'profit', header: t('overview.chart.trend.profit', '이익') as string },
          ])}>
          <DownloadIcon /> {t('download.csv', 'CSV (Excel)')}
        </DownloadBtn>
      </SectionRow>
      <ChartCard>
        {data.trend.length === 0 ? (
          <ChartEmpty>{t('overview.chart.trend.empty', '월별 매출 데이터가 누적되면 표시됩니다')}</ChartEmpty>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={data.trend} margin={{ top: 16, right: 24, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="month" tick={{ fontSize: '0.6875rem', fill: '#64748B' }} />
              <YAxis tick={{ fontSize: '0.6875rem', fill: '#64748B' }} tickFormatter={(v) => fmtMoney(v, home)} />
              <Tooltip formatter={(v) => fmtMoney(typeof v === 'number' ? v : Number(v), home)} />
              <Legend wrapperStyle={{ fontSize: '0.6875rem' }} />
              <Line type="monotone" dataKey="revenue" name={t('overview.chart.trend.revenue', '매출') as string} stroke="#14B8A6" strokeWidth={2} />
              <Line type="monotone" dataKey="profit" name={t('overview.chart.trend.profit', '이익') as string} stroke="#F43F5E" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </>
  );
};

export default OverviewTab;
