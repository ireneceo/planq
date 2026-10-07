// 일정 시간대 안내 두 줄 — 등록 창 · 상세(보기·편집)가 **같은 부품**을 쓴다(2026-10-07).
//   ① «한국 표준시 기준 · 워크스페이스 시간대» — 입력·표시 시각의 기준
//   ② «내 시간 (말레이시아 시간): 10월 8일 (목) 오전 9:00 – 10:00» — 개인 업무 시간대가 다를 때만
//   Irene: "기본 시간은 서울로 하되 그게 몇 시인지 일정에서는 알게 해달라는 거야. 개인의 설정에 따라. 친절하게."
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { tzFriendlyName, formatRangeIn } from './calTz';

interface Props {
  wsTz: string;
  myTz?: string | null;
  startIso: string;
  endIso: string;
  /** data-testid 머리 — 등록 창 'new-event' · 상세 'event' */
  testIdPrefix: string;
}

const TzLines: React.FC<Props> = ({ wsTz, myTz, startIso, endIso, testIdPrefix }) => {
  const { t, i18n } = useTranslation('qcalendar');
  const at = new Date(startIso);
  const showMine = !!myTz && myTz !== wsTz && !!startIso && !!endIso;
  return (
    <Wrap data-testid={`${testIdPrefix}-tz`}>
      <Line data-testid={`${testIdPrefix}-tz-basis`}>
        {t('tz.workspaceBasisFriendly', { tz: tzFriendlyName(wsTz, i18n.language, at), defaultValue: '{{tz}} 기준 · 워크스페이스 시간대' }) as string}
      </Line>
      {showMine && myTz && (
        <Line $mine data-testid={`${testIdPrefix}-mytime`}>
          {t('tz.myTimeLine', {
            tz: tzFriendlyName(myTz, i18n.language, at),
            range: formatRangeIn(startIso, endIso, myTz, i18n.language),
            defaultValue: '내 시간 ({{tz}}): {{range}}',
          }) as string}
        </Line>
      )}
    </Wrap>
  );
};

export default TzLines;

const Wrap = styled.div`display: flex; flex-direction: column; gap: 2px; margin-top: 4px;`;
const Line = styled.div<{ $mine?: boolean }>`
  font-size: 0.75rem; line-height: 1.4;
  color: ${(p) => (p.$mine ? '#0F766E' : '#64748B')};
  font-weight: ${(p) => (p.$mine ? 600 : 400)};
`;
