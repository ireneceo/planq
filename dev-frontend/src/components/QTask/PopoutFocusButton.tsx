// 팝아웃 행의 **시간 측정 컨트롤** (2026-09-10)
//   Irene: "굳이 상세 안들어가고 일을 알 수 있잖아."
//   로직은 hooks/useFocusControl 하나 — 여기는 그리기만 한다.
//
// ★ 2026-09-10 정정 — 상태가 **둘뿐이라 거짓말을 하고 있었다.**
//   Irene: "재개를 하는 상황인데 아예 시작도 안한 거랑 아이콘상태가 같잖아."
//   되돌아보면 running(참/거짓) 하나로 그렸으니 당연한 결과다. 상세(TaskFocusBar)는 같은 업무를
//   **포커스 중 / 잠시 멈춤 / 자리 비움 감지** 로 나눠 말하고 색까지 다르다.
//   그래서 여기도 셋으로 가르고, **낱말은 상세와 같은 사전(focus 네임스페이스)에서 읽는다** —
//   문구를 여기 새로 적으면 한쪽만 바뀌는 날 반드시 갈라진다.
//
//   | 상태   | 아이콘 | 누르면      | 색(상세와 동일)        |
//   |--------|--------|-------------|------------------------|
//   | active | ⏸      | 잠시 멈춤   | Teal  #14B8A6 / #F0FDFA |
//   | paused | ▶      | 재개        | Amber #FCD34D / #FFFBEB |
//   | idle   | ▶      | 시작        | 회색  #CBD5E1 / 투명    |
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { FocusState } from '../../hooks/useFocusControl';
import { FocusBtn } from './TaskPopoutView.styles';

interface Props {
  taskId: number;
  state: FocusState;
  /** 자리 비움으로 **자동** 멈춘 것 — 색은 paused 와 같고 말만 다르다(상세와 동일). */
  autoPaused?: boolean;
  busy: boolean;
  onToggle: () => void;
}

const PopoutFocusButton: React.FC<Props> = ({ taskId, state, autoPaused, busy, onToggle }) => {
  const { t } = useTranslation(['qtask', 'focus']);

  // 라벨 = **누르면 일어나는 일**. 제목(title)은 그 위에 지금 상태를 덧붙인다.
  const label = state === 'active'
    ? (t('focus:widget.pause', '잠시 멈춤') as string)
    : state === 'paused'
      ? (t('focus:widget.resume', '재개') as string)
      : (t('qtask:popout.act.start', '업무 시작') as string);

  const now = state === 'active'
    ? (t('focus:bar.activeTitle', '포커스 중') as string)
    : state === 'paused'
      ? (autoPaused
        ? (t('focus:bar.idleDetectedTitle', '자리 비움 감지') as string)
        : (t('focus:bar.pausedTitle', '잠시 멈춤') as string))
      : (t('qtask:popout.act.notStarted', '아직 시작 전') as string);

  return (
    <FocusBtn
      type="button"
      $tone={state}
      disabled={busy}
      data-testid="task-popout-focus"
      data-focus-state={state}
      data-task-id={taskId}
      aria-pressed={state === 'active'}
      aria-label={`${now} — ${label}`}
      title={`${now} — ${label}`}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
    >
      {state === 'active' ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.53.85l10-6.5a1 1 0 0 0 0-1.7l-10-6.5A1 1 0 0 0 8 5.5z" /></svg>
      )}
    </FocusBtn>
  );
};

export default PopoutFocusButton;
