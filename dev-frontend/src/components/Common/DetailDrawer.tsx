/**
 * DetailDrawer — 우측 상세/편집 드로어 공통 프리미티브
 *
 * 반응형 정책:
 *  - 데스크탑 (≥1025px): 지정한 width (default 440px) 사이드 드로어
 *  - 태블릿 (641~1024px): 90vw, 최대 560px
 *  - 폰 (≤640px): 100vw 풀스크린 오버레이 (border-radius 제거)
 *
 * 기본 동작:
 *  - Backdrop 클릭 닫기, Esc 닫기 (props 로 비활성 가능)
 *  - body 스크롤 잠금
 *  - 열림 시 슬라이드 인 애니메이션
 *
 * 사용 예:
 *   <DetailDrawer open={!!selected} onClose={close} width={440} ariaLabel="일정 상세">
 *     <DetailDrawer.Header onClose={close}>
 *       <Title>제목</Title>
 *     </DetailDrawer.Header>
 *     <DetailDrawer.Body>...</DetailDrawer.Body>
 *     <DetailDrawer.Footer>...</DetailDrawer.Footer>
 *   </DetailDrawer>
 */
import React, { useRef } from 'react';
import styled, { keyframes } from 'styled-components';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useEscapeStack } from '../../hooks/useEscapeStack';

interface DetailDrawerProps {
  open: boolean;
  onClose: () => void;
  width?: number;                 // 데스크탑 폭 (default 440)
  ariaLabel?: string;
  closeOnBackdrop?: boolean;      // default true
  closeOnEsc?: boolean;           // default true
  children: React.ReactNode;
}

const DetailDrawerRoot: React.FC<DetailDrawerProps> = ({
  open, onClose, width = 440, ariaLabel,
  closeOnBackdrop = true, closeOnEsc = true,
  children,
}) => {
  const panelRef = useRef<HTMLElement>(null);
  useBodyScrollLock(open);
  useEscapeStack(open && closeOnEsc, onClose);
  useFocusTrap(panelRef, open);

  if (!open) return null;

  return (
    <>
      <Backdrop onClick={closeOnBackdrop ? onClose : undefined} />
      <Panel
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        $width={width}
      >
        {children}
      </Panel>
    </>
  );
};

// ─── 서브 컴포넌트 ───
interface HeaderProps {
  onClose: () => void;
  children: React.ReactNode;
}
const Header: React.FC<HeaderProps> = ({ onClose, children }) => (
  <HeaderWrap>
    <HeaderContent>{children}</HeaderContent>
    <CloseBtn onClick={onClose} aria-label="close">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </CloseBtn>
  </HeaderWrap>
);

const Body = styled.div`
  flex: 1; overflow-y: auto; overflow-x: hidden;
  padding: 18px;
  display: flex; flex-direction: column; gap: 18px;
  /* iOS safe-area 하단 여유 */
  padding-bottom: calc(18px + env(safe-area-inset-bottom, 0px));
`;

const Footer = styled.div`
  padding: 12px 18px; border-top: 1px solid #EEF2F6;
  display: flex; justify-content: flex-end; gap: 8px; align-items: center;
  padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
`;

type DetailDrawerType = React.FC<DetailDrawerProps> & {
  Header: React.FC<HeaderProps>;
  Body: typeof Body;
  Footer: typeof Footer;
};
const DetailDrawer = DetailDrawerRoot as DetailDrawerType;
DetailDrawer.Header = Header;
DetailDrawer.Body = Body;
DetailDrawer.Footer = Footer;

export default DetailDrawer;

// ─── styled ───
const fadeIn = keyframes`
  from { opacity: 0; }
  to   { opacity: 1; }
`;
const slideInRight = keyframes`
  from { transform: translateX(100%); }
  to   { transform: translateX(0); }
`;

const Backdrop = styled.div`
  position: fixed; inset: 0;
  background: rgba(15, 23, 42, 0.08);
  
  z-index: 45;
  animation: ${fadeIn} 0.22s ease-out;
  @media (prefers-reduced-motion: reduce) { animation: none; }
`;

// 공통 드로어 폭 규칙 — 항상 왼쪽 56px strip 남겨 햄버거 패턴처럼 바깥 탭 = 닫기
const Panel = styled.aside<{ $width: number }>`
  position: fixed; top: 0; right: 0; bottom: 0;
  z-index: 50;
  background: #fff;
  display: flex; flex-direction: column;
  border-left: 1px solid #E2E8F0;
  box-shadow: -16px 0 40px rgba(15, 23, 42, 0.14);
  animation: ${slideInRight} 0.28s cubic-bezier(0.22, 1, 0.36, 1);
  width: min(${({ $width }) => $width}px, calc(100vw - 56px));
  padding-bottom: env(safe-area-inset-bottom, 0px);
  @media (prefers-reduced-motion: reduce) { animation: none; }
`;

const HeaderWrap = styled.div`
  display: flex; align-items: flex-start; gap: 10px;
  padding: 16px 18px 14px;
  border-bottom: 1px solid #EEF2F6;
  flex-shrink: 0;
  /* iOS safe-area 상단 여유 — 상태바 영역 */
  padding-top: calc(16px + env(safe-area-inset-top, 0px));
`;

const HeaderContent = styled.div` flex: 1; min-width: 0; `;

const CloseBtn = styled.button`
  width: 34px; height: 34px; border: none; background: transparent;
  color: #64748B; border-radius: 8px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  &:hover { background: #F1F5F9; color: #0F172A; }
  /* 폰에서 터치 타겟 확대 */
  @media (max-width: 640px) {
    width: 40px; height: 40px;
  }
`;
