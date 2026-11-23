// 근태 페이지 «출근·퇴근 확인 묻기» 아래 한 줄 — 지금 묻는가, 안 묻는다면 왜인가 (2026-11-23 Irene
//   «오늘 묻지 않는 이유를 찾아 고치거나, 안 뜨는 게 맞는 조건이면 그 조건을 화면(근태 페이지)에 알려 주세요»).
// 조건은 서버(GET /today 의 prompt_status)가 정한다 — 여기서 다시 계산하지 않는다.
// «다시 묻기» = 오늘 미룬 답(아직이에요·오늘은 안 해요)을 거두고 묻는 창을 다시 띄운다. 기록은 건드리지 않는다.
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { ATTENDANCE_REFRESH_EVENT, useAttendance } from '../../hooks/useAttendance';
import ActionButton from '../../components/Common/ActionButton';

function hhmm(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const PromptStatusLine: React.FC<{ bizId: number }> = ({ bizId }) => {
  const { t } = useTranslation('attendance');
  const a = useAttendance(bizId);
  const [busy, setBusy] = useState(false);
  const s = a.promptStatus;
  if (!s || s.state === 'off') return null;

  const canAskAgain = s.state === 'asking' || s.state === 'snoozed' || s.state === 'not_today';
  const askAgain = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (s.state === 'asking') window.dispatchEvent(new CustomEvent(ATTENDANCE_REFRESH_EVENT));
      else await a.answerPrompt('ask_again');
    } finally { setBusy(false); }
  };

  return (
    <Line data-testid="attn-prompt-status" data-state={s.state}>
      <span>
        {t(`settings.promptStatus.${s.state}`, {
          time: hhmm(s.until), from: hhmm(s.from), until: hhmm(s.until),
        })}
      </span>
      {canAskAgain && (
        <ActionButton tone="secondary" size="sm" loading={busy} onClick={askAgain} data-testid="attn-prompt-ask-again">
          {t('settings.promptStatus.askAgain')}
        </ActionButton>
      )}
    </Line>
  );
};

export default PromptStatusLine;

const Line = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  font-size: 0.75rem; color: #334155; line-height: 1.5;
`;
