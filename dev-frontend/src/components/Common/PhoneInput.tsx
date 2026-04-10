import React, { useState } from 'react';
import styled from 'styled-components';

interface PhoneInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  onBlur?: () => void;
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const StyledInput = styled.input<{ hasError?: boolean }>`
  width: 100%;
  padding: 8px 12px;
  border: 1px solid ${props => props.hasError ? '#EF4444' : '#E6EBF1'};
  border-radius: 6px;
  font-size: 14px;
  transition: all 0.15s;
  box-sizing: border-box;
  &:focus {
    outline: none;
    border-color: ${props => props.hasError ? '#EF4444' : '#14B8A6'};
    box-shadow: 0 0 0 3px ${props => props.hasError ? 'rgba(239, 68, 68, 0.1)' : 'rgba(20, 184, 166, 0.1)'};
  }
  &::placeholder { color: #9CA3AF; }
  &:disabled { background: #F3F4F6; cursor: not-allowed; }
`;

const ErrorMessage = styled.div`
  font-size: 12px;
  color: #EF4444;
  margin-top: 4px;
`;

const PhoneInput: React.FC<PhoneInputProps> = ({
  value, onChange, placeholder = 'Phone number', required = false,
  disabled = false, autoFocus = false, onBlur
}) => {
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/[^0-9+\-\s()]/g, '');
    onChange(val);
    if (error) setError(null);
  };

  const handleBlur = () => {
    if (required && !value) setError('Phone number is required');
    onBlur?.();
  };

  return (
    <Container>
      <StyledInput
        type="tel"
        value={value}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        hasError={!!error}
        inputMode="tel"
      />
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </Container>
  );
};

export default PhoneInput;
