// FirstVisitTour — 페이지 첫 방문 시 핵심 요소 spotlight 가이드.
// 30년차 UX 원칙:
//   - 핵심 1~3개만 (인지 부하 회피)
//   - localStorage 1회 후 자동 dismiss
//   - 우상단 ? 버튼으로 다시 보기 가능 (외부에서 forceShow prop 으로 트리거)
//   - 모든 단계에 "건너뛰기" 출구
import React, { useEffect, useState, useRef, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';

export interface TourStep {
  targetSelector: string;            // querySelector 대상
  title: string;
  body: string;
  placement?: 'top' | 'bottom' | 'auto';
}

export interface FirstVisitTourProps {
  pageKey: string;                   // localStorage 식별 (예: 'qtask', 'inbox')
  steps: TourStep[];
  forceShow?: boolean;               // 우상단 ? 클릭 시 강제 표시
  onClose?: () => void;
}

const STORAGE_PREFIX = 'planq_tour_';

const FirstVisitTour: React.FC<FirstVisitTourProps> = ({ pageKey, steps, forceShow, onClose }) => {
  const { t } = useTranslation('common');
  const [active, setActive] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);

  // 진입 결정 — localStorage 체크 또는 forceShow
  useEffect(() => {
    if (forceShow) { setActive(true); setStepIdx(0); return; }
    try {
      if (localStorage.getItem(STORAGE_PREFIX + pageKey)) return;
    } catch { /* ignore */ }
    // 첫 마운트 후 페이지 안정화 대기 (200ms — DOM 생성 여유)
    const tm = window.setTimeout(() => setActive(true), 200);
    return () => window.clearTimeout(tm);
  }, [pageKey, forceShow]);

  // 현재 step 의 target rect 측정
  useEffect(() => {
    if (!active) { setRect(null); return; }
    const step = steps[stepIdx];
    if (!step) return;
    const el = document.querySelector(step.targetSelector) as HTMLElement | null;
    if (!el) {
      // target 못 찾으면 step skip
      setRect(null);
      return;
    }
    targetRef.current = el;
    el.setAttribute('data-tour-active', 'true');
    const update = () => setRect(el.getBoundingClientRect());
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      el.removeAttribute('data-tour-active');
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [active, stepIdx, steps]);

  const close = useCallback((markDone: boolean) => {
    if (markDone) {
      try { localStorage.setItem(STORAGE_PREFIX + pageKey, '1'); } catch { /* ignore */ }
    }
    setActive(false);
    setStepIdx(0);
    onClose?.();
  }, [pageKey, onClose]);

  const next = () => {
    if (stepIdx < steps.length - 1) setStepIdx(stepIdx + 1);
    else close(true);
  };

  // ESC 출구
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(true);
      if (e.key === 'ArrowRight' || e.key === 'Enter') next();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stepIdx]);

  if (!active) return null;
  const step = steps[stepIdx];
  if (!step) return null;

  // 풍선 위치 — target 아래 8px (자동), 화면 하단 가까우면 위로
  const balloonPos = (() => {
    if (!rect) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    const placement = step.placement || 'auto';
    const pad = 12;
    const balloonH = 160;
    const balloonW = 320;
    let top: number;
    if (placement === 'top') top = rect.top - balloonH - pad;
    else if (placement === 'bottom') top = rect.bottom + pad;
    else { // auto
      const spaceBelow = window.innerHeight - rect.bottom;
      top = spaceBelow > balloonH + pad ? rect.bottom + pad : rect.top - balloonH - pad;
    }
    let left = rect.left + rect.width / 2 - balloonW / 2;
    left = Math.max(16, Math.min(left, window.innerWidth - balloonW - 16));
    top = Math.max(16, top);
    return { top: `${top}px`, left: `${left}px`, transform: 'none' };
  })();

  return (
    <>
      <Backdrop onClick={() => close(true)} />
      {rect && (
        <TargetHighlight
          style={{
            top: rect.top - 4,
            left: rect.left - 4,
            width: rect.width + 8,
            height: rect.height + 8,
          }}
        />
      )}
      <Balloon style={balloonPos} role="dialog" aria-label={step.title}>
        <Title>{step.title}</Title>
        <Body>{step.body}</Body>
        <Footer>
          <Counter>{stepIdx + 1} / {steps.length}</Counter>
          <Actions>
            <SkipBtn type="button" onClick={() => close(true)}>
              {t('tour.skip', '건너뛰기')}
            </SkipBtn>
            <NextBtn type="button" onClick={next}>
              {stepIdx === steps.length - 1 ? t('tour.done', '완료') : t('tour.next', '다음')}
            </NextBtn>
          </Actions>
        </Footer>
      </Balloon>
    </>
  );
};

export default FirstVisitTour;

// ─── styled ───
const Backdrop = styled.div`
  position: fixed; inset: 0;
  background: rgba(15, 23, 42, 0.55);
  z-index: 9000;
  animation: tourFadeIn 0.2s ease-out;
  @keyframes tourFadeIn { from { opacity: 0; } to { opacity: 1; } }
`;
const TargetHighlight = styled.div`
  position: fixed;
  pointer-events: none;
  border: 3px solid #14B8A6;
  border-radius: 8px;
  box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.55);
  z-index: 9001;
  transition: top 0.2s, left 0.2s, width 0.2s, height 0.2s;
`;
const Balloon = styled.div`
  position: fixed;
  width: 320px;
  background: #FFFFFF;
  border-radius: 12px;
  padding: 16px 18px;
  box-shadow: 0 16px 32px rgba(15, 23, 42, 0.20);
  z-index: 9002;
  animation: tourPop 0.2s ease-out;
  @keyframes tourPop { from { transform: translateY(8px); opacity: 0.6; } to { transform: translateY(0); opacity: 1; } }
`;
const Title = styled.h3`
  font-size: 14px; font-weight: 700; color: #0F172A;
  margin: 0 0 6px; line-height: 1.4;
`;
const Body = styled.p`
  font-size: 13px; color: #334155;
  margin: 0 0 16px; line-height: 1.55;
`;
const Footer = styled.div`
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
`;
const Counter = styled.span`
  font-size: 11px; color: #94A3B8; font-weight: 600;
`;
const Actions = styled.div`
  display: inline-flex; gap: 8px;
`;
const SkipBtn = styled.button`
  background: transparent; border: none;
  font-size: 12px; font-weight: 500; color: #64748B;
  cursor: pointer; padding: 6px 10px;
  border-radius: 6px;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const NextBtn = styled.button`
  background: #14B8A6; border: none;
  color: #FFFFFF;
  font-size: 12px; font-weight: 600;
  padding: 8px 14px; border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
  &:hover { background: #0D9488; }
`;
