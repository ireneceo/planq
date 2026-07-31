import React from 'react';
import { Modal, ModalButton as Button } from '../UI/Modal';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
  /** 기본 2100. 더 높은 레이어(예: MemoPopup 2301) 위에서 물어야 할 때만 올린다 —
   *  낮으면 확인창이 뒤에 깔려 사용자에겐 "아무 반응 없음" 으로 보인다. */
  zIndex?: number;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen, onClose, onConfirm, title, message,
  confirmText = 'Confirm', cancelText = 'Cancel', variant = 'info', zIndex = 2100
}) => {
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
      <Button variant="secondary" onClick={onClose}>{cancelText}</Button>
      <Button variant={getConfirmButtonVariant()} onClick={onConfirm}>{confirmText}</Button>
    </>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} footer={footer} zIndex={zIndex}>
      <div style={{ textAlign: 'center', padding: '32px 0' }}>
        <p style={{ fontSize: '16px', color: '#4B5563', lineHeight: '1.6', margin: '0' }}>{message}</p>
      </div>
    </Modal>
  );
};

export default ConfirmDialog;
