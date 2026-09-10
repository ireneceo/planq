// 팝아웃 행의 **시작/중지** 컨트롤 (2026-09-10)
//   Irene: "굳이 상세 안들어가고 일을 알 수 있잖아."
//   로직은 hooks/useFocusControl 하나 — 여기는 그리기만 한다.
import React from 'react';
import { useTranslation } from 'react-i18next';
import { FocusBtn, FocusTime } from './TaskPopoutView.styles';

interface Props {
  taskId: number;
  running: boolean;
  busy: boolean;
  minutes: number;
  onToggle: () => void;
}

const PopoutFocusButton: React.FC<Props> = ({ taskId, running, busy, minutes, onToggle }) => {
  const { t } = useTranslation('qtask');
  return (
    <>
      <FocusBtn
        type="button"
        $running={running}
        disabled={busy}
        data-testid="task-popout-focus"
        data-task-id={taskId}
        aria-pressed={running}
        aria-label={running
          ? t('popout.act.stop', '업무 중지') as string
          : t('popout.act.start', '업무 시작') as string}
        title={running
          ? t('popout.act.stopTip', '중지 — 시간 측정을 멈춥니다') as string
          : t('popout.act.startTip', '시작 — 이 업무로 시간을 측정합니다') as string}
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
      >
        {running ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.53.85l10-6.5a1 1 0 0 0 0-1.7l-10-6.5A1 1 0 0 0 8 5.5z" /></svg>
        )}
      </FocusBtn>
      {running && minutes > 0 && (
        <FocusTime>{t('popout.act.running', '{{n}}분', { n: minutes }) as string}</FocusTime>
      )}
    </>
  );
};

export default PopoutFocusButton;
