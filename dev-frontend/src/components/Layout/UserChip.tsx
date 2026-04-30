// 페이지 헤더 우측 상단의 작은 사용자 인사 chip.
// 모든 PageShell 헤더에 자동 노출 — 클릭 시 /profile.
import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { useAuth } from '../../contexts/AuthContext';
import { displayName } from '../../utils/displayName';

const UserChip: React.FC = () => {
  const { t, i18n } = useTranslation('common');
  const { user } = useAuth();
  if (!user) return null;
  const name = displayName(user, i18n.language);
  return (
    <ChipLink to="/profile" title={t('userChip.title', '내 프로필') as string}>
      <Greeting>{t('userChip.greeting', { name, defaultValue: '안녕하세요, {{name}}님' })}</Greeting>
    </ChipLink>
  );
};

export default UserChip;

const ChipLink = styled(Link)`
  display: inline-flex;
  align-items: center;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 600;
  color: #64748B;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 999px;
  text-decoration: none;
  white-space: nowrap;
  transition: all 0.15s;
  &:hover {
    color: #0F766E;
    background: #F0FDFA;
    border-color: #CCFBF1;
  }
  &:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.3);
  }
`;
const Greeting = styled.span`
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
`;
