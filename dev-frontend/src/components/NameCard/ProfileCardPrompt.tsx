// 내 프로필 맨 위 «내 명함» 줄 (2026-11-16 Irene «내 프로필 누르면 명함없으면 작성하게 하고»)
//   명함이 없으면 [명함 만들기] → /me/cards?new=1(만들기 창이 바로 열린다) · 있으면 장수와 [내 명함 보기].
//   못 읽으면 아무것도 안 그린다(프로필 화면을 막지 않는다).
import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { listMyCards } from '../../services/nameCards';
import ActionButton from '../Common/ActionButton';

export default function ProfileCardPrompt() {
  const { t } = useTranslation('cards');
  const navigate = useNavigate();
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    listMyCards().then((c) => { if (alive) setCount(c.length); }).catch(() => { if (alive) setCount(null); });
    return () => { alive = false; };
  }, []);
  if (count === null) return null;
  const none = count === 0;
  return (
    <Row data-testid="profile-card-prompt" $none={none}>
      <Text>
        <Title>{none ? t('profilePrompt.noneTitle', '아직 명함이 없어요') : t('profilePrompt.hasTitle', { n: count, defaultValue: '내 명함 {{n}}장' })}</Title>
        <Hint>{none
          ? t('profilePrompt.noneHint', '명함을 만들면 동료가 이름을 눌러 볼 수 있고, 링크·QR 로 바로 건넬 수 있어요.')
          : t('profilePrompt.hasHint', '동료가 내 이름을 누르면 워크스페이스 기본 명함이 보여요.')}</Hint>
      </Text>
      <ActionButton tone={none ? 'primary' : 'secondary'} size="sm" data-testid="profile-card-open"
        onClick={() => navigate(none ? '/me/cards?new=1' : '/me/cards')}>
        {none ? t('profilePrompt.create', '명함 만들기') : t('profilePrompt.open', '내 명함 보기')}
      </ActionButton>
    </Row>
  );
}

const Row = styled.div<{ $none: boolean }>`
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  margin-bottom: 16px; padding: 12px 16px; border-radius: 12px;
  border: 1px solid ${(p) => (p.$none ? '#99F6E4' : '#E2E8F0')}; background: ${(p) => (p.$none ? '#F0FDFA' : '#FFFFFF')};
`;
const Text = styled.div`display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1;`;
const Title = styled.div`font-size: 0.875rem; font-weight: 700; color: #0F172A;`;
const Hint = styled.div`font-size: 0.75rem; color: #64748B; line-height: 1.5;`;
