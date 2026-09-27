// 통계 · 고객 유입 — 고객 창구 퍼널 (방문자 확인 → 예약 신청 → 확정 → 고객 등록).
//   정의·코호트는 서버 services/entryFunnel.js 머리말이 정본이다. 화면은 숫자를 다시 세지 않는다.
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import { fetchTab, type RangePreset } from '../../../services/insights';
import {
  KpiGrid, KpiCard, KpiLabel, KpiValueBig,
  SectionLabel, ChartCard, ChartEmpty,
  SkeletonGrid, SkeletonCard, ErrorBanner, fmtPct,
} from '../components';

type StepKey = 'visitors' | 'requested' | 'confirmed' | 'registered';
const STEPS: StepKey[] = ['visitors', 'requested', 'confirmed', 'registered'];

interface Data {
  period: { from: string; to: string; label: string };
  steps: Record<StepKey, number>;
  breakdown: { pending: number; declined: number; canceled: number };
}

const EntryTab: React.FC<{ businessId: number; range: RangePreset }> = ({ businessId, range }) => {
  const { t } = useTranslation('insights');
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchTab<Data>(businessId, 'entry', range)
      .then((d) => { setData(d); setErr(null); })
      .catch((e) => setErr(e?.message || 'failed'))
      .finally(() => setLoading(false));
  }, [businessId, range]);

  if (err) return <ErrorBanner>{t('error.summary')} — {err}</ErrorBanner>;
  if (loading || !data) return <SkeletonGrid>{[0, 1, 2, 3].map((i) => <SkeletonCard key={i} />)}</SkeletonGrid>;

  const empty = STEPS.every((k) => data.steps[k] === 0);
  const rows = STEPS.map((k) => ({ name: t(`entry.step.${k}`) as string, value: data.steps[k] }));

  return (
    <>
      <KpiGrid $cols={3}>
        <KpiCard><KpiLabel>{t('entry.kpi.pending', '처리 대기')}</KpiLabel><KpiValueBig>{data.breakdown.pending}</KpiValueBig></KpiCard>
        <KpiCard><KpiLabel>{t('entry.kpi.declined', '거절')}</KpiLabel><KpiValueBig>{data.breakdown.declined}</KpiValueBig></KpiCard>
        <KpiCard><KpiLabel>{t('entry.kpi.canceled', '취소')}</KpiLabel><KpiValueBig>{data.breakdown.canceled}</KpiValueBig></KpiCard>
      </KpiGrid>

      <SectionLabel>{t('entry.funnel.title', '고객 창구 퍼널')}</SectionLabel>
      <ChartCard data-testid="stats-entry-funnel">
        {empty ? (
          <ChartEmpty>{t('entry.funnel.empty', '이 기간에 창구 방문자·상담 신청이 없습니다')}</ChartEmpty>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 8 }}>
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={96} tick={{ fontSize: '0.75rem', fill: '#0F172A' }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: '#F8FAFC' }} />
                <Bar dataKey="value" fill="#14B8A6" radius={[0, 6, 6, 0]} barSize={18} isAnimationActive={false}>
                  <LabelList dataKey="value" position="right" style={{ fontSize: '0.75rem', fontWeight: 700, fill: '#0F172A' }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <Rates>
              {STEPS.slice(1).map((k, i) => {
                const prev = data.steps[STEPS[i]];
                return (
                  <li key={k} data-step={k}>
                    {t(`entry.step.${STEPS[i]}`)} → {t(`entry.step.${k}`)}
                    <b>{fmtPct(prev ? (data.steps[k] / prev) * 100 : null)}</b>
                  </li>
                );
              })}
            </Rates>
          </>
        )}
      </ChartCard>
      <Note>{t('entry.funnel.note', '방문자는 창구에서 이메일을 확인한 사람입니다. 로그인한 고객의 신청은 방문자 단계를 거치지 않아 첫 전환율이 100%를 넘을 수 있습니다.')}</Note>
    </>
  );
};

export default EntryTab;

const Rates = styled.ul`
  list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px 16px;
  font-size: 0.75rem; color: #64748B;
  b { margin-left: 6px; color: #0F172A; font-variant-numeric: tabular-nums; }
`;
const Note = styled.p`margin: 8px 2px 0; font-size: 0.75rem; color: #94A3B8; line-height: 1.5;`;
