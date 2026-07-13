// 주간 업무 진척 그래프 (번업) — 보고서·업무 화면 공통.
//
// Irene(#145): "우측패널에 나오는 주간 업무 진척 그래프가 업무보고에 포함되어야 해. 성과 그래프인데.
//               캡처 시점 제대로 맞춰서. 전에 있던 거 왜 없어졌어."
//   보고서 IA 를 새로 만들면서 그래프가 있는 옛 화면(WeeklyReviewView)이 통째로 안 쓰이게 되어
//   사라졌다. 이미지 캡처가 아니라 **그 기간의 일별 시리즈를 스냅샷에 굳혀** 두고 다시 그린다
//   (이미지는 확대도, 다시 그리기도 못 한다. 데이터는 남는다).
//
// 정의(Q Task 라이브 그래프와 동일):
//   진척(예측) = Σ(예측시간 × 진행률) 누적 — 0 에서 위로 올라간다
//   투입(실제) = Σ(실제시간) 누적 — 가용시간을 넘으면 그 위로 솟는다
import { useMemo } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';

export interface ProgressPoint {
  date: string;
  estimated_cumulative: number;
  actual_cumulative: number;
}

interface Props {
  series: ProgressPoint[];
  /** 가용시간(주간 캐파) — 있으면 기준선 */
  capacityHours?: number | null;
  height?: number;
}

export default function ProgressBurnupChart({ series, capacityHours = null, height = 240 }: Props) {
  const { t } = useTranslation('qtask');

  const data = useMemo(() => series.map((p) => ({
    label: p.date.slice(5).replace('-', '/'),
    estimated: Number(p.estimated_cumulative) || 0,
    actual: Number(p.actual_cumulative) || 0,
  })), [series]);

  const hasAny = data.some((d) => d.estimated > 0 || d.actual > 0);

  if (!series.length || !hasAny) {
    return (
      <Empty>
        <EmptyTitle>{t('report.chartEmptyTitle', { defaultValue: '이 기간의 진척 데이터가 없어요' }) as string}</EmptyTitle>
        <EmptyHint>{t('report.chartEmptyHint', { defaultValue: '업무를 진행(포커스)하거나 실제 시간을 입력하면 그래프가 채워집니다.' }) as string}</EmptyHint>
      </Empty>
    );
  }

  return (
    <Box>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={{ stroke: '#E2E8F0' }} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} width={40}
            label={{ value: 'h', position: 'insideTopLeft', fontSize: 10, fill: '#CBD5E1' }} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E2E8F0' }}
            formatter={(v) => `${v}h`}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line
            type="monotone" dataKey="estimated" name={t('report.chartEstimated', { defaultValue: '진척(예측 기준)' }) as string}
            stroke="#94A3B8" strokeWidth={2} strokeDasharray="4 3" dot={false} isAnimationActive={false}
          />
          <Line
            type="monotone" dataKey="actual" name={t('report.chartActual', { defaultValue: '투입(실제 시간)' }) as string}
            stroke="#14B8A6" strokeWidth={2.5} dot={{ r: 2.5 }} isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      {capacityHours ? (
        <Cap>{t('report.chartCapacity', { n: capacityHours, defaultValue: '주간 가용시간 {{n}}h 기준' }) as string}</Cap>
      ) : null}
    </Box>
  );
}

const Box = styled.div`
  border: 1px solid #E2E8F0; border-radius: 12px; padding: 12px 8px 6px; background: #fff;
`;
const Cap = styled.div`padding: 0 8px 4px; font-size: 11px; color: #94A3B8; text-align: right;`;
const Empty = styled.div`
  display: flex; flex-direction: column; gap: 4px; align-items: center; justify-content: center;
  padding: 28px 16px; border: 1px dashed #E2E8F0; border-radius: 12px; background: #F8FAFC;
`;
const EmptyTitle = styled.div`font-size: 13px; font-weight: 600; color: #64748B;`;
const EmptyHint = styled.div`font-size: 12px; color: #94A3B8; text-align: center;`;
