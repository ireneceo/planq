// TaskFocusBar — TaskDetailDrawer 본문 상단에 표시되는 포커스 인라인 바 (사이클 N+26)
//
// 조건부 렌더 패턴:
//   focus_enabled=false  → null (렌더 X)
//   세션 없음            → "포커스 시작" CTA
//   이 task 의 active    → 카운터 + 일시정지/종료
//   이 task 의 paused    → "잠시 멈춤" 라벨 + 재개/종료
//   다른 task active     → "다른 업무 진행 중" 안내 + 전환 버튼
//
// 4가지 상태 모두 시각적으로 명확한 톤 차이 — sidebar FocusWidget 의 light-bg 변형.

import React, { useEffect, useState, useCallback } from 'react';
import styled, { keyframes, css } from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';

interface FocusSession {
  id: number;
  task_id: number | null;
  state: 'active' | 'paused';
  started_at: string;
  pause_total_sec: number;
  actual_seconds: number;
  auto_paused: boolean;
  task: { id: number; title: string } | null;
}

interface Props {
  taskId: number;
  businessId: number;
}

const TaskFocusBar: React.FC<Props> = ({ taskId, businessId }) => {
  const { t } = useTranslation('focus');
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [session, setSession] = useState<FocusSession | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [tick, setTick] = useState(0);

  // 초기 fetch
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sR = await apiFetch('/api/focus/settings');
        const sJ = await sR.json();
        if (cancelled) return;
        if (sJ.success) setEnabled(!!sJ.data.focus_enabled);
      } catch { setEnabled(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const loadCurrent = useCallback(async () => {
    try {
      const r = await apiFetch('/api/focus/current');
      const j = await r.json();
      if (j.success) setSession(j.data || null);
    } catch { /* noop */ }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    loadCurrent();
    const id = window.setInterval(loadCurrent, 30000);
    return () => window.clearInterval(id);
  }, [enabled, loadCurrent]);

  useEffect(() => {
    if (!session || session.state !== 'active' || session.task_id !== taskId) return;
    const id = window.setInterval(() => setTick(t => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [session, taskId]);

  const act = useCallback(async (path: string, body: Record<string, unknown>) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const r = await apiFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (j.success) setSession(j.data || null);
    } finally { setSubmitting(false); }
  }, [submitting]);

  const onStart = () => act('/api/focus/start', { business_id: businessId, task_id: taskId });
  const onSwitch = () => act('/api/focus/start', { business_id: businessId, task_id: taskId });
  const onPause = () => session && act('/api/focus/pause', { session_id: session.id, reason: 'manual' });
  const onResume = () => session && act('/api/focus/resume', { session_id: session.id });
  const onStop = () => session && act('/api/focus/stop', { session_id: session.id, end_reason: 'manual' });

  if (enabled === null) return null;
  if (!enabled) return null;  // 비활성 — 렌더 X

  // 활성 세션이 다른 task 인가?
  const isOtherTask = session && session.task_id && session.task_id !== taskId;

  // 1) 세션 없음 — start CTA
  if (!session) {
    return (
      <Bar $tone="idle">
        <ToneDot $tone="idle" />
        <Body>
          <Title>{t('bar.idleTitle', '아직 시작 안 했어요')}</Title>
          <Hint>{t('bar.idleHint', '이 업무로 포커스를 시작하면 실제 시간이 자동 누적돼요.')}</Hint>
        </Body>
        <Actions>
          <PrimaryBtn type="button" onClick={onStart} disabled={submitting}>
            <SvgPlay /> {t('bar.startThis', '이 업무로 시작')}
          </PrimaryBtn>
        </Actions>
      </Bar>
    );
  }

  // 2) 다른 task 진행 중
  if (isOtherTask) {
    return (
      <Bar $tone="other">
        <ToneDot $tone="other" />
        <Body>
          <Title>{t('bar.otherTitle', '다른 업무 진행 중')}</Title>
          <Hint title={session.task?.title}>
            {t('bar.otherHint', '"{{title}}" 에서 진행 중이에요. 전환하면 그 세션은 자동 종료됩니다.', { title: session.task?.title || t('widget.noTask') })}
          </Hint>
        </Body>
        <Actions>
          <PrimaryBtn type="button" onClick={onSwitch} disabled={submitting}>
            <SvgPlay /> {t('bar.switchToThis', '이 업무로 전환')}
          </PrimaryBtn>
        </Actions>
      </Bar>
    );
  }

  // 3) 이 task 진행 중 — active 또는 paused
  const liveSec = session.state === 'active' ? session.actual_seconds + tick : session.actual_seconds;
  const isPaused = session.state === 'paused';
  const isIdle = session.auto_paused;

  return (
    <Bar $tone={isIdle ? 'idle_detected' : isPaused ? 'paused' : 'active'} aria-live="polite">
      <ToneDot $tone={isIdle ? 'idle_detected' : isPaused ? 'paused' : 'active'} />
      <Body>
        <Title>
          {t(`bar.${isIdle ? 'idleDetectedTitle' : isPaused ? 'pausedTitle' : 'activeTitle'}`,
            isIdle ? '자리 비움 감지' : isPaused ? '잠시 멈춤' : '포커스 중')}
        </Title>
        <Counter>{formatDuration(liveSec)}</Counter>
      </Body>
      <Actions>
        {isPaused ? (
          <PrimaryBtn type="button" onClick={onResume} disabled={submitting}>
            <SvgPlay /> {t('widget.resume', '재개')}
          </PrimaryBtn>
        ) : (
          <SecondaryBtn type="button" onClick={onPause} disabled={submitting}>
            <SvgPause /> {t('widget.pause', '잠시 멈춤')}
          </SecondaryBtn>
        )}
        <DangerBtn type="button" onClick={onStop} disabled={submitting} title={t('widget.stop', '종료') as string} aria-label={t('widget.stop', '종료') as string}>
          <SvgStop />
        </DangerBtn>
      </Actions>
    </Bar>
  );
};

export default TaskFocusBar;

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m ${String(s).padStart(2, '0')}s`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

const SvgPlay = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>;
const SvgPause = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>;
const SvgStop = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>;

const breath = keyframes`0%{transform:scale(1)}50%{transform:scale(1.15)}100%{transform:scale(1)}`;
const pulseAlert = keyframes`0%{transform:scale(1);opacity:1}50%{transform:scale(1.25);opacity:0.6}100%{transform:scale(1);opacity:1}`;

type Tone = 'idle' | 'active' | 'paused' | 'idle_detected' | 'other';
const TONE: Record<Tone, { bg: string; border: string; dot: string; titleColor: string }> = {
  idle:          { bg: '#F8FAFC', border: '#E2E8F0', dot: '#94A3B8', titleColor: '#0F172A' },
  active:        { bg: '#F0FDFA', border: '#14B8A6', dot: '#14B8A6', titleColor: '#0F766E' },
  paused:        { bg: '#FFFBEB', border: '#FCD34D', dot: '#F59E0B', titleColor: '#B45309' },
  idle_detected: { bg: '#FFFBEB', border: '#F59E0B', dot: '#F59E0B', titleColor: '#92400E' },
  other:         { bg: '#EFF6FF', border: '#93C5FD', dot: '#3B82F6', titleColor: '#1E40AF' },
};

const Bar = styled.div<{ $tone: Tone }>`
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px;
  background: ${p => TONE[p.$tone].bg};
  border: 1px solid ${p => TONE[p.$tone].border};
  border-radius: 10px;
  margin: 0 20px 12px;
  transition: background 0.18s, border-color 0.18s;
`;
const ToneDot = styled.span<{ $tone: Tone }>`
  width: 10px; height: 10px; border-radius: 50%;
  background: ${p => TONE[p.$tone].dot};
  flex-shrink: 0;
  ${p => p.$tone === 'active' && css`animation: ${breath} 1.6s ease-in-out infinite;`}
  ${p => p.$tone === 'idle_detected' && css`animation: ${pulseAlert} 1.2s ease-in-out infinite;`}
`;
const Body = styled.div`flex: 1; min-width: 0;`;
const Title = styled.div`
  font-size: 13px; font-weight: 700; color: #0F172A;
  letter-spacing: -0.1px; margin-bottom: 2px;
`;
const Hint = styled.div`
  font-size: 12px; color: #475569; line-height: 1.45;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const Counter = styled.div`
  font-size: 13px; font-weight: 600; color: #334155;
  font-variant-numeric: tabular-nums;
`;
const Actions = styled.div`display: flex; gap: 6px; flex-shrink: 0;`;
const baseBtn = css`
  display: inline-flex; align-items: center; gap: 4px;
  height: 32px; padding: 0 12px;
  border-radius: 6px;
  font-size: 12px; font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 0.12s, transform 0.08s;
  &:disabled { opacity: 0.5; cursor: not-allowed; }
  &:active:not(:disabled) { transform: scale(0.96); }
  &:focus-visible { outline: 2px solid rgba(20,184,166,0.4); outline-offset: 2px; }
`;
const PrimaryBtn = styled.button`
  ${baseBtn}
  background: #14B8A6; color: #FFFFFF;
  &:hover:not(:disabled) { background: #0D9488; }
`;
const SecondaryBtn = styled.button`
  ${baseBtn}
  background: #FFFFFF; color: #334155;
  border-color: #CBD5E1;
  &:hover:not(:disabled) { background: #F8FAFC; border-color: #94A3B8; }
`;
const DangerBtn = styled.button`
  ${baseBtn}
  width: 32px; padding: 0; justify-content: center;
  background: transparent; color: #DC2626;
  border-color: #FECACA;
  &:hover:not(:disabled) { background: #FEF2F2; border-color: #DC2626; }
`;
