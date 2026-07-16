// OpenInAppBanner — N+69 Smart Routing App-First 1차
//
// 외부 공유 링크 (/public/*, /invite/*, /sign/*) 진입 시:
//   - 이미 PWA 안 (isStandalone): 그대로 (banner 숨김)
//   - 같은 origin PWA 설치돼 있음 (isRelatedInstalled) — 사용자가 미리 설치:
//       → "PlanQ 앱으로 열기" 강조 CTA — 클릭 시 same URL 재로드 (브라우저가 PWA scope 매칭 시 자동 진입)
//   - PWA 미설치 — install 가능:
//       → InstallPromptBanner 가 이미 처리. 이 컴포넌트는 hidden
//
// 비전: 박제 (`project_smart_routing_appfirst.md`) — 노션 대비 차별화 (외부 → PWA 0-step)
// 1차 한계: 진짜 자동 redirect 는 manifest.json protocol_handlers + iOS .well-known 인프라 필요 (Phase 별도)
import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { useChromeLocation } from '../../hooks/useChromeNav';
import { useTranslation } from 'react-i18next';
import { usePwaInstall } from '../../contexts/PwaInstallContext';

const DISMISS_KEY = 'pq_openinapp_dismiss';
const DISMISS_HOURS = 24;

function isDismissed(): boolean {
  try {
    const v = localStorage.getItem(DISMISS_KEY);
    if (!v) return false;
    return Date.now() - Number(v) < DISMISS_HOURS * 60 * 60 * 1000;
  } catch { return false; }
}

const OpenInAppBanner: React.FC = () => {
  const { t } = useTranslation('common');
  const location = useChromeLocation();
  const pwa = usePwaInstall();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => { setDismissed(isDismissed()); }, []);

  // public route 만 노출 (App-First 의 핵심 진입점)
  const isPublicRoute = /^\/(public|invite|sign)\//.test(location.pathname);
  if (!isPublicRoute) return null;

  // PWA 안 — 이미 앱
  if (pwa.isStandalone) return null;

  // PWA 미설치 — InstallPromptBanner 가 처리
  if (!pwa.isRelatedInstalled && !pwa.canPrompt) return null;

  // 사용자가 24h 동안 닫음
  if (dismissed) return null;

  const onOpenInApp = () => {
    // 같은 URL 재로드 — 브라우저가 PWA scope 매칭 시 자동 진입
    // (Chrome Android · Edge: scope_extensions 매칭 / iOS Safari: Universal Link 별도 인프라)
    window.location.href = window.location.href;
  };

  const onDismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* quota */ }
    setDismissed(true);
  };

  return (
    <Wrap role="banner" aria-label={t('pwa.openInApp.aria', { defaultValue: 'PlanQ 앱으로 열기' }) as string}>
      <Icon>📱</Icon>
      <Body>
        <Title>{t('pwa.openInApp.title', { defaultValue: 'PlanQ 앱이 설치되어 있어요' }) as string}</Title>
        <Sub>{t('pwa.openInApp.sub', { defaultValue: '앱으로 열면 더 빠르고 알림도 받을 수 있어요' }) as string}</Sub>
      </Body>
      <OpenBtn type="button" onClick={onOpenInApp}>
        {t('pwa.openInApp.cta', { defaultValue: '앱으로 열기' }) as string}
      </OpenBtn>
      <DismissBtn type="button" onClick={onDismiss} aria-label={t('pwa.openInApp.dismiss', { defaultValue: '닫기' }) as string}>
        ×
      </DismissBtn>
    </Wrap>
  );
};

export default OpenInAppBanner;

const Wrap = styled.div`
  position: fixed; top: 0; left: 0; right: 0;
  z-index: 8000;
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px;
  background: linear-gradient(180deg, #115E59 0%, #134E4A 100%);
  color: #FFFFFF;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  @media (min-width: 769px) {
    top: 16px; right: 16px; left: auto;
    width: 360px;
    border-radius: 12px;
  }
`;
const Icon = styled.div`font-size: 22px; line-height: 1;`;
const Body = styled.div`flex: 1; display: flex; flex-direction: column; gap: 2px;`;
const Title = styled.div`font-size: 13px; font-weight: 700;`;
const Sub = styled.div`font-size: 11px; color: #CCFBF1;`;
const OpenBtn = styled.button`
  height: 32px; padding: 0 12px;
  background: #FFFFFF; color: #115E59;
  border: none; border-radius: 8px;
  font-size: 12px; font-weight: 700;
  cursor: pointer;
  transition: background 0.15s;
  &:hover { background: #F0FDFA; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;
const DismissBtn = styled.button`
  width: 28px; height: 28px;
  background: transparent; color: #99F6E4;
  border: none; border-radius: 6px;
  font-size: 20px; line-height: 1;
  cursor: pointer;
  &:hover { background: rgba(255,255,255,0.10); color: #FFFFFF; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;
