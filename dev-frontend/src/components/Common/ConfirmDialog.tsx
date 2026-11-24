import React from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton as Button } from '../UI/Modal';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** 선택 — 확인/취소 사이의 **제3의 길**. 둘 중 하나를 고르라고 강요하면 사용자가 기능을 잃는다
   *  (예: "고정을 바꿀래, 말래" 만 물으면 '그냥 일반 창으로 열기' 를 할 수 없다). 둘 다 주면 렌더된다. */
  secondaryText?: string;
  onSecondary?: () => void;
  variant?: 'danger' | 'warning' | 'info';
  /** 기본 2100. 더 높은 레이어(예: MemoPopup 2301) 위에서 물어야 할 때만 올린다 —
   *  낮으면 확인창이 뒤에 깔려 사용자에겐 "아무 반응 없음" 으로 보인다. */
  zIndex?: number;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen, onClose, onConfirm, title, message,
  confirmText, cancelText, secondaryText, onSecondary, variant = 'info', zIndex = 2100
}) => {
  // ★ 기본 버튼 글은 화면 언어를 따른다 (2026-11-24, Irene «한국어 화면인데 Cancel») — 영어 리터럴 기본값이던
  //   탓에 cancelText 를 안 넘긴 확인창 19곳이 한국어 화면에서 «Cancel»/«Confirm» 이었다. 호출부마다 넘기지 말고 여기 한 곳.
  const { t } = useTranslation('common');
  const cancelLabel = cancelText ?? t('button.cancel', { defaultValue: 'Cancel' });
  const confirmLabel = confirmText ?? t('button.confirm', { defaultValue: 'Confirm' });
  const getConfirmButtonVariant = () => {
    switch (variant) {
      case 'danger':
      case 'warning':
        return 'danger';
      default:
        return 'primary';
    }
  };

  const footer = (
    <>
      <Button variant="secondary" onClick={onClose}>{cancelLabel}</Button>
      {secondaryText && onSecondary && (
        <Button variant="secondary" onClick={onSecondary}>{secondaryText}</Button>
      )}
      <Button variant={getConfirmButtonVariant()} onClick={onConfirm}>{confirmLabel}</Button>
    </>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} footer={footer} zIndex={zIndex}>
      <div style={{ textAlign: 'center', padding: '32px 0' }}>
        {/* ★ `white-space: pre-line` — 줄바꿈을 살린다 (2026-09-17, Fable 8차 ⑨).
            없으면 «포함되는 것 / 포함되지 않는 것 / 되돌릴 수 없음» 세 문단이 **한 덩어리로 붙어**
            폰에서 읽을 수 없는 벽이 된다(스크린샷 확인). 확인창은 «한 번에 알 수 있어야» 하는 자리다. */}
        <p style={{ fontSize: '1rem', color: '#4B5563', lineHeight: '1.6', margin: '0', whiteSpace: 'pre-line' }}>{message}</p>
      </div>
    </Modal>
  );
};

export default ConfirmDialog;
