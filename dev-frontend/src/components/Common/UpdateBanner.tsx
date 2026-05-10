// 업데이트 사용 가능 배너 — main.tsx 가 새 빌드 감지하면 'planq:update-available' dispatch.
// 우측 하단 슬라이드인. 사용자 클릭 시 'planq:apply-update' 발행 → 즉시 reload.
// 입력 도중 갑자기 reload 되어 데이터 손실 회귀를 막기 위해, 명시적 사용자 트리거.
import React, { useEffect, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { useTranslation } from 'react-i18next';

const UpdateBanner: React.FC = () => {
  const { t } = useTranslation('common');
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onAvailable = () => setShow(true);
    window.addEventListener('planq:update-available', onAvailable);
    return () => window.removeEventListener('planq:update-available', onAvailable);
  }, []);

  const apply = () => {
    window.dispatchEvent(new CustomEvent('planq:apply-update'));
  };
  const later = () => {
    setShow(false);
    // main.tsx 에 알림 — 같은 build_id 는 같은 세션 동안 다시 띄우지 않음
    window.dispatchEvent(new CustomEvent('planq:update-dismiss'));
  };

  if (!show) return null;
  return (
    <Wrap role="status" aria-live="polite">
      <Body>
        <Title>{t('update.title', { defaultValue: '새 버전이 사용 가능합니다' }) as string}</Title>
        <Hint>{t('update.hint', { defaultValue: '편한 시점에 새로고침하면 최신 화면으로 갱신됩니다.' }) as string}</Hint>
      </Body>
      <Actions>
        <Later type="button" onClick={later}>{t('update.later', { defaultValue: '나중에' }) as string}</Later>
        <Apply type="button" onClick={apply}>{t('update.apply', { defaultValue: '지금 새로고침' }) as string}</Apply>
      </Actions>
    </Wrap>
  );
};

export default UpdateBanner;

const slideIn = keyframes`
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
`;
const Wrap = styled.div`
  position: fixed; right: 20px; bottom: 20px; z-index: 1200;
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.06);
  max-width: calc(100vw - 40px);
  animation: ${slideIn} 0.2s ease-out;
  @media (max-width: 640px) {
    left: 16px; right: 16px; bottom: 16px;
    flex-direction: column; align-items: stretch;
  }
`;
const Body = styled.div`display: flex; flex-direction: column; gap: 2px; min-width: 200px;`;
const Title = styled.div`font-size: 13px; font-weight: 700; color: #0F172A;`;
const Hint = styled.div`font-size: 11px; color: #64748B; line-height: 1.4;`;
const Actions = styled.div`display: flex; gap: 6px;`;
const Apply = styled.button`
  height: 32px; padding: 0 14px; font-size: 12px; font-weight: 700;
  background: #14B8A6; color: #fff; border: none; border-radius: 8px; cursor: pointer;
  transition: background 0.15s;
  &:hover { background: #0D9488; }
`;
const Later = styled.button`
  height: 32px; padding: 0 12px; font-size: 12px; font-weight: 600;
  background: #fff; color: #475569; border: 1px solid #E2E8F0; border-radius: 8px; cursor: pointer;
  &:hover { background: #F8FAFC; }
`;
