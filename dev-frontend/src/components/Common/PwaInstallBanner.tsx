// PWA 홈화면 추가 안내 배너 — 모바일 우선.
//   - Chrome/Edge: beforeinstallprompt 이벤트 잡아서 직접 prompt
//   - iOS Safari: prompt API 미지원 → 사용 안내 (공유 → 홈 화면에 추가)
//   - 한 번 dismiss 하면 7일 동안 안 보여줌 (localStorage)
import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

const DISMISS_KEY = 'pq_pwa_install_dismiss_until';
const DISMISS_DAYS = 7;

export default function PwaInstallBanner() {
  const { t } = useTranslation('common');
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIos, setShowIos] = useState(false);
  const [dismissed, setDismissed] = useState(true); // 기본 false 로 보이게 — 아래 effect 가 결정

  useEffect(() => {
    // dismiss 만료 검사
    try {
      const until = Number(localStorage.getItem(DISMISS_KEY) || '0');
      if (until && until > Date.now()) { setDismissed(true); return; }
    } catch { /* ignore */ }

    // 이미 standalone 모드(설치됨) 면 표시 X
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (isStandalone) { setDismissed(true); return; }

    // iOS Safari 감지 — beforeinstallprompt 이벤트 미지원
    const ua = navigator.userAgent.toLowerCase();
    const isIosSafari = /iphone|ipad|ipod/.test(ua) && /safari/.test(ua) && !/crios|fxios/.test(ua);
    if (isIosSafari) {
      setShowIos(true);
      setDismissed(false);
      return;
    }

    // Android Chrome / Edge — beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setDismissed(false);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const dismiss = () => {
    try {
      const until = Date.now() + DISMISS_DAYS * 24 * 3600 * 1000;
      localStorage.setItem(DISMISS_KEY, String(until));
    } catch { /* ignore */ }
    setDismissed(true);
    setDeferred(null);
    setShowIos(false);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === 'accepted') {
      // 설치됨 — 더 이상 표시 X (영구)
      try { localStorage.setItem(DISMISS_KEY, String(Date.now() + 365 * 24 * 3600 * 1000)); } catch { /* */ }
    } else {
      dismiss();
    }
    setDeferred(null);
  };

  if (dismissed) return null;
  if (!deferred && !showIos) return null;

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
          {showIos
            ? t('pwa.iosHint', '하단 공유 버튼 → "홈 화면에 추가"')
            : t('pwa.androidHint', '홈 화면에 추가하면 알림·빠른 진입이 가능합니다')}
        </Desc>
      </Body>
      {!showIos && deferred && (
        <CtaBtn type="button" onClick={install}>
          {t('pwa.installCta', '설치')}
        </CtaBtn>
      )}
      <CloseBtn type="button" onClick={dismiss} aria-label={t('common.close', '닫기') as string}>×</CloseBtn>
    </BannerRoot>
  );
}

// 우측 하단 floating banner (모바일에서도 부담 없이)
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
  background: #14B8A6; color: #FFF; border: none; border-radius: 8px;
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
