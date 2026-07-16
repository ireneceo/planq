// TaskFocusBar — TaskDetailDrawer 본문 상단 sticky 포커스 바 (사이클 N+26 신설, N+32 옵션 A 통합)
//
// 30년차 UX 옵션 A (통합 동기) — task status ↔ Focus 자동 동기:
//   - 본인이 담당자가 아니면 null (회귀 fix — 비담당자에게 진행/재개 버튼 보이던 회귀 차단)
//   - task status 변경이 Focus trigger — "이 업무로 시작" 수동 버튼 제거
//   - 일시정지/재개는 micro state (status 변경 X)
//   - focus_enabled=false 이면 안내 CTA (설정 페이지 링크) — 기능 발견성 강화
//
// 4가지 상태:
//   focus_enabled=false  → 안내 CTA + 설정 페이지 링크 (담당자 본인일 때만)
//   세션 없음            → 안내 ("진행 시작 버튼으로 자동 시작" 힌트)
//   이 task 의 active    → 큰 카운터 + 일시정지/완료
//   이 task 의 paused    → "잠시 멈춤" + 재개/완료

import React, { useEffect, useState, useCallback, useRef } from 'react';
import styled, { keyframes, css } from 'styled-components';
import { useTranslation } from 'react-i18next';
import ChromeLink from '../Tab/ChromeLink';
import { useAuth, apiFetch } from '../../contexts/AuthContext';

interface FocusSession {
  id: number;
  task_id: number | null;
  state: 'active' | 'paused';
  started_at: string;
  pause_total_sec: number;
  actual_seconds: number;
  task_accumulated_seconds?: number;
  auto_paused: boolean;
  task: { id: number; title: string } | null;
}

interface Props {
  taskId: number;
  // businessId 는 N+32 후속 (옵션 B) 단순화에서 사용 X 됐지만 호출처 호환 유지를 위해 선택 prop. 향후 제거 가능.
  businessId?: number;
  // N+32 — 담당자 가드. 본인이 담당자 아니면 Focus UI null.
  assigneeId?: number | null;
  // N+32 후속 (옵션 B) — task.status 의존. 'in_progress' 일 때만 일시정지/재개 노출.
  status?: string;
}

const TaskFocusBar: React.FC<Props> = ({ taskId, businessId, assigneeId, status }) => {
  const { t } = useTranslation('focus');
  const { user } = useAuth();
  const myId = user?.id ? Number(user.id) : 0;
  const iAmAssignee = !!assigneeId && Number(assigneeId) === myId;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [session, setSession] = useState<FocusSession | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [tick, setTick] = useState(0);
  // N+45 패턴(FocusWidget 통일) — baseline = (누적 + 현재세션 actual) 캡처 시점.
  // liveSec = baseline.actualSec + (Date.now - baseline.at). 옛 actual_seconds+tick 은 30s sync 시 이중계산(운영 #17-1).
  const baselineRef = useRef<{ actualSec: number; at: number } | null>(null);

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

  // N+49-3 — status 변경 시 즉시 re-fetch. status 'in_progress' 진입/이탈 시 backend 가 focus session 만들거나 끊는데
  // 30s polling 으로 기다리면 사용자 인지로 "사라졌다 나옴" 깜빡임 회귀. 즉시 동기화로 차단.
  useEffect(() => {
    if (!enabled) return;
    loadCurrent();
  }, [status, enabled, loadCurrent]);

  useEffect(() => {
    if (!session || session.state !== 'active' || session.task_id !== taskId) return;
    const id = window.setInterval(() => setTick(t => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [session, taskId]);

  // baseline 갱신 — server fetch 로 actual_seconds/누적 이 바뀔 때마다 그 시점 기록.
  useEffect(() => {
    if (!session) { baselineRef.current = null; return; }
    baselineRef.current = { actualSec: session.actual_seconds + (session.task_accumulated_seconds || 0), at: Date.now() };
  }, [session?.id, session?.state, session?.actual_seconds, session?.task_accumulated_seconds]);

  const act = useCallback(async (path: string, body: Record<string, unknown>) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const r = await apiFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (j.success) {
        setSession(j.data || null);
        // #105 — pause 시 backend 가 task.actual_hours 를 재계산하므로 드로어/위젯이 즉시 반영하게 알림
        try { window.dispatchEvent(new CustomEvent('focus:refresh')); } catch { /* noop */ }
      }
    } finally { setSubmitting(false); }
  }, [submitting]);

  const onPause = () => session && act('/api/focus/pause', { session_id: session.id, reason: 'manual' });
  const onResume = () => session && act('/api/focus/resume', { session_id: session.id });
  // N+93 (#16#3) — 이 task 로 포커스 시작/재개 (다른 task 로 갔거나 세션 없을 때). 기존 active 세션은 backend 가 stop.
  const onStartFocus = () => act('/api/focus/start', { task_id: taskId, business_id: businessId });

  // N+32 후속 (옵션 B 정합) — 표시 조건 단순화:
  //   1. 담당자 본인만 (비담당자는 시간 측정 / 일시정지·재개 의미 X)
  //   2. status === 'in_progress' 일 때만 (진행중이 아니면 Focus 의미 X)
  //   3. focus_enabled=false 면 안내 CTA + 설정 페이지 링크 (사용자 호소: 기본적으로 내용 나오게)
  //   4. session 의 다른 task / 종료 / 전환 / 세션없음 등 혼란 UI 모두 제거
  //   5. 일시정지/재개만 — task status 가 종료/완료/검토 단계의 진실 원천
  if (!iAmAssignee) return null;
  if (status !== 'in_progress') return null;
  if (enabled === null) return null;

  // focus_enabled=false — 안내 CTA + 설정 페이지 링크
  if (!enabled) {
    return (
      <Bar $tone="idle">
        <ToneDot $tone="idle" />
        <Body>
          <Title>{t('bar.disabledTitle', '포커스 꺼져 있어요')}</Title>
          <Hint>{t('bar.disabledHint', '내 업무 설정에서 포커스를 켜면 진행중에 시간이 자동 측정돼요.')}</Hint>
        </Body>
        <Actions>
          <CtaLink to="/me/work-settings">
            {t('bar.goToSettings', '설정으로 가기')} →
          </CtaLink>
        </Actions>
      </Bar>
    );
  }

  // N+93 (#16#3) — 이 task 가 in_progress 인데 포커스가 다른 task 로 갔거나 세션이 아직 없음
  //   → "이어서 작업" 으로 이 task 포커스 재개 (옛 코드는 return null 이라 재개 방법이 없었음).
  if (!session || session.task_id !== taskId) {
    return (
      <Bar $tone="paused" aria-live="polite">
        <ToneDot $tone="paused" />
        <Body>
          <Title>{t('bar.resumeTitle', '이 업무 진행 중')}</Title>
          <Hint>{t('bar.resumeHint', '다른 업무로 포커스가 이동했어요. 이어서 작업하면 시간 측정이 재개돼요.')}</Hint>
        </Body>
        <Actions>
          <PrimaryBtn type="button" onClick={onStartFocus} disabled={submitting}>
            <SvgPlay /> {t('bar.resumeFocus', '이어서 작업')}
          </PrimaryBtn>
        </Actions>
      </Bar>
    );
  }

  // 이 task 진행 중 — active / paused / idle_detected
  void tick; // 매초 re-render 트리거용 (값은 baseline + Date 차이로 계산 — 이중계산 차단)
  const accumSec = session.task_accumulated_seconds || 0;
  const liveSec = (() => {
    if (session.state !== 'active') return session.actual_seconds + accumSec;
    const base = baselineRef.current;
    if (!base) return session.actual_seconds + accumSec;
    return base.actualSec + Math.floor((Date.now() - base.at) / 1000);
  })();
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

const SvgPlay = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>;
const SvgPause = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>;
// SvgStop / DangerBtn 제거 — N+32 후속 (옵션 B): 종료 버튼은 task status 액션이 책임. Focus 자체 종료 X.

// N+32 — 설정 페이지로 가는 inline link (focus_enabled=false 시 CTA)
const CtaLink = styled(ChromeLink)`
  display: inline-flex; align-items: center; gap: 4px;
  padding: 8px 14px; height: 36px;
  background: #14B8A6; color: #FFFFFF;
  border-radius: 8px;
  text-decoration: none;
  font-size: 13px; font-weight: 600;
  transition: background 0.15s;
  &:hover { background: #0D9488; }
`;

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
  display: flex; align-items: center; gap: 14px;
  /* N+32 — 사용자 호소 "헤더 크게" 정합. sticky top 으로 drawer 본문 스크롤 시에도 항상 보임.
     padding/margin 키워 헤더처럼 강조.
     N+49-3 — top: 12px 띄움 (헤더 들러붙음 호소). 좌우 14px 로 Section 과 정합 (좌우 짧음 호소).
     sticky top: 0 그대로 — 스크롤 시 헤더 바로 아래 고정. */
  padding: 14px 18px;
  background: ${p => TONE[p.$tone].bg};
  border: 1px solid ${p => TONE[p.$tone].border};
  border-radius: 10px;
  margin: 12px 14px 14px;
  position: sticky;
  top: 0;
  z-index: 5;
  box-shadow: 0 2px 8px rgba(0,0,0,0.04);
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
  font-size: 14px; font-weight: 700; color: #0F172A;
  letter-spacing: -0.1px; margin-bottom: 3px;
`;
const Hint = styled.div`
  font-size: 12px; color: #475569; line-height: 1.45;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const Counter = styled.div`
  /* N+32 — 시간 강조. 사용자 의도 "크게" 정합. tabular-nums 로 안 흔들림. */
  font-size: 22px; font-weight: 700; color: #0F172A;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.5px;
  line-height: 1.1;
`;
const Actions = styled.div`display: flex; gap: 8px; flex-shrink: 0;`;
const baseBtn = css`
  /* N+32 — 사용자 의도 "버튼 크게". 36px 표준 (ActionButton 디자인 시스템 정합) */
  display: inline-flex; align-items: center; gap: 6px;
  height: 36px; padding: 0 14px;
  border-radius: 8px;
  font-size: 13px; font-weight: 600;
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
// DangerBtn 제거 — N+32 후속 (옵션 B): Focus 자체 종료 버튼 없음. task status 가 종료/완료 책임.
