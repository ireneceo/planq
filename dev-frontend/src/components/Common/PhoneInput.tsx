// PhoneInput — 전화번호 입력. **형식을 입력 중에 맞춰 준다.**
//
// Irene 2026-09-12: "이메일 전화 등 모든 입력형태는 맞춰줘야지. 엉망으로 넣는 고객 있으면
//   어떻게 하려고 그냥 텍스트 박스야? 수준 좀 올리자."
//
// ★ 이 파일은 **있었지만 아무도 쓰지 않았다**(실측: import 0곳). 그래서 화면마다 생 <input> 이었다
//   — 공용 컴포넌트가 있다는 것과 강제된다는 것은 다르다(memory feedback_shared_wrapper_is_not_enforcement).
//   고쳐서 Q sale 부터 실제로 쓴다.
//
// 하는 일
//   · 숫자만 받아 **입력 중에 하이픈을 넣는다**(010-1234-5678 · 02-123-4567 · 1588-1234)
//   · `+` 로 시작하면 국제번호로 보고 숫자·공백·하이픈만 허용(형식을 우리가 정하지 않는다)
//   · 자리수가 모자라면 blur 에서 말해 준다. 저장값은 화면에 보이는 그대로(서버는 숫자만 비교한다)
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';

interface PhoneInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  onBlur?: () => void;
  id?: string;
  /** 검증 결과를 부모가 알아야 할 때(제출 버튼 잠그기 등) */
  onValidityChange?: (ok: boolean) => void;
}

/** 국내 번호 하이픈 — 서울(02)만 2자리 지역번호, 그 외 3자리. 대표번호(15xx·16xx·18xx)는 4-4. */
export function formatKoreanPhone(raw: string): string {
  const d = String(raw || '').replace(/\D/g, '').slice(0, 11);
  if (!d) return '';
  if (/^1[5678]\d/.test(d)) return d.length <= 4 ? d : `${d.slice(0, 4)}-${d.slice(4, 8)}`;
  if (d.startsWith('02')) {
    if (d.length <= 2) return d;
    if (d.length <= 5) return `${d.slice(0, 2)}-${d.slice(2)}`;
    if (d.length <= 9) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
    return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}`;
  }
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length <= 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 11)}`;
}

/** 전화번호가 쓸 수 있는 값인가 — 국내는 9~11자리, 국제(+)는 8자리 이상 */
export function isPhoneUsable(value: string): boolean {
  const v = String(value || '').trim();
  // 빈 값은 잘못된 값이 아니다 — 선택 입력이다(필수는 required 로 따로 말한다)
  if (!v) return true;
  const digits = v.replace(/\D/g, '');
  if (v.startsWith('+')) return digits.length >= 8;
  return digits.length >= 9 && digits.length <= 11;
}

const PhoneInput: React.FC<PhoneInputProps> = ({
  value, onChange, placeholder, required = false,
  disabled = false, autoFocus = false, onBlur, id, onValidityChange,
}) => {
  const { t } = useTranslation('common');
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    // 국제번호는 사람이 쓴 모양을 지키고, 국내번호는 우리가 하이픈을 맞춘다
    const next = raw.trim().startsWith('+')
      ? raw.replace(/[^0-9+\-\s()]/g, '')
      : formatKoreanPhone(raw);
    onChange(next);
    if (error) setError(null);
  };

  const handleBlur = () => {
    let msg: string | null = null;
    if (required && !value.trim()) msg = t('phone.required', { defaultValue: '전화번호를 입력해주세요' }) as string;
    else if (!isPhoneUsable(value)) msg = t('phone.invalid', { defaultValue: '번호 자리수가 맞지 않아요 (예: 010-1234-5678)' }) as string;
    setError(msg);
    onValidityChange?.(!msg);
    onBlur?.();
  };

  const ph = placeholder || (t('phone.placeholder', { defaultValue: '010-1234-5678' }) as string);

  return (
    <Container>
      <StyledInput
        id={id}
        type="tel"
        value={value}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder={ph}
        disabled={disabled}
        autoFocus={autoFocus}
        $hasError={!!error}
        aria-invalid={!!error}
        inputMode="tel"
      />
      {error && <ErrorMessage role="alert">{error}</ErrorMessage>}
    </Container>
  );
};

export default PhoneInput;

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
