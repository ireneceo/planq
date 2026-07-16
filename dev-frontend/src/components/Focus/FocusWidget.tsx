// FocusWidget — 좌측 사이드바 SidebarClock 아래 상시 위젯 (사이클 N+26)
//
// 4-상태 머신: idle / active / paused / idle_detected
// 사용자 focus_enabled=false 면 컴포넌트 자체 렌더 X (zero overhead)
//
// 사이드바 어두운 배경 (#115E59~#134E4A teal gradient) 위에서 시인성 확보를 위해
// 밝은 톤 사용. light bg 의 FocusWidget 은 settings/profile 페이지 inline 변형.

import React, { useEffect, useState, useCallback, useRef } from 'react';
import styled, { keyframes, css } from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useChromeNav } from '../../hooks/useChromeNav';
import ChromeLink from '../Tab/ChromeLink';
import { apiFetch } from '../../contexts/AuthContext';
import { useActivityTracker } from '../../hooks/useActivityTracker';

interface FocusSession {
  id: number;
  user_id: number;
  business_id: number;
  task_id: number | null;
  state: 'active' | 'paused';
  started_at: string;
  paused_at: string | null;
  pause_total_sec: number;
  actual_seconds: number;
  // 같은 task 의 종료된 세션 누적 (재개 시 이어서 표시 — 운영 #17-2)
  task_accumulated_seconds?: number;
  auto_paused: boolean;
  task: { id: number; title: string; status: string; project_id: number | null } | null;
}

interface Props { isCollapsed?: boolean; }

const FocusWidget: React.FC<Props> = ({ isCollapsed }) => {
  const { t } = useTranslation('focus');
  // useAuth 제거 — N+49 hotfix 로 onStart 제거 후 user 미사용
  const navigate = useChromeNav();

  // user.focus_enabled 가 아직 응답에 없으면 server settings 한 번 fetch
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [idleMin, setIdleMin] = useState(15);
  const [autoPauseMin, setAutoPauseMin] = useState(30);
  const [session, setSession] = useState<FocusSession | null>(null);
  const [tick, setTick] = useState(0);  // 매초 카운터 re-render 트리거 (값 자체는 카운터에 더하지 않음)
  // N+45 — 정확한 카운터 baseline. server fetch 시점의 actual_seconds + Date.now() ms 차이로 계산
  // (옛 로직: actual_seconds + tick → 30초마다 server fetch 가 actual_seconds 30 증가시키는데 tick reset 안 돼서
  //  카운터가 빨라지다가 점프하는 회귀)
  const baselineRef = useRef<{ actualSec: number; at: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [idlePromptVisible, setIdlePromptVisible] = useState(false);
  const idleStartRef = useRef<number | null>(null);

  // 초기 fetch — settings 와 current session 병렬
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sR = await apiFetch('/api/focus/settings');
        const sJ = await sR.json();
        if (cancelled) return;
        if (sJ.success) {
          setEnabled(!!sJ.data.focus_enabled);
          setIdleMin(Number(sJ.data.focus_idle_min) || 15);
          setAutoPauseMin(Number(sJ.data.focus_auto_pause_min) || 30);
        }
      } catch { setEnabled(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  // N+63 — 설정 변경 시 즉시 반영 (FocusSettingsCard 가 dispatchEvent). 새로고침 없이 위젯 표시/숨김.
  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      if (typeof detail.focus_enabled === 'boolean') setEnabled(detail.focus_enabled);
      if (detail.focus_idle_min !== undefined) setIdleMin(Number(detail.focus_idle_min) || 15);
      if (detail.focus_auto_pause_min !== undefined) setAutoPauseMin(Number(detail.focus_auto_pause_min) || 30);
    };
    window.addEventListener('focus:settings-changed', onChange);
    return () => window.removeEventListener('focus:settings-changed', onChange);
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
    // 매 30초 server sync (다중 디바이스 안전)
    const id = window.setInterval(loadCurrent, 30000);
    return () => window.clearInterval(id);
  }, [enabled, loadCurrent]);

  // N+92 — 실시간 반영 (CLAUDE.md §16). 사용자 호소(피드백 ID 15/16):
  //   "업무 완료/다른 업무 시작 시 좌측 [포커스 중] 배너가 즉시 안 바뀌고 앱을 껐다 켜야 바뀜".
  //   원인: 30초 폴링만 있고 이벤트 listener 부재. task status 전이가 backend 에서 focus session 을
  //   전환/종료하고 'inbox:refresh' (TaskDetailDrawer 워크플로 액션) + 'focus:refresh' 를 dispatch 하므로
  //   여기서 받아 즉시 loadCurrent() → 완료 시 배너 사라짐 / 전환 시 새 업무로 즉시 갱신.
  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    const onRefresh = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(loadCurrent, 250);  // 250ms debounce (연속 이벤트 합치기)
    };
    window.addEventListener('inbox:refresh', onRefresh);
    window.addEventListener('focus:refresh', onRefresh);
    return () => {
      if (timer) window.clearTimeout(timer);
      window.removeEventListener('inbox:refresh', onRefresh);
      window.removeEventListener('focus:refresh', onRefresh);
    };
  }, [enabled, loadCurrent]);

  // baseline 갱신 — session.actual_seconds 가 server fetch 로 바뀔 때마다 그 시점을 기록.
  // 카운터는 baseline.actualSec + (Date.now - baseline.at) 으로 계산 (정확한 단조 증가).
  useEffect(() => {
    if (!session) { baselineRef.current = null; return; }
    // 누적(이전 종료 세션 합) + 현재 세션 경과 — 재개 시 0 부터가 아니라 이어짐.
    baselineRef.current = { actualSec: session.actual_seconds + (session.task_accumulated_seconds || 0), at: Date.now() };
  }, [session?.id, session?.state, session?.actual_seconds, session?.task_accumulated_seconds]);

  // 1초마다 tick — 카운터 re-render 트리거 (active 일 때만). 값은 baselineRef + Date 차이로 계산.
  useEffect(() => {
    if (!session || session.state !== 'active') return;
    const id = window.setInterval(() => setTick(t => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [session]);

  // heartbeat — 30초 throttle (active 일 때만)
  useEffect(() => {
    if (!session || session.state !== 'active') return;
    const id = window.setInterval(async () => {
      try { await apiFetch('/api/focus/heartbeat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: session.id }) }); } catch { /* noop */ }
    }, 30000);
    return () => window.clearInterval(id);
  }, [session?.id, session?.state]);

  // 유휴 감지 — idleMin 초과 시 prompt 표시 (auto-pause 는 별도 timer)
  useActivityTracker({
    idleMinutes: idleMin,
    enabled: enabled === true && session?.state === 'active',
    onIdle: () => {
      idleStartRef.current = Date.now();
      setIdlePromptVisible(true);
    },
    onActive: () => {
      // 활동 복귀 — prompt 유지 (사용자가 명시 선택 필요)
    },
  });

  // 자동 일시정지 — autoPauseMin 초과 + 활성 시
  useEffect(() => {
    if (!enabled || !session || session.state !== 'active') return;
    const id = window.setInterval(async () => {
      if (!idleStartRef.current) return;
      const idleSec = Math.floor((Date.now() - idleStartRef.current) / 1000);
      if (idleSec >= autoPauseMin * 60) {
        try {
          const r = await apiFetch('/api/focus/pause', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: session.id, reason: 'auto_idle' }),
          });
          const j = await r.json();
          if (j.success) setSession(j.data);
          idleStartRef.current = null;
          setIdlePromptVisible(false);
        } catch { /* noop */ }
      }
    }, 30000);
    return () => window.clearInterval(id);
  }, [enabled, session, autoPauseMin]);

  // idle prompt 액션
  const onIdleDiscard = useCallback(async () => {
    if (!session || !idleStartRef.current) return;
    const idleSec = Math.floor((Date.now() - idleStartRef.current) / 1000);
    setSubmitting(true);
    try {
      const r = await apiFetch('/api/focus/idle-discard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: session.id, idle_seconds: idleSec }),
      });
      const j = await r.json();
      if (j.success) setSession(j.data);
    } finally {
      setSubmitting(false);
      idleStartRef.current = null;
      setIdlePromptVisible(false);
    }
  }, [session]);

  const onIdleKeep = useCallback(() => {
    idleStartRef.current = null;
    setIdlePromptVisible(false);
  }, []);

  // ─── 액션 ───
  const action = useCallback(async (path: string, body: Record<string, unknown>) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const r = await apiFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (j.success) setSession(j.data || null);
    } finally { setSubmitting(false); }
  }, [submitting]);

  // N+49 hotfix — onStart 제거. N+32 옵션 A 박제: task status 'in_progress' 진입이 Focus auto start trigger.
  // Focus 자체로 task 없이 시작하면 orphan session — 의미 없음. 사용자 호소 "업무 미지정인데 작동" 회귀 차단.
  const onPause = () => session && action('/api/focus/pause', { session_id: session.id, reason: 'manual' });
  const onResume = () => session && action('/api/focus/resume', { session_id: session.id });
  // N+63 — orphan 만 명시적 stop. N+32 옵션 B 박제 정합: task status 가 종료 책임 — 하지만
  // task 가 사라진 orphan 은 trigger 자체가 불가능한 좀비 상태. 사용자가 "계속 나오잖아" 호소.
  // 일반 active/paused session 에는 stop 버튼 노출 X (옵션 B 박제 유지).
  const onStopOrphan = async () => {
    if (!session || session.task_id) return;
    await action('/api/focus/stop', { session_id: session.id, end_reason: 'orphan_dismiss' });
    setSession(null);  // 즉시 위젯에서 사라짐
  };
  const onView = () => session?.task_id && navigate(`/tasks?task=${session.task_id}`);

  if (enabled === null) return null;  // loading
  if (!enabled) return null;  // 비활성 — zero overhead

  // 카운터 실시간 계산 — baseline 시점 (server fetch) 부터 Date.now() 경과 ms 더해서 표시.
  // tick state 는 매초 re-render 만 트리거 (값 자체는 카운터에 더하지 않음 — 30s sync 시점 double-count 버그 차단).
  void tick;
  const accumSec = session?.task_accumulated_seconds || 0;
  const liveSeconds = (() => {
    if (!session) return 0;
    // baselineRef.actualSec 은 이미 누적 포함. paused/기타 상태는 누적 + 현재 세션.
    if (session.state !== 'active') return session.actual_seconds + accumSec;
    const base = baselineRef.current;
    if (!base) return session.actual_seconds + accumSec;
    return base.actualSec + Math.floor((Date.now() - base.at) / 1000);
  })();

  if (isCollapsed) {
    // collapsed: 12px dot
    const state = !session ? 'idle' : session.auto_paused ? 'idle_detected' : session.state;
    return (
      <CollapsedDot $state={state} title={t('widget.title') as string} aria-label={t(`widget.state.${state}`) as string}>
        <DotInner $state={state} />
      </CollapsedDot>
    );
  }

  // N+49 hotfix — idle 상태 (session 없음). N+32 옵션 A: Focus 는 task status 가 trigger.
  // 위젯에서 직접 Start X. 안내 + Q Task 진입점 link (옵션 B — 사용자 학습 + 진입).
  if (!session) {
    return (
      <Wrap>
        <WidgetHeader>
          <Dot $state="idle" />
          <Label>{t('widget.title')}</Label>
        </WidgetHeader>
        <SubText>{t('widget.idleHint', 'Q Task 에서 "진행 시작"을 누르면 시간이 자동 추적돼요.')}</SubText>
        <Actions>
          <GotoLink to="/tasks" title={t('widget.gotoTasks', '내 업무로 가기') as string}>
            <SvgExternal /> {t('widget.gotoTasks', '내 업무로 가기')}
          </GotoLink>
        </Actions>
      </Wrap>
    );
  }

  const isPaused = session.state === 'paused';
  const isIdle = session.auto_paused;

  return (
    <Wrap aria-live="polite">
      <WidgetHeader>
        <Dot $state={isIdle ? 'idle_detected' : isPaused ? 'paused' : 'active'} />
        <Label>{t(`widget.state.${isIdle ? 'idle_detected' : isPaused ? 'paused' : 'active'}`)}</Label>
        <ElapsedMini>{formatStartTime(session.started_at, t)}</ElapsedMini>
      </WidgetHeader>
      {session.task ? (
        <TaskTitle as="button" type="button" $clickable title={session.task.title} onClick={onView}>
          {session.task.title}
        </TaskTitle>
      ) : (
        <>
          <TaskTitle as="span">{t('widget.noTask', '업무 미지정')}</TaskTitle>
          <SubText>{t('widget.noTaskHint', '이 세션의 업무가 사라졌어요. 다른 업무를 시작하면 자동 전환됩니다.')}</SubText>
          {/* N+63 — orphan dismiss. 사용자 호소 "계속 나오잖아" — task 없는 좀비 session 명시 종료 경로 */}
          <SecondaryBtn type="button" onClick={onStopOrphan} disabled={submitting} style={{ marginTop: 6 }}>
            {t('widget.dismissOrphan', '이 세션 종료')}
          </SecondaryBtn>
        </>
      )}
      <Counter aria-label={t('widget.elapsedAria', { seconds: liveSeconds }) as string}>
        {formatDuration(liveSeconds)}
      </Counter>
      <Actions>
        {/* N+49 hotfix — Stop(DangerBtn) 제거. N+32 옵션 B 박제: 종료는 task status 가 책임 (in_progress 이탈 시 자동 stop).
            TaskFocusBar 는 이미 제거됐는데 FocusWidget 만 남아있던 회귀. 빨간 배경 + Resume 녹색과 시각 충돌 호소 +
            사용자 의미 혼란 ("완료? 종료?") 차단. pause/resume 만 유지 (micro state). */}
        {isPaused ? (
          <PrimaryBtn type="button" onClick={onResume} disabled={submitting} title={t('widget.resume') as string}>
            <SvgPlay /> {t('widget.resume')}
          </PrimaryBtn>
        ) : (
          <SecondaryBtn type="button" onClick={onPause} disabled={submitting} title={t('widget.pause') as string} aria-label={t('widget.pause') as string}>
            <SvgPause />
          </SecondaryBtn>
        )}
        {session.task && (
          <ViewBtn type="button" onClick={onView} title={t('widget.view') as string} aria-label={t('widget.view') as string}>
            <SvgExternal />
          </ViewBtn>
        )}
      </Actions>
      {idlePromptVisible && (
        <IdlePrompt>
          <IdlePromptText>{t('widget.idleDetectedTitle', '자리 비우셨나요?')}</IdlePromptText>
          <IdlePromptDesc>{t('widget.idleDetectedDesc', { min: idleMin, defaultValue: '{{min}}분 동안 활동이 없어요' })}</IdlePromptDesc>
          <IdlePromptActions>
            <IdleBtnPrimary type="button" onClick={onIdleDiscard} disabled={submitting}>
              {t('widget.idleDiscard', '그 시간 빼기')}
            </IdleBtnPrimary>
            <IdleBtnSecondary type="button" onClick={onIdleKeep} disabled={submitting}>
              {t('widget.idleKeep', '계속 진행')}
            </IdleBtnSecondary>
          </IdlePromptActions>
        </IdlePrompt>
      )}
    </Wrap>
  );
};

export default FocusWidget;

// ─── utils ─────────────────────────────────────────────────────
function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m ${String(s).padStart(2, '0')}s`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}
function formatStartTime(iso: string, t: (k: string, opts?: Record<string, unknown>) => unknown): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return t('widget.startedAt', { time: `${hh}:${mm}` }) as string;
}

// ─── icons (minimal feather) ───────────────────────────────────
const SvgPlay = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>;
const SvgPause = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>;
const SvgExternal = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>;

// ─── motion ─────────────────────────────────────────────────────
const breath = keyframes`0% { transform: scale(1); } 50% { transform: scale(1.15); } 100% { transform: scale(1); }`;
const pulseAlert = keyframes`0% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.25); opacity: 0.6; } 100% { transform: scale(1); opacity: 1; }`;

// ─── styled (사이드바 어두운 bg 위) ─────────────────────────────
const Wrap = styled.div`
  margin: -2px -4px 12px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  display: flex; flex-direction: column; gap: 6px;
  transition: background 0.15s, border-color 0.15s;
  &:hover { background: rgba(255, 255, 255, 0.08); }
`;
const WidgetHeader = styled.div`
  display: flex; align-items: center; gap: 6px;
`;
type DotState = 'idle' | 'active' | 'paused' | 'idle_detected';
const DOT_COLOR: Record<DotState, string> = {
  idle: '#CBD5E1',
  active: '#5EEAD4',      // sidebar bg 가 teal 700 — teal 200 로 시인성
  paused: '#FCD34D',
  idle_detected: '#FCD34D',
};
const Dot = styled.span<{ $state: DotState }>`
  width: 8px; height: 8px; border-radius: 50%;
  background: ${p => DOT_COLOR[p.$state]};
  flex-shrink: 0;
  ${p => p.$state === 'active' && css`animation: ${breath} 1.6s ease-in-out infinite;`}
  ${p => p.$state === 'idle_detected' && css`animation: ${pulseAlert} 1.2s ease-in-out infinite;`}
`;
const Label = styled.span`
  font-size: 11px; font-weight: 700; letter-spacing: 0.2px;
  color: rgba(255, 255, 255, 0.85);
  text-transform: uppercase;
`;
const ElapsedMini = styled.span`
  margin-left: auto;
  font-size: 10px; font-weight: 500;
  color: rgba(255, 255, 255, 0.5);
  font-variant-numeric: tabular-nums;
`;
const SubText = styled.div`
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);
  line-height: 1.35;
`;
const TaskTitle = styled.div<{ $clickable?: boolean }>`
  font-size: 13px; font-weight: 600;
  color: #FFFFFF;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  letter-spacing: -0.1px;
  ${p => p.$clickable && css`
    cursor: pointer;
    background: none; border: none; padding: 0;
    text-align: left; width: 100%;
    transition: color 0.15s, text-decoration 0.15s;
    &:hover { color: #99F6E4; text-decoration: underline; }
    &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; border-radius: 4px; }
  `}
`;
const Counter = styled.div`
  font-size: 12px; font-weight: 600;
  color: rgba(255, 255, 255, 0.75);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0;
  min-width: 6ch;
`;
const Actions = styled.div`
  display: flex; gap: 6px; margin-top: 2px;
`;
const baseBtn = css`
  display: inline-flex; align-items: center; justify-content: center;
  gap: 4px;
  height: 28px; padding: 0 10px;
  border-radius: 6px;
  font-size: 11px; font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 0.12s, color 0.12s, transform 0.08s;
  &:disabled { opacity: 0.5; cursor: not-allowed; }
  &:active:not(:disabled) { transform: scale(0.96); }
  &:focus-visible { outline: 2px solid rgba(94, 234, 212, 0.5); outline-offset: 1px; }
`;
const PrimaryBtn = styled.button`
  ${baseBtn}
  background: #14B8A6; color: #FFFFFF;
  flex: 1;
  &:hover:not(:disabled) { background: #0D9488; }
`;
const SecondaryBtn = styled.button`
  ${baseBtn}
  width: 28px; padding: 0;
  background: rgba(255, 255, 255, 0.1); color: #FFFFFF;
  &:hover:not(:disabled) { background: rgba(255, 255, 255, 0.18); }
`;
const ViewBtn = styled.button`
  ${baseBtn}
  width: 28px; padding: 0;
  background: rgba(255, 255, 255, 0.06); color: rgba(255, 255, 255, 0.7);
  &:hover { background: rgba(255, 255, 255, 0.12); color: #FFFFFF; }
`;
// N+49 hotfix — idle 상태 안내 + Q Task 진입 link (button 아닌 Link — 자연스러운 navigation)
const GotoLink = styled(ChromeLink)`
  ${baseBtn}
  text-decoration: none;
  background: rgba(255, 255, 255, 0.1); color: #FFFFFF;
  &:hover { background: rgba(255, 255, 255, 0.18); color: #FFFFFF; }
  svg { flex-shrink: 0; }
`;
const CollapsedDot = styled.button<{ $state: DotState }>`
  width: 36px; height: 36px;
  margin: 4px auto 12px;
  display: flex; align-items: center; justify-content: center;
  background: transparent; border: none; cursor: pointer; padding: 0;
  border-radius: 50%;
  &:hover { background: rgba(255, 255, 255, 0.08); }
`;
const DotInner = styled.span<{ $state: DotState }>`
  display: inline-block;
  width: 12px; height: 12px; border-radius: 50%;
  background: ${p => DOT_COLOR[p.$state]};
  ${p => p.$state === 'active' && css`animation: ${breath} 1.6s ease-in-out infinite;`}
  ${p => p.$state === 'idle_detected' && css`animation: ${pulseAlert} 1.2s ease-in-out infinite;`}
`;

// Idle prompt — 유휴 감지 시 사이드바 위젯 내부에 인라인 표시
const IdlePrompt = styled.div`
  margin-top: 8px; padding: 10px;
  background: rgba(252, 211, 77, 0.15);
  border: 1px solid rgba(252, 211, 77, 0.4);
  border-radius: 6px;
  display: flex; flex-direction: column; gap: 6px;
  animation: ip-in 0.18s ease-out;
  @keyframes ip-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
`;
const IdlePromptText = styled.div`
  font-size: 11px; font-weight: 700;
  color: #FCD34D;
`;
const IdlePromptDesc = styled.div`
  font-size: 11px; font-weight: 500;
  color: rgba(255, 255, 255, 0.75);
`;
const IdlePromptActions = styled.div`
  display: flex; gap: 4px; margin-top: 2px;
`;
const IdleBtnPrimary = styled.button`
  flex: 1; height: 26px; padding: 0 8px;
  background: #FCD34D; color: #92400E;
  border: none; border-radius: 5px;
  font-size: 11px; font-weight: 700; cursor: pointer;
  &:hover:not(:disabled) { background: #FBBF24; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const IdleBtnSecondary = styled.button`
  flex: 1; height: 26px; padding: 0 8px;
  background: rgba(255, 255, 255, 0.1); color: #FFFFFF;
  border: none; border-radius: 5px;
  font-size: 11px; font-weight: 600; cursor: pointer;
  &:hover:not(:disabled) { background: rgba(255, 255, 255, 0.18); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
