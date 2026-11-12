// CcField — 메일 «참조(CC)» 칸 (2026-11-12, Irene «메일에 참조가 없오»).
//
// 서버(email-compose · forward · 답장 · 임시저장)는 처음부터 cc 를 받았는데 화면에 칸이 없어 넣을 길이 없었다.
//   · 평소에는 «참조 추가» 글자 버튼만 — 대부분의 메일은 참조가 없고, 칸을 늘 세우면 폰에서 본문 자리를 먹는다.
//   · 값이 있으면(초안 복원·되살리기) 칸이 저절로 보인다 — 숨긴 칸에 주소가 들어 있으면 모르고 보낸다.
//   · 입력은 받는 사람과 같은 칩 입력(RecipientInput) · 값 계약도 같은 콤마 문자열이다.
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import RecipientInput, { type RecipientSuggestion } from './RecipientInput';
import { mediaPhone } from '../../theme/breakpoints';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** 콤마 문자열 → 주소 배열(받는 사람과 같은 규칙) */
export const ccList = (s: string): string[] => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
/** 형식이 틀린 주소 — 보내기 전에 막는다(빨간 칩 그대로 보내면 서버가 발송 실패로 돌려준다) */
export const invalidCc = (s: string): string[] => ccList(s).filter((x) => !EMAIL_RE.test(x));

interface Props {
  value: string;
  onChange: (next: string) => void;
  suggestions?: RecipientSuggestion[];
  testId: string;
  /** 'field' = 새 메일 칸 모양(위 라벨) · 'inline' = 답장창 한 줄(앞 라벨) */
  variant?: 'field' | 'inline';
  disabled?: boolean;
}

const CcField: React.FC<Props> = ({ value, onChange, suggestions, testId, variant = 'field', disabled }) => {
  const { t } = useTranslation('qmail');
  const [open, setOpen] = useState(false);
  const shown = open || !!value.trim();
  const label = t('compose.cc', { defaultValue: '참조' }) as string;
  if (!shown) {
    return (
      <AddBtn type="button" data-testid={`${testId}-add`} disabled={disabled} onClick={() => setOpen(true)} data-pq-editor-hide="">
        + {t('compose.addCc', { defaultValue: '참조 추가' }) as string}
      </AddBtn>
    );
  }
  return (
    <Wrap $inline={variant === 'inline'} data-pq-editor-hide="">
      <Label>{label}</Label>
      <Grow>
        <RecipientInput data-testid={testId} value={value} onChange={onChange} placeholder="name@example.com" suggestions={suggestions} disabled={disabled} />
      </Grow>
    </Wrap>
  );
};

export default CcField;

const AddBtn = styled.button`
  align-self: flex-start;
  padding: 2px 0; border: none; background: none; cursor: pointer;
  font-size: 0.75rem; font-weight: 600; color: #0F766E;
  min-height: 32px;
  ${mediaPhone} { min-height: 36px; }   /* 폰 터치 자리 */
  &:hover:not(:disabled) { text-decoration: underline; }
  &:disabled { color: #94A3B8; cursor: default; }
`;
const Wrap = styled.div<{ $inline: boolean }>`
  display: flex; gap: ${(p) => (p.$inline ? '8px' : '4px')};
  flex-direction: ${(p) => (p.$inline ? 'row' : 'column')};
  align-items: ${(p) => (p.$inline ? 'center' : 'stretch')};
`;
const Label = styled.label`
  font-size: 0.75rem; font-weight: 600; color: #64748B; flex-shrink: 0;
`;
const Grow = styled.div`
  flex: 1; min-width: 0;
`;
