// 서명 자리(받는 쪽) 한 칸 — **고르기 또는 직접 입력** (2026-10-05)
//   Irene: *"서명인이 고객일 수도 있는데 왜 추출한 항목에 입력만 하게 해? 선택 또는 직접입력 둘다 되어야 하는 거 아니야?"*
//   서명 자리를 안 쓰는 일반 모드에는 이미 «멤버·고객 검색» 이 있었다 — 같은 목록(contactOptions)을 여기서도 쓴다.
//   고르면 이메일·이름이 채워지고, 아래 칸에서 그대로 고치거나 처음부터 직접 적을 수 있다.
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PlanQSelect, { type PlanQSelectOption } from '../Common/PlanQSelect';
import { SignerFields, SignerEmailInput, SignerNameInput } from './signerInputs';

export type ContactOption = PlanQSelectOption & { email: string; name: string };
interface Props {
  slot: number;
  value: { email: string; name: string };
  contacts: ContactOption[];
  onChange: (next: { email: string; name: string }) => void;
}

const SignSlotThemInput: React.FC<Props> = ({ slot, value, contacts, onChange }) => {
  const { t } = useTranslation('qdocs');
  const picked = contacts.find(o => o.email.toLowerCase() === value.email.trim().toLowerCase()) || null;
  return (
    <>
      {contacts.length > 0 && (
        <PickWrap data-testid={`sign-slot-pick-${slot}`}>
          <PlanQSelect
            size="sm"
            options={contacts}
            value={picked}
            onChange={(opt) => {
              const o = opt as ContactOption | null;
              onChange(o ? { email: o.email, name: o.name } : { email: '', name: '' });
            }}
            placeholder={t('sign.slotPickPh', { defaultValue: '멤버·고객 검색해 선택 — 또는 아래에 직접 입력' }) as string}
            isClearable
            isSearchable
          />
        </PickWrap>
      )}
      <SignerFields>
        <SignerEmailInput
          type="email"
          value={value.email}
          onChange={e => onChange({ ...value, email: e.target.value })}
          placeholder="email@example.com"
          autoComplete="off"
          spellCheck={false}
          data-testid={`sign-slot-email-${slot}`}
        />
        <SignerNameInput
          type="text"
          value={value.name}
          onChange={e => onChange({ ...value, name: e.target.value })}
          placeholder={t('sign.namePh', '이름 (선택)') as string}
          autoComplete="off"
        />
      </SignerFields>
    </>
  );
};

export default SignSlotThemInput;

const PickWrap = styled.div`margin-bottom: 6px;`;
