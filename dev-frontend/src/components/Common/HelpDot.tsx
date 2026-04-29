// HelpDot — 페이지/섹션 헤더 옆 작은 ⓘ (도움말 인지 보조).
// 30년차 UX 원칙:
//   - 노이즈 0: hover 전엔 거의 안 보일 만큼 옅게
//   - 컨텍스트 우선: 그 화면·그 섹션의 정보만
//   - Cue 출구: 정적 안내로 안 풀리면 Cue 에게 자연어 질의로 연결 (askCue prop)
//   - 모바일: tap 으로 popover 토글, outside 탭 닫힘
//   - Portal 렌더 — 부모의 overflow:hidden 에 잘리지 않음 (Q Note 사이드바 등)
//   - Popover 본문 줄바꿈 (\n) 그대로 표시 (white-space: pre-line)
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';

export interface HelpDotProps {
  /** popover 본문. \n 으로 줄바꿈 가능 */
  children: React.ReactNode;
  /** Cue 자연어 질의 prefill 텍스트 */
  askCue?: string;
  /** 작은 화면 자동 정렬 — 'top'|'bottom' 강제 시 하단 잘림 방지 */
  placement?: 'top' | 'bottom' | 'auto';
  /** 호출 위치 식별 — 추후 분석/투어 연결 */
  topic?: string;
  /** topic 과 일치하는 FirstVisitTour 가 있을 때 "투어 다시 보기" 링크 */
  tourPageKey?: string;
  className?: string;
}

const POPOVER_WIDTH = 280;
const POPOVER_GAP = 8;
const VIEWPORT_PAD = 12;

const HelpDot: React.FC<HelpDotProps> = ({ children, askCue, placement = 'auto', tourPageKey, className }) => {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; placeAbove: boolean } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Trigger 위치 기반으로 Popover 좌표 계산 — viewport 안에 자동 정렬
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // 좌표: trigger 아래 8px, 좌측 정렬 (-8px offset)
    let left = r.left - 8;
    let placeAbove = false;
    if (placement === 'top') placeAbove = true;
    else if (placement === 'auto' && r.bottom + 200 > vh) placeAbove = true;
    // 우측 viewport 넘으면 좌측 이동
    if (left + POPOVER_WIDTH + VIEWPORT_PAD > vw) {
      left = vw - POPOVER_WIDTH - VIEWPORT_PAD;
    }
    if (left < VIEWPORT_PAD) left = VIEWPORT_PAD;
    const top = placeAbove ? r.top : r.bottom + POPOVER_GAP;
    setPos({ top, left, placeAbove });
  }, [open, placement]);

  // 외부 클릭/Esc 닫기 + 스크롤·리사이즈 시 닫기
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return;
      if (popoverRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  const handleAskCue = () => {
    if (!askCue) return;
    window.dispatchEvent(new CustomEvent('cue:ask', { detail: { prefill: askCue } }));
    setOpen(false);
  };

  return (
    <Anchor className={className}>
      <Trigger
        ref={triggerRef}
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
      {open && pos && createPortal(
        <Popover
          ref={popoverRef}
          role="tooltip"
          style={{
            top: pos.placeAbove ? `calc(${pos.top}px - 100% - ${POPOVER_GAP}px)` : `${pos.top}px`,
            left: `${pos.left}px`,
          }}
          onMouseLeave={() => setOpen(false)}
        >
          <Body>{children}</Body>
          {askCue && (
            <AskCueLink type="button" onClick={handleAskCue}>
              <span>{t('helpDot.askQhelper', 'Q helper 에게 자세히 묻기')}</span>
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
        </Popover>,
        document.body
      )}
    </Anchor>
  );
};

export default HelpDot;

// 제목 글자 바로 옆에 붙도록 — 작은 간격 + 정확한 vertical 정렬
const Anchor = styled.span`
  position: relative;
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
  margin-left: 4px;
  flex-shrink: 0;
  line-height: 1;
`;
const Trigger = styled.button`
  width: 18px; height: 18px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent;
  border: none; border-radius: 50%;
  color: #94A3B8;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  transition: color 0.15s, background 0.15s;
  &:hover { color: #14B8A6; background: #F0FDFA; }
  &:focus-visible { outline: 2px solid rgba(20,184,166,0.3); outline-offset: 2px; }
  svg { display: block; width: 14px; height: 14px; }
`;
const Popover = styled.div`
  position: fixed;
  width: 280px;
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 10px;
  padding: 14px 16px;
  box-shadow: 0 4px 16px rgba(15,23,42,0.10);
  z-index: 9999;
  font-size: 12.5px;
  color: #334155;
  line-height: 1.65;
  text-align: left;
  cursor: default;
`;
const Body = styled.div`
  margin: 0;
  white-space: pre-line;
  word-break: keep-all;
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
