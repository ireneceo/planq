// 표준 센터 모달 — Backdrop + Dialog + Header + Body + Footer.
// 모든 모달이 같은 visual 로 통일.
// (기존 components/Common/Modal.tsx 는 폼 위젯 모음 — 별도 유지)
//
// 사용:
//   <StandardModal open={open} onClose={close} title="제목" size="md">
//     <StandardModal.Body>...</StandardModal.Body>
//     <StandardModal.Footer>
//       <Button variant="secondary" onClick={close}>취소</Button>
//       <Button variant="primary" onClick={save}>저장</Button>
//     </StandardModal.Footer>
//   </StandardModal>
//
// 또는 단순 (자동 wrap):
//   <StandardModal open={open} onClose={close} title="제목" footer={<Button>OK</Button>}>
//     본문
//   </StandardModal>
import React from 'react';
import styled from 'styled-components';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useEscapeStack } from '../../hooks/useEscapeStack';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  size?: ModalSize;
  children: React.ReactNode;
  footer?: React.ReactNode;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  headerExtra?: React.ReactNode;
  hideCloseButton?: boolean;
  ariaLabel?: string;
}

const SIZE_MAP: Record<ModalSize, string> = {
  sm: '420px',
  md: '560px',
  lg: '720px',
  xl: '880px',
};

const Body = styled.div`
  flex: 1; overflow-y: auto; min-height: 0;
  padding: 16px 22px;
  display: flex; flex-direction: column; gap: 14px;
`;
const Footer = styled.div`
  display: flex; gap: 8px; align-items: center; justify-content: flex-end;
  padding: 14px 22px;
  border-top: 1px solid #F1F5F9;
  background: #fff;
  flex-shrink: 0;
`;

const StandardModal: React.FC<Props> & {
  Body: typeof Body;
  Footer: typeof Footer;
} = ({
  open, onClose, title, size = 'md', children, footer,
  closeOnBackdrop = true, closeOnEscape = true,
  headerExtra, hideCloseButton, ariaLabel,
}) => {
  useBodyScrollLock(open);
  useEscapeStack(open && closeOnEscape, onClose);
  if (!open) return null;

  // children 이 .Body / .Footer 컴포넌트 포함이면 그대로, 아니면 Body 로 wrap
  const childArr = React.Children.toArray(children);
  const hasStructuredChild = childArr.some((c) => {
    const el = c as React.ReactElement | null;
    return !!el && (el.type === Body || el.type === Footer);
  });
  const bodyContent = hasStructuredChild ? children : <Body>{children}</Body>;

  return (
    <Backdrop onClick={() => closeOnBackdrop && onClose()}>
      <Dialog
        $maxWidth={SIZE_MAP[size]}
        onClick={e => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label={ariaLabel || title}
      >
        <Header>
          <Title>{title}</Title>
          {headerExtra}
          {!hideCloseButton && (
            <CloseBtn type="button" onClick={onClose} aria-label="close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </CloseBtn>
          )}
        </Header>
        {bodyContent}
        {footer && <Footer>{footer}</Footer>}
      </Dialog>
    </Backdrop>
  );
};

StandardModal.Body = Body;
StandardModal.Footer = Footer;

export default StandardModal;

// ─── styled ───
const Backdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15,23,42,0.4);
  display: flex; align-items: center; justify-content: center; z-index: 1100;
  padding: 20px;
  /* 모바일: 키보드가 올라오면 visual viewport(--vvh)로 줄여 하단 입력·버튼이 안 가리게 (운영 #23). */
  @media (max-width: 640px) {
    height: var(--vvh, 100vh); bottom: auto; align-items: stretch; padding: 0;
  }
`;
const Dialog = styled.div<{ $maxWidth: string }>`
  background: #fff; border-radius: 14px;
  width: 100%; max-width: ${p => p.$maxWidth};
  max-height: 90vh; display: flex; flex-direction: column;
  box-shadow: 0 24px 48px rgba(15,23,42,0.18);
  @media (max-width: 640px) {
    max-height: var(--vvh, 100vh); height: var(--vvh, 100vh); border-radius: 0;
  }
`;
const Header = styled.div`
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 18px 22px 14px;
  border-bottom: 1px solid #F1F5F9;
  flex-shrink: 0;
  @media (max-width: 640px) { padding: 14px 16px 12px; }
`;
const Title = styled.h2`
  font-size: 16px; font-weight: 700; color: #0F172A; margin: 0;
  flex: 1; min-width: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
// ★ 폰에서는 터치 타깃 44 (theme/tokens CONTROL.touchMin) — 28px 은 손가락으로 누르기 어렵다.
//   모달 닫기는 **항상 우상단**이 정본이다(전 모달 공통).
const CloseBtn = styled.button`
  width: 28px; height: 28px;
  @media (max-width: 640px) { width: 44px; height: 44px; margin: -8px -10px -8px 0; }
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 6px;
  color: #64748B; cursor: pointer;
  flex-shrink: 0;
  &:hover { background: #F1F5F9; color: #0F172A; }
  &:focus-visible { outline: 2px solid rgba(20,184,166,0.3); outline-offset: 2px; }
`;

/**
 * 자체 마크업을 쓰는 모달이 **같은 헤더 규격**을 쓸 수 있게 내보낸다.
 * (18개 모달이 각자 헤더를 만들어 높이·닫기 위치·제목 크기가 제각각이었다 — 2026-08-25 실측)
 * 구조 전환이 어려운 모달은 최소한 이 세 조각만이라도 재사용한다.
 */
export { Header as ModalHeaderBar, Title as ModalTitleText, CloseBtn as ModalCloseButton };
