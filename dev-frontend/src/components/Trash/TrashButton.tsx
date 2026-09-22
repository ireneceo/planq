// TrashButton — 휴지통을 여는 **유일한 버튼** (2026-09-22).
//   Q file · Q docs · Q info · 프로젝트 탭 · 개인 보관함이 모두 이것을 쓴다. 글자 없이 아이콘만 —
//   휴지통 모양은 누구나 알아서 글자가 없어도 뜻이 통하고 자리를 덜 먹는다(Irene 제안).
//   대신 뜻을 잃지 않게 aria-label(화면낭독) + title(마우스 오버)을 반드시 붙인다.
//   크기는 필터줄 표준 36px(폰 40px — 터치 타깃).
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { TrashIcon } from '../Common/Icons';

interface Props {
  onClick: () => void;
  active?: boolean;
  'data-testid'?: string;
}

const TrashButton: React.FC<Props> = ({ onClick, active, ...rest }) => {
  const { t } = useTranslation('common');
  const label = t('trash.open', { defaultValue: '휴지통 — 삭제한 항목 되돌리기' }) as string;
  return (
    <Btn type="button" onClick={onClick} aria-label={label} title={label} $active={!!active}
      data-testid={rest['data-testid'] || 'trash-open'}>
      <TrashIcon size={18} />
    </Btn>
  );
};

export default TrashButton;

const Btn = styled.button<{ $active: boolean }>`
  flex-shrink: 0; margin-left: auto;
  width: 36px; height: 36px; padding: 0; box-sizing: border-box;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 8px; border: 1px solid ${(p) => (p.$active ? '#14B8A6' : '#E2E8F0')};
  background: ${(p) => (p.$active ? '#F0FDFA' : '#FFFFFF')};
  color: ${(p) => (p.$active ? '#0F766E' : '#64748B')};
  cursor: pointer; font-family: inherit;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  &:hover { background: #F8FAFC; color: #0F172A; border-color: #CBD5E1; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
  @media (max-width: 640px) { width: 40px; height: 40px; }
`;
