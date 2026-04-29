// HelpDot — 페이지/섹션 헤더 옆 작은 ⓘ (도움말 인지 보조).
// 30년차 UX 원칙:
//   - 노이즈 0: hover 전엔 거의 안 보일 만큼 옅게
//   - 컨텍스트 우선: 그 화면·그 섹션의 정보만
//   - Cue 출구: 정적 안내로 안 풀리면 Cue 에게 자연어 질의로 연결 (askCue prop)
//   - 모바일: tap 으로 popover 토글, outside 탭 닫힘
import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';

export interface HelpDotProps {
  /** popover 본문. 1~3줄 권장 (string 또는 JSX) */
  children: React.ReactNode;
  /** Cue 자연어 질의 prefill 텍스트 — 클릭 시 우측 패널 Cue 챗에 prefill 후 열림 */
  askCue?: string;
  /** 작은 화면(좁은 헤더)에선 위 → 아래 자동 정렬. 고정하려면 'top'|'bottom' */
  placement?: 'top' | 'bottom' | 'auto';
  /** 호출 위치 식별 — 추후 분석 기반 자동 hint, FirstVisitTour 의 pageKey 와 연결 */
  topic?: string;
  /** topic 과 일치하는 FirstVisitTour 가 있을 때 "투어 다시 보기" 링크 표시 (D4.3) */
  tourPageKey?: string;
  className?: string;
}

const HelpDot: React.FC<HelpDotProps> = ({ children, askCue, placement = 'auto', tourPageKey, className }) => {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleAskCue = () => {
    if (!askCue) return;
    // 글로벌 이벤트 — Cue 챗 패널이 listen. 컨텍스트 prefill 후 열림.
    window.dispatchEvent(new CustomEvent('cue:ask', { detail: { prefill: askCue } }));
    setOpen(false);
  };

  return (
    <Anchor ref={ref} className={className}>
      <Trigger
        type="button"
        onClick={() => setOpen(v => !v)}
        onMouseEnter={() => setOpen(true)}
        aria-label={t('helpDot.ariaLabel', '도움말') as string}
        aria-expanded={open}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="13" />
          <circle cx="12" cy="16.5" r="0.5" fill="currentColor" />
        </svg>
      </Trigger>
      {open && (
        <Popover
          $placement={placement}
          role="tooltip"
          onMouseLeave={() => setOpen(false)}
        >
          <Body>{children}</Body>
          {askCue && (
            <AskCueLink type="button" onClick={handleAskCue}>
              <span>{t('helpDot.askCue', 'Cue 에게 자세히 묻기')}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
            </AskCueLink>
          )}
          {tourPageKey && (
            <ReplayTourLink type="button" onClick={() => {
              try { localStorage.removeItem(`planq_tour_${tourPageKey}`); } catch { /* */ }
              window.location.reload();
            }}>
              {t('tour.replay', '투어 다시 보기')}
            </ReplayTourLink>
          )}
        </Popover>
      )}
    </Anchor>
  );
};

export default HelpDot;

const Anchor = styled.span`
  position: relative;
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
`;
const Trigger = styled.button`
  width: 18px; height: 18px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent;
  border: none; border-radius: 50%;
  color: #94A3B8;
  cursor: pointer;
  padding: 0;
  transition: color 0.15s, background 0.15s;
  &:hover { color: #14B8A6; background: #F0FDFA; }
  &:focus-visible { outline: 2px solid rgba(20,184,166,0.3); outline-offset: 2px; }
`;
const Popover = styled.div<{ $placement: 'top' | 'bottom' | 'auto' }>`
  position: absolute;
  ${p => p.$placement === 'top' ? 'bottom: calc(100% + 8px);' : 'top: calc(100% + 8px);'}
  left: -8px;
  width: 240px;
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 10px;
  padding: 12px 14px;
  box-shadow: 0 4px 12px rgba(15,23,42,0.08);
  z-index: 200;
  font-size: 12px;
  color: #334155;
  line-height: 1.55;
  text-align: left;
  white-space: normal;
  cursor: default;
`;
const Body = styled.div`
  margin: 0;
`;
const AskCueLink = styled.button`
  display: inline-flex; align-items: center; gap: 4px;
  margin-top: 10px; padding: 0;
  background: transparent; border: none;
  font-size: 12px; font-weight: 600;
  color: #0D9488;
  cursor: pointer;
  &:hover { color: #0F766E; text-decoration: underline; }
`;
const ReplayTourLink = styled.button`
  display: block;
  margin-top: 6px; padding: 0;
  background: transparent; border: none;
  font-size: 11px; font-weight: 500;
  color: #94A3B8;
  cursor: pointer;
  &:hover { color: #475569; text-decoration: underline; }
`;
