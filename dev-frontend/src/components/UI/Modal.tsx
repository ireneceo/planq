import React from 'react';
import ReactDOM from 'react-dom';
import styled from 'styled-components';

export const ModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  z-index: 2000;
  overflow-y: auto;
  padding: 40px 0;
`;

export const ModalContent = styled.div`
  background: white;
  border-radius: 12px;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
  max-width: 600px;
  width: 90%;
  flex-shrink: 0;
  margin: auto 0;
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 80px);
  overflow: hidden;
`;

export const ModalHeader = styled.div`
  padding: 24px;
  border-bottom: 1px solid #E6EBF1;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
`;

export const ModalTitle = styled.h2`
  font-size: 20px;
  font-weight: 600;
  color: #0A2540;
  margin: 0;
`;

export const CloseButton = styled.button`
  background: none;
  border: none;
  font-size: 24px;
  color: #6B7C93;
  cursor: pointer;
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  &:hover { color: #0A2540; }
`;

export const ModalBody = styled.div`
  padding: 24px;
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
`;

export const ModalFooter = styled.div`
  padding: 20px 24px;
  border-top: 1px solid #E6EBF1;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  flex-shrink: 0;
  flex-wrap: wrap;
`;

export const FormRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  @media (max-width: 640px) { grid-template-columns: 1fr; }
`;

export const FormGroup = styled.div`
  margin-bottom: 20px;
`;

export const FormLabel = styled.label`
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: #6B7C93;
  margin-bottom: 8px;
`;

export const FormInput = styled.input`
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  padding: 8px 12px;
  border: 1px solid #E6EBF1;
  border-radius: 6px;
  font-size: 14px;
  transition: all 0.15s;
  &:focus {
    outline: none;
    border-color: #14B8A6;
    box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.1);
  }
  &:disabled { background: #F9FAFB; color: #6B7280; cursor: not-allowed; }
  &::placeholder { color: #9CA3AF; }
`;

// FormSelect 제거됨 — PlanQSelect (components/Common/PlanQSelect.tsx) 사용

export const FormTextArea = styled.textarea`
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  padding: 8px 12px;
  border: 1px solid #E6EBF1;
  border-radius: 6px;
  font-size: 14px;
  min-height: 100px;
  resize: vertical;
  transition: all 0.15s;
  &:focus {
    outline: none;
    border-color: #14B8A6;
    box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.1);
  }
  &::placeholder { color: #9CA3AF; }
`;

export const ModalWarning = styled.div<{ show?: boolean }>`
  display: ${props => props.show === false ? 'none' : 'block'};
  margin-top: 16px;
  padding: 12px 16px;
  background: #FEF2F2;
  border: 1px solid #FCA5A5;
  border-radius: 8px;
  color: #DC2626;
  font-size: 14px;
  line-height: 1.5;
`;

export const ModalButton = styled.button<{ variant?: 'primary' | 'secondary' | 'danger' }>`
  padding: 12px 20px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  border: ${props => {
    switch (props.variant) {
      case 'primary': return 'none';
      case 'danger': return 'none';
      default: return '1px solid #E6EBF1';
    }
  }};
  background: ${props => {
    switch (props.variant) {
      case 'primary': return '#14B8A6';
      case 'danger': return '#DC2626';
      default: return 'white';
    }
  }};
  color: ${props => {
    switch (props.variant) {
      case 'primary': return 'white';
      case 'danger': return 'white';
      default: return '#6B7C93';
    }
  }};
  &:hover:not(:disabled) {
    background: ${props => {
      switch (props.variant) {
        case 'primary': return '#0D9488';
        case 'danger': return '#B91C1C';
        default: return '#F8FAFC';
      }
    }};
    transform: translateY(-1px);
  }
  &:disabled {
    background: ${props => {
      switch (props.variant) {
        case 'primary': return '#99F6E4';
        case 'danger': return '#FCA5A5';
        default: return '#F3F4F6';
      }
    }};
    color: ${props => {
      switch (props.variant) {
        case 'primary': return 'rgba(255, 255, 255, 0.7)';
        case 'danger': return 'rgba(255, 255, 255, 0.7)';
        default: return '#D1D5DB';
      }
    }};
    cursor: not-allowed;
    transform: none;
    opacity: 1;
  }
`;

interface ModalComponentProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string;
  size?: 'small' | 'medium' | 'large';
  headerActions?: React.ReactNode;
  zIndex?: number;
}

const ModalComponentInternal: React.FC<ModalComponentProps> = ({
  isOpen, onClose, title, children, footer, maxWidth, size = 'medium', headerActions, zIndex
}) => {
  if (!isOpen) return null;

  const getMaxWidth = () => {
    if (maxWidth) return maxWidth;
    switch (size) {
      case 'small': return '400px';
      case 'large': return '800px';
      default: return '600px';
    }
  };

  const modalContent = (
    <ModalOverlay onClick={onClose} style={zIndex ? { zIndex } : undefined}>
      <ModalContent style={{ maxWidth: getMaxWidth() }} onClick={e => e.stopPropagation()}>
        <ModalHeader>
          <ModalTitle>{title}</ModalTitle>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {headerActions}
            <CloseButton onClick={onClose}>&times;</CloseButton>
          </div>
        </ModalHeader>
        <ModalBody>{children}</ModalBody>
        {footer && <ModalFooter>{footer}</ModalFooter>}
      </ModalContent>
    </ModalOverlay>
  );

  return ReactDOM.createPortal(modalContent, document.body);
};

export const Modal = ModalComponentInternal;
export const ModalComponent = ModalComponentInternal;
export default ModalComponentInternal;
