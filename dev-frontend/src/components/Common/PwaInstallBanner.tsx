// PWA 홈화면 추가 안내 배너 — 모바일 우선.
//   - Chrome/Edge: beforeinstallprompt 잡혀 있으면 직접 prompt
//   - iOS Safari: prompt API 미지원 → 사용 안내 (공유 → 홈 화면에 추가)
//   - dismiss 는 sessionStorage 만 — 새 탭/세션에서는 다시 노출 (적극 유도)
//   - 이미 설치(standalone) 된 경우는 노출 X
//   - 상태는 PwaInstallContext 가 관리 → 설정 페이지의 InstallSection 과 deferred 공유
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { usePwaInstall } from '../../contexts/PwaInstallContext';

export default function PwaInstallBanner() {
  const { t } = useTranslation('common');
  const { isStandalone, canPrompt, isIos, dismissedThisSession, install, dismissForSession } = usePwaInstall();

  if (isStandalone) return null;
  if (dismissedThisSession) return null;
  if (!canPrompt && !isIos) return null;

  const handleInstall = async () => {
    const result = await install();
    if (result === 'dismissed') dismissForSession();
  };

  return (
    <BannerRoot role="dialog" aria-label={t('pwa.installAria', '앱으로 설치') as string}>
      <Icon>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="2" width="14" height="20" rx="2"/>
          <line x1="12" y1="18" x2="12.01" y2="18"/>
        </svg>
      </Icon>
      <Body>
        <Title>{t('pwa.installTitle', 'PlanQ 앱으로 설치')}</Title>
        <Desc>
          {isIos
            ? t('pwa.iosHint', '하단 공유 버튼 → "홈 화면에 추가"')
            : t('pwa.androidHint', '홈 화면에 추가하면 알림·빠른 진입이 가능합니다')}
        </Desc>
      </Body>
      {!isIos && canPrompt && (
        <CtaBtn type="button" onClick={handleInstall}>
          {t('pwa.installCta', '설치')}
        </CtaBtn>
      )}
      <CloseBtn type="button" onClick={dismissForSession} aria-label={t('common.close', '닫기') as string}>×</CloseBtn>
    </BannerRoot>
  );
}

const BannerRoot = styled.div`
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 8500;
  display: grid;
  grid-template-columns: 36px 1fr auto auto;
  gap: 12px;
  align-items: center;
  padding: 12px 14px;
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 12px;
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.12);
  width: min(360px, calc(100vw - 32px));
  animation: slideUp 0.18s ease-out;
  @keyframes slideUp {
    from { transform: translateY(20px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
`;
const Icon = styled.div`
  width: 36px; height: 36px;
  display: flex; align-items: center; justify-content: center;
  background: #F0FDFA;
  color: #0D9488;
  border-radius: 8px;
`;
const Body = styled.div`min-width: 0; display: flex; flex-direction: column; gap: 2px;`;
const Title = styled.div`font-size: 13px; font-weight: 700; color: #0F172A; line-height: 1.3;`;
const Desc = styled.div`font-size: 11px; color: #64748B; line-height: 1.3;`;
const CtaBtn = styled.button`
  height: 32px; padding: 0 14px;
  background: #14B8A6; color: #FFFFFF; border: none; border-radius: 8px;
  font-size: 12px; font-weight: 600; cursor: pointer;
  &:hover { background: #0D9488; }
`;
const CloseBtn = styled.button`
  width: 24px; height: 24px;
  background: transparent; border: none; cursor: pointer;
  color: #94A3B8; font-size: 18px; line-height: 1;
  display: flex; align-items: center; justify-content: center;
  border-radius: 4px;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
