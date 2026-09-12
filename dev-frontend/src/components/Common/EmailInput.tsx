// EmailInput — 이메일 입력. PhoneInput 과 **한 쌍**이다(같은 모양·같은 계약).
//
// Irene 2026-09-12: "이메일 전화 등 모든 입력형태는 맞춰줘야지 … 그냥 텍스트 박스야?"
//   · 공백을 떼고 소문자로 맞춘다(서버도 소문자로 저장한다 — `normEmail`)
//   · 형식이 아니면 blur 에서 **그 자리에서** 말한다(저장 버튼을 눌러 400 을 받고 나서가 아니다)
//   · 빈 값은 잘못된 값이 아니다(선택 입력) — 필수는 `required` 로 따로 말한다
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';

// 서버(`routes/sale_save.js` EMAIL_RE)와 **같은 수준**의 검사. 더 엄격하게 만들면 서버는 받는데
// 화면만 막는 일이 생긴다(그 반대도 나쁘다).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailUsable(value: string): boolean {
  const v = String(value || '').trim();
  if (!v) return true;
  return EMAIL_RE.test(v);
}
export function normalizeEmail(value: string): string {
  return String(value || '').trim().toLowerCase();
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  id?: string;
  onBlur?: () => void;
  onValidityChange?: (ok: boolean) => void;
}

const EmailInput: React.FC<Props> = ({
  value, onChange, placeholder, required = false, disabled = false,
  autoFocus = false, id, onBlur, onValidityChange,
}) => {
  const { t } = useTranslation('common');
  const [error, setError] = useState<string | null>(null);

  const handleBlur = () => {
    // 보이는 값도 정리한다 — 저장값과 화면이 다르면 사용자는 무엇이 저장됐는지 모른다
    const norm = normalizeEmail(value);
    if (norm !== value) onChange(norm);
    let msg: string | null = null;
    if (required && !norm) msg = t('email.required', { defaultValue: '이메일을 입력해주세요' }) as string;
    else if (!isEmailUsable(norm)) msg = t('email.invalid', { defaultValue: '이메일 형식이 아니에요 (예: name@company.com)' }) as string;
    setError(msg);
    onValidityChange?.(!msg);
    onBlur?.();
  };

  return (
    <Container>
      <StyledInput
        id={id}
        type="email"
        value={value}
        onChange={(e) => { onChange(e.target.value); if (error) setError(null); }}
        onBlur={handleBlur}
        placeholder={placeholder || (t('email.placeholder', { defaultValue: 'name@company.com' }) as string)}
        disabled={disabled}
        autoFocus={autoFocus}
        $hasError={!!error}
        aria-invalid={!!error}
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
      />
      {error && <ErrorMessage role="alert">{error}</ErrorMessage>}
    </Container>
  );
};

export default EmailInput;

const Container = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const StyledInput = styled.input<{ $hasError?: boolean }>`
  width: 100%; height: 36px; padding: 0 10px; box-sizing: border-box;
  border: 1px solid ${(p) => (p.$hasError ? '#EF4444' : '#E2E8F0')};
  border-radius: 8px; font-size: 0.8125rem; color: #0F172A; font-family: inherit;
  &:focus {
    outline: none;
    border-color: ${(p) => (p.$hasError ? '#EF4444' : '#5EEAD4')};
    box-shadow: 0 0 0 3px ${(p) => (p.$hasError ? 'rgba(239,68,68,0.12)' : 'rgba(20,184,166,0.12)')};
  }
  &::placeholder { color: #94A3B8; }
  &:disabled { background: #F1F5F9; cursor: not-allowed; }
`;
const ErrorMessage = styled.div`font-size: 0.75rem; color: #EF4444;`;
