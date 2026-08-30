// components/QTask/AiLoadSummary.tsx — #354 루틴 설계 부하 요약.
//
// 왜 확정 **전에** 보여주는가:
//   루틴 체계는 만들 때가 아니라 **매주 굴러갈 때** 무너진다. "평일마다 4건" 은 목록으로 보면
//   그럴듯한데 요일 막대로 보면 바로 과하다는 게 보인다. 사람이 손으로 하던 부하 조정
//   (데일리 4건 → 2·3건)을 확정 전 화면에서 재현하는 장치다(#354 원문 2번).
//
// ★ 계산은 여기서 하지 않는다 — utils/recurrence.ts 의 weekdayLoadFromRules 한 곳뿐이다.
//   화면이 자기 식으로 세면 실제와 갈라진다.
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { weekdayLoadFromRules } from '../../utils/recurrence';

const Wrap = styled.div`
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 12px 14px;
  background: #f8fafc;
`;
const Head = styled.div`
  display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
  margin-bottom: 10px;
`;
const Title = styled.div`
  font-size: 0.8125rem; font-weight: 700; color: #0f172a;
`;
const Sub = styled.div`
  font-size: 0.75rem; color: #64748b;
`;
const Bars = styled.div`
  display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; align-items: end;
`;
const Col = styled.div`
  display: flex; flex-direction: column; align-items: center; gap: 4px;
`;
// 막대는 "몇 건인가" 를 읽는 도구다. 색으로 상태를 칠하되 3톤 버튼 색과 섞지 않는다.
const Bar = styled.div<{ $h: number; $over: boolean; $weekend: boolean }>`
  width: 100%;
  height: ${(p) => Math.max(4, p.$h)}px;
  border-radius: 4px 4px 0 0;
  background: ${(p) => (p.$over ? '#F43F5E' : p.$weekend ? '#cbd5e1' : '#14B8A6')};
  transition: height 0.18s ease;
`;
const DayLabel = styled.div<{ $weekend: boolean }>`
  font-size: 0.6875rem; color: ${(p) => (p.$weekend ? '#94a3b8' : '#475569')};
`;
const Count = styled.div<{ $over: boolean }>`
  font-size: 0.6875rem; font-weight: 700;
  color: ${(p) => (p.$over ? '#E11D48' : '#0f172a')};
`;
const Foot = styled.div`
  margin-top: 10px; display: flex; flex-direction: column; gap: 4px;
`;
const FootLine = styled.div`
  font-size: 0.75rem; color: #64748b;
`;
const Warn = styled.div`
  font-size: 0.75rem; color: #B45309; font-weight: 600;
`;

/** 평일 하루 권장 상한 — 넘으면 빨간 막대 + 경고. 프롬프트의 LOAD BALANCE 규칙과 같은 값이다. */
const WEEKDAY_CAP = 3;

interface Props {
  /** 이번에 제안된 루틴들의 RRULE */
  proposedRules: Array<string | null | undefined>;
  /** 이 프로젝트에서 이미 돌고 있는 루틴들의 RRULE — 빼고 세면 부담을 절반만 보여준다 */
  existingRules?: Array<string | null | undefined>;
}

export default function AiLoadSummary({ proposedRules, existingRules = [] }: Props) {
  const { t } = useTranslation('qtask');
  const all = [...proposedRules, ...existingRules];
  const load = weekdayLoadFromRules(all);
  const proposedOnly = weekdayLoadFromRules(proposedRules);

  const dayKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
  const maxVal = Math.max(1, ...load.perWeekday);
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  return (
    <Wrap data-testid="ai-load-summary">
      <Head>
        <Title>{t('ai.load.title', '요일별 상시 업무량') as string}</Title>
        <Sub>
          {existingRules.length > 0
            ? (t('ai.load.subWithExisting', { n: proposedRules.length, m: existingRules.length, defaultValue: '제안 {{n}}건 + 이미 돌고 있는 {{m}}건' }) as string)
            : (t('ai.load.sub', { n: proposedRules.length, defaultValue: '제안 {{n}}건 기준' }) as string)}
        </Sub>
      </Head>
      <Bars>
        {dayKeys.map((k, i) => {
          const v = load.perWeekday[i];
          const weekend = i >= 5;
          const over = !weekend && v > WEEKDAY_CAP;
          return (
            <Col key={k}>
              <Count $over={over}>{v > 0 ? fmt(v) : ''}</Count>
              <Bar $h={(v / maxVal) * 56} $over={over} $weekend={weekend} />
              <DayLabel $weekend={weekend}>{t(`ai.load.day.${k}`, k) as string}</DayLabel>
            </Col>
          );
        })}
      </Bars>
      <Foot>
        {load.monthlyCount > 0 && (
          <FootLine>
            {t('ai.load.monthly', { n: load.monthlyCount, defaultValue: '월·분기·연 단위 {{n}}건은 요일에 매이지 않아 따로 셉니다' }) as string}
          </FootLine>
        )}
        {load.unparsed > 0 && (
          <FootLine>
            {t('ai.load.unparsed', { n: load.unparsed, defaultValue: '{{n}}건은 반복 규칙을 읽지 못해 세지 않았습니다' }) as string}
          </FootLine>
        )}
        {load.peakWeekday > WEEKDAY_CAP && (
          <Warn>
            {t('ai.load.tooHeavy', { n: fmt(load.peakWeekday), cap: WEEKDAY_CAP, defaultValue: '가장 몰린 평일이 {{n}}건입니다. 하루 {{cap}}건을 넘으면 오래 못 갑니다 — 몇 건은 주 단위로 낮추거나 빼세요.' }) as string}
          </Warn>
        )}
        {proposedOnly.peakWeekday === 0 && proposedOnly.monthlyCount === 0 && (
          <FootLine>{t('ai.load.none', '반복 규칙이 있는 업무가 없습니다') as string}</FootLine>
        )}
      </Foot>
    </Wrap>
  );
}
