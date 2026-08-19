// 주간 업무 진척 그래프 (번업) — 보고서·업무 화면 공통.
//
// Irene(#145): "우측패널에 나오는 주간 업무 진척 그래프가 업무보고에 포함되어야 해. 성과 그래프인데.
//               캡처 시점 제대로 맞춰서. 전에 있던 거 왜 없어졌어."
//   보고서 IA 를 새로 만들면서 그래프가 있는 옛 화면(WeeklyReviewView)이 통째로 안 쓰이게 되어
//   사라졌다. 이미지 캡처가 아니라 **그 기간의 일별 시리즈를 스냅샷에 굳혀** 두고 다시 그린다
//   (이미지는 확대도, 다시 그리기도 못 한다. 데이터는 남는다).
//
// 정의(Q Task 라이브 그래프와 동일):
//   진척(예상시간) = Σ(예측시간 × 진행률) 누적 — 0 에서 위로 올라간다
//   실제 업무시간   = Σ(실제 입력시간) 누적 — 가용시간을 넘으면 그 위로 솟는다
//   ★ 이름이 중요하다. 둘 다 "시간" 이지만 **하나는 예측 기준, 하나는 실제 기록**이다.
//     옛 이름("진척"/"투입")은 그 차이를 말하지 않아, 실제 시간이 0 인 것을 그래프 고장으로 읽었다
//     (Irene: "투입은 뭐야? 왜 움직이지 않아?").
import { useMemo } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
} from 'recharts';

export interface ProgressPoint {
  date: string;
  /** 아직 오지 않은 날은 null — 0 과 구분해야 한다(안 한 날 vs 0시간 한 날) */
  estimated_cumulative: number | null;
  actual_cumulative: number | null;
}

interface Props {
  series: ProgressPoint[];
  /** 가용시간(주간 캐파) — 있으면 기준선 */
  capacityHours?: number | null;
  height?: number;
}

export default function ProgressBurnupChart({ series, capacityHours = null, height = 240 }: Props) {
  const { t } = useTranslation('qtask');

  // ★ null 통과 필수 — 아직 오지 않은 날은 백엔드가 null 을 준다.
  //   `Number(x) || 0` 으로 뭉개면 미래 요일에 0 선이 그어져 "안 한 날" 이 "0시간 한 날" 로 보인다.
  const data = useMemo(() => series.map((p) => ({
    label: p.date.slice(5).replace('-', '/'),
    estimated: p.estimated_cumulative == null ? null : Number(p.estimated_cumulative) || 0,
    actual: p.actual_cumulative == null ? null : Number(p.actual_cumulative) || 0,
  })), [series]);

  // #288 — "이 기간에 증가가 0" 과 "그릴 데이터가 아예 없다" 는 **다른 상태**인데 여태 같은 화면을 냈다.
  //   무대에 오른 업무가 있으면(시리즈가 있으면) 0 이어도 그린다 — 가용시간 기준선이 있는 0 은
  //   "아직 0h" 라는 정보다. 반면 빈 문구는 "고장" 으로 읽힌다(#288 "왜 다 없는 거야").
  //   진짜 빈 상태는 시리즈 자체가 없을 때뿐(그 기간 무대 업무 0건).
  const hasAny = data.some((d) => (d.estimated ?? 0) > 0 || (d.actual ?? 0) > 0);
  // ★ "한 일은 있는데 **실제 업무시간만** 0" 은 또 다른 상태다. 위 hasAny 는 true 라 침묵하는데,
  //   사용자는 선 하나가 바닥에 붙은 것을 보고 그래프가 고장났다고 읽는다
  //   (Irene: "투입은 뭐야? 왜 움직이지 않아?"). 실제 시간은 직접 기록해야 쌓인다는 사실을 말한다.
  const noActual = hasAny && data.every((d) => (d.actual ?? 0) === 0);

  if (!series.length) {
    return (
      <Empty>
        <EmptyTitle>{t('report.chartEmptyTitle', { defaultValue: '이 기간에 기록된 업무 시간이 없어요' }) as string}</EmptyTitle>
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
          {/* #288 — "설정에서 가져온 기준". 캡션 한 줄로만 있던 것을 차트 위 실제 기준선으로 올린다.
              0 만 있는 주에도 "가용 Nh 프레임에 아직 0h" 라는 읽을거리가 생긴다. */}
          {capacityHours ? (
            // ★ ifOverflow 기본값은 'discard' — 기준선이 데이터 범위 밖이면 **선을 통째로 버린다**.
            //   그런데 이 기준선이 필요한 대표 상황이 바로 "아직 0h" 인 주다(도메인 0~1.6 vs 기준선 40).
            //   즉 기본값이면 필요할 때마다 정확히 안 그려진다 — 캡션만 남고 죽은 코드가 된다.
            //   extendDomain: y축을 기준선까지 넓혀 0 도 "가용 Nh 프레임 안" 에서 읽히게 한다.
            <ReferenceLine y={capacityHours} ifOverflow="extendDomain" stroke="#CBD5E1" strokeDasharray="5 4"
              label={{ value: `${capacityHours}h`, position: 'right', fontSize: 10, fill: '#94A3B8' }} />
          ) : null}
          <Line
            type="monotone" dataKey="estimated" name={t('report.chartEstimated', { defaultValue: '진척 (예상시간)' }) as string}
            stroke="#94A3B8" strokeWidth={2} strokeDasharray="4 3" dot={false} isAnimationActive={false}
          />
          <Line
            type="monotone" dataKey="actual" name={t('report.chartActual', { defaultValue: '실제 업무시간' }) as string}
            stroke="#14B8A6" strokeWidth={2.5} dot={{ r: 2.5 }} isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      {/* #288 — 기간 내 증가가 0 이면 그 사실을 말한다. 차트를 숨기면 "고장" 으로 읽힌다.
          ★ 이월 누적치는 여기 쓰지 않는다 — 리스트에 없는 숫자를 그래프 옆에 들이는 것이 #254 의 재료였다. */}
      {!hasAny && (
        <Cap as="div">{t('report.chartNoIncrement', { defaultValue: '이 기간에 새로 기록된 진행이 아직 없어요' }) as string}</Cap>
      )}
      {noActual && (
        <Cap as="div">{t('report.chartNoActual', { defaultValue: '실제 업무시간은 직접 기록된 시간입니다 — 업무를 "진행 중"으로 진행하거나 실제 시간을 입력하면 채워져요' }) as string}</Cap>
      )}
      {capacityHours ? (
        <Cap>{t('report.chartCapacity', { n: capacityHours, defaultValue: '가용시간 {{n}}h 기준' }) as string}</Cap>
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
