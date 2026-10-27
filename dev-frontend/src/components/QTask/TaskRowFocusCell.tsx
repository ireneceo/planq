// 목록 행의 «지금 작업중» 표시 + 시작/멈춤 버튼 (2026-10-27 · Fable 설계 A·B)
//
//   Irene: "진행중이 당장 지금 진행중이랑 일이 진행되고 있는 거랑 관리가 안되거든 …
//           ing 중인 건 [지금 작업중], 아닌 건 [진행중] 하다만거 … 이 버튼을 Q task 내업무>오늘 내업무,
//           이번주 내업무 리스트에도 넣는 건 어때?"
//
// ★ 판정은 hooks/useFocusControl.liveFor 하나다 — 팝아웃·목록·상세가 각자 판정하면 갈라진다.
// ★ 상태값은 그대로 in_progress — 글자와 점만 덧입힌다(필터·배지·집계는 손대지 않는다).
// ★ 버튼은 팝아웃의 PopoutFocusButton 을 그대로 쓴다(모양·낱말·색이 한 벌).
import React from 'react';
import styled, { keyframes } from 'styled-components';
import { useTranslation } from 'react-i18next';
import PopoutFocusButton from './PopoutFocusButton';
import type { useFocusControl } from '../../hooks/useFocusControl';

type FocusControl = ReturnType<typeof useFocusControl>;
interface TaskLike { id: number; status: string; assignee_id?: number | null }

/** 상태 칩 글자 — 지금 작업중이면 «● 지금 작업중», 아니면 원래 글자 그대로. */
export const LiveStatusText: React.FC<{ live: boolean; children: React.ReactNode }> = ({ live, children }) => {
  const { t } = useTranslation('qtask');
  if (!live) return <>{children}</>;
  return (
    <LiveWrap data-testid="task-working-now" title={t('popout.act.workingNowTip', '지금 이 업무를 하고 있어요 — 시간이 재지고 있어요. 다른 업무를 시작하면 이 업무는 «진행중» 으로 남아요.') as string}>
      <LiveDot aria-hidden="true" />{t('popout.act.workingNow', '지금 작업중')}
    </LiveWrap>
  );
};

/** 시작/멈춤 버튼 칸 — 낼 수 없는 행도 같은 폭을 남긴다(열이 흔들리지 않게). */
export const TaskRowFocusButton: React.FC<{ focus: FocusControl; task: TaskLike }> = ({ focus, task }) => (
  <Slot onClick={(e) => e.stopPropagation()}>
    {focus.canFocus(task) && (
      <PopoutFocusButton
        taskId={task.id}
        state={focus.stateFor(task)}
        autoPaused={focus.autoPausedFor(task)}
        busy={focus.busyTaskId === task.id}
        onToggle={() => { void focus.toggle(task); }}
      />
    )}
  </Slot>
);

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
`;
const LiveWrap = styled.span`
  display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;
`;
const LiveDot = styled.span`
  width: 6px; height: 6px; border-radius: 50%; background: #0F766E; flex-shrink: 0;
  animation: ${pulse} 1.6s ease-in-out infinite;
  @media (prefers-reduced-motion: reduce) { animation: none; }
`;
const Slot = styled.span`
  width: 36px; height: 36px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
`;
/** 폰 전용 — 상태 칸이 폰에서 숨으므로 제목 줄 오른쪽 끝에 둔다(Fable B · 눌리는 크기 36px). */
export const PhoneFocusSlot = styled.span`
  display: none;
  @media (max-width: 640px) { display: inline-flex; margin-left: auto; flex-shrink: 0; }
`;
