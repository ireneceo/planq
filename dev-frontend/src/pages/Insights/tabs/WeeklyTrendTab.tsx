// 주간 추세 — Weekly Review Phase 2 (사이클 N+5)
//
// /api/weekly-reviews?business_id=N&limit=12 의 누적 결산 시계열을 차트로.
// 4주+ 데이터 모이면 의미 있어짐. 데이터 부족 시 빈 상태 안내.

import { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { apiFetch } from '../../../contexts/AuthContext';
import {
  KpiGrid, KpiCard, KpiLabel, KpiValueBig,
  SectionLabel, ChartCard, ChartEmpty, SkeletonGrid, SkeletonCard, ErrorBanner,
} from '../components';

interface ReviewRow {
  id: number;
  week_start: string;
  week_end: string;
  finalized_at: string;
  finalized_by: 'manual' | 'auto';
  retro_note: string | null;
  summary: {
    total: number;
    completed: number;
    incomplete: number;
    estimated_total: number;
    actual_total: number;
    utilization_pct: number;
    capacity_hours: number;
  } | null;
  created_at: string;
}

interface Props {
  businessId: number;
}

const WeeklyTrendTab: React.FC<Props> = ({ businessId }) => {
  const { t } = useTranslation('insights');
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch(`/api/weekly-reviews?business_id=${businessId}&limit=12`)
      .then(r => r.json())
      .then(j => {
        if (cancelled) return;
        if (j.success && Array.isArray(j.data)) {
          setReviews([...j.data].reverse()); // 오래된 순으로 차트
        } else {
          setError(j.message || 'fetch_failed');
        }
      })
      .catch(() => setError('network'))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [businessId]);

  // 시계열 데이터 가공
  const chartData = useMemo(() => reviews
    .filter(r => r.summary)
    .map(r => {
      const s = r.summary!;
      const completion = s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0;
      // 예측 정확도: actual / estimated (1.0 이 정확). 0~200 범위로 clamp
      const accuracy = s.estimated_total > 0
        ? Math.min(200, Math.round((s.actual_total / s.estimated_total) * 100))
        : null;
      return {
        week: r.week_start.slice(5), // MM-DD
        completion,
        utilization: s.utilization_pct,
        accuracy,
      };
    }), [reviews]);

  // 최근 4주 평균 (KPI)
  const kpis = useMemo(() => {
    const recent = chartData.slice(-4);
    const n = recent.length || 1;
    const avg = (key: 'completion' | 'utilization' | 'accuracy') => {
      const values = recent.map(d => d[key]).filter((v): v is number => typeof v === 'number');
      if (values.length === 0) return null;
      return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
    };
    return {
      completion: avg('completion'),
      utilization: avg('utilization'),
      accuracy: avg('accuracy'),
      weeks: n,
    };
  }, [chartData]);

  if (loading) return <SkeletonGrid>{[0,1,2,3].map((i) => <SkeletonCard key={i} />)}</SkeletonGrid>;
  if (error) return <ErrorBanner>{t('weekly.error', { defaultValue: '데이터를 불러오지 못했습니다' }) as string}</ErrorBanner>;
  if (chartData.length === 0) {
    return (
      <EmptyState>
        <EmptyIcon>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="3" x2="3" y2="21"/><line x1="3" y1="21" x2="21" y2="21"/>
            <polyline points="6 17 11 12 14 15 21 8"/>
          </svg>
        </EmptyIcon>
        <EmptyTitle>{t('weekly.empty.title', { defaultValue: '아직 누적된 주간 결산이 없습니다' }) as string}</EmptyTitle>
        <EmptyHint>{t('weekly.empty.hint', { defaultValue: 'Q Task 의 "이번 주 마무리" 또는 일요일 23:59 cron 으로 박제됩니다. 4주+ 누적되면 의미있는 추세를 볼 수 있습니다.' }) as string}</EmptyHint>
      </EmptyState>
    );
  }

  return (
    <>
      <SectionLabel>{t('weekly.kpi.title', { defaultValue: '최근 {{n}}주 평균', n: kpis.weeks }) as string}</SectionLabel>
      <KpiGrid>
        <KpiCard>
          <KpiLabel>{t('weekly.kpi.completion', { defaultValue: '완료율' }) as string}</KpiLabel>
          <KpiValueBig>{kpis.completion !== null ? `${kpis.completion}%` : '—'}</KpiValueBig>
        </KpiCard>
        <KpiCard>
          <KpiLabel>{t('weekly.kpi.utilization', { defaultValue: '캐파 활용률' }) as string}</KpiLabel>
          <KpiValueBig>{kpis.utilization !== null ? `${kpis.utilization}%` : '—'}</KpiValueBig>
        </KpiCard>
        <KpiCard>
          <KpiLabel>{t('weekly.kpi.accuracy', { defaultValue: '예측 정확도' }) as string}</KpiLabel>
          <KpiValueBig>{kpis.accuracy !== null ? `${kpis.accuracy}%` : '—'}</KpiValueBig>
        </KpiCard>
        <KpiCard>
          <KpiLabel>{t('weekly.kpi.weeks', { defaultValue: '누적 주차' }) as string}</KpiLabel>
          <KpiValueBig>{chartData.length}</KpiValueBig>
        </KpiCard>
      </KpiGrid>

      <SectionLabel>{t('weekly.chart.completion', { defaultValue: '주간 완료율 추세' }) as string}</SectionLabel>
      <ChartCard>
        {chartData.length < 2 ? (
          <ChartEmpty>{t('weekly.chart.needMore', { defaultValue: '추세를 보려면 2주 이상 데이터가 필요합니다' }) as string}</ChartEmpty>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData} margin={{ top: 16, right: 24, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="week" stroke="#64748B" fontSize={11} />
              <YAxis stroke="#64748B" fontSize={11} unit="%" domain={[0, 100]} />
              <Tooltip contentStyle={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="completion" stroke="#14B8A6" strokeWidth={2.5} dot={{ r: 4 }} name={t('weekly.kpi.completion', { defaultValue: '완료율' }) as string} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <Hint>{t('weekly.hint', { defaultValue: '주차별 완료한 업무 비율 (완료 / 전체). 캐파 활용률·예측 정확도는 KPI 카드에서 확인하세요.' }) as string}</Hint>
    </>
  );
};

export default WeeklyTrendTab;

const EmptyState = styled.div`
  display: flex; flex-direction: column; align-items: center; padding: 48px 24px;
  background: #F8FAFC; border: 1px dashed #CBD5E1; border-radius: 12px;
`;
const EmptyIcon = styled.div`color: #94A3B8; margin-bottom: 12px;`;
const EmptyTitle = styled.div`font-size: 14px; font-weight: 600; color: #334155; margin-bottom: 6px;`;
const EmptyHint = styled.div`font-size: 12px; color: #64748B; text-align: center; max-width: 480px; line-height: 1.6;`;
const Hint = styled.div`font-size: 11px; color: #94A3B8; padding: 8px 0; line-height: 1.6;`;
