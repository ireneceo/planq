// 모바일 첫 방문 가이드 배너 — 사이클 Q-D Phase 3.
//
// 두 가지 상태:
//   1) 비-PWA 모바일 → "홈 화면에 추가" 안내 (Android: beforeinstallprompt / iOS: 공유 → 홈 화면)
//   2) PWA 설치 후 알림 권한 default → "알림 받기" 안내
//
// 표시 조건:
//   - 모바일 (max-width: 768px)
//   - localStorage 의 dismiss 7일 만료
//   - 사용자가 PWA 모드 (display-mode: standalone) 면 install 안내 자동 숨김

import React, { useEffect, useState, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { isPushSupported, getPushStatus, subscribe as subscribePush } from '../../services/push';
import { nativeAppLink } from '../../config/appLinks';

const DISMISS_KEY = 'planq.install.dismissed_at';
const NOTIF_DISMISS_KEY = 'planq.notif.dismissed_at';
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7일

type Mode = 'install' | 'notify' | 'hidden';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const isStandalone = (): boolean => {
  return (
    (typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(display-mode: standalone)').matches) ||
    // iOS Safari (PWA)
    (typeof navigator !== 'undefined' && (navigator as unknown as { standalone?: boolean }).standalone === true)
  );
};

const isIOS = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
};

const isMobile = (): boolean => {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 768px)').matches;
};

const isDismissed = (key: string): boolean => {
  try {
    const at = localStorage.getItem(key);
    if (!at) return false;
    const elapsed = Date.now() - Number(at);
    return elapsed < DISMISS_TTL_MS;
  } catch {
    return false;
  }
};

const InstallPromptBanner: React.FC = () => {
  const { t } = useTranslation('common');
  const [mode, setMode] = useState<Mode>('hidden');
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [busy, setBusy] = useState(false);
  // iOS / installEvent 없는 환경에서 [방법 보기] 클릭 시 단계별 안내 펼침
  const [expanded, setExpanded] = useState(false);

  // 결정 로직: install vs notify vs hidden
  const decideMode = useCallback(async () => {
    if (!isMobile()) return setMode('hidden');

    const standalone = isStandalone();

    // PWA 설치된 상태 → 알림 권한 default 면 notify, 아니면 hidden
    if (standalone) {
      if (!(await isPushSupported())) return setMode('hidden');
      const perm = await getPushStatus();
      if (perm !== 'default') return setMode('hidden');
      if (isDismissed(NOTIF_DISMISS_KEY)) return setMode('hidden');
      return setMode('notify');
    }

    // PWA 미설치 → install 안내 (단, 7일 dismiss 만료 안 됐으면 숨김)
    if (isDismissed(DISMISS_KEY)) return setMode('hidden');
    setMode('install');
  }, []);

  useEffect(() => {
    decideMode();
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, [decideMode]);

  const dismiss = (key: string) => {
    try { localStorage.setItem(key, String(Date.now())); } catch { /* quota */ }
    setMode('hidden');
  };

  const onInstall = async () => {
    if (!installEvent) {
      // iOS: 안내 카드만 표시. 실제 설치는 사용자가 직접.
      return;
    }
    setBusy(true);
    try {
      await installEvent.prompt();
      const { outcome } = await installEvent.userChoice;
      if (outcome === 'accepted') {
        setMode('hidden');
      } else {
        dismiss(DISMISS_KEY);
      }
    } finally {
      setBusy(false);
      setInstallEvent(null);
    }
  };

  const onSubscribeNotif = async () => {
    setBusy(true);
    try {
      const r = await subscribePush();
      if (r.ok) {
        setMode('hidden');
      } else {
        // 실패해도 일단 닫기 (재시도는 설정에서 가능)
        dismiss(NOTIF_DISMISS_KEY);
      }
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'hidden') return null;
  // ★ 알림 안내 배너가 이미 떠 있으면 이쪽은 양보한다 (2026-08-25).
  //   둘 다 "홈 화면에 추가해서 앱처럼 쓰세요" 라는 같은 이야기이고, 동시에 뜨면 모바일 상단을
  //   250px 잡아먹어 정작 페이지 내용이 안 보인다. PushPromptBanner 가 mount 시 이 플래그를 세운다.
  if (typeof document !== 'undefined' && document.body.dataset.pushPromptVisible === '1') return null;

  if (mode === 'install') {
    const ios = isIOS();
    // ★ 네이티브 앱이 있는 기기에는 홈 화면 추가(PWA)보다 앱을 먼저 권한다.
    //   iOS 는 TestFlight 베타가 승인돼 있다(2026-09-03). 앱이 없는 기기에서는 null 이라
    //   여태처럼 PWA 안내가 그대로 나온다 — 회귀 0.
    const native = nativeAppLink();
    // 환경별 PrimaryBtn 동작:
    //  - installEvent 존재 (Android Chrome 등): 즉시 prompt() 호출
    //  - 그 외 (iOS Safari / Mac Safari / Firefox 등): [방법 보기] 토글 → 단계 안내 펼침
    const handlePrimary = () => {
      if (native) { window.open(native.url, '_blank', 'noopener'); return; }
      if (installEvent) onInstall();
      else setExpanded((v) => !v);
    };
    const primaryLabel = native
      ? (native.beta ? t('installPrompt.getBetaApp', '앱 받기 (베타)') : t('installPrompt.getApp', '앱 받기'))
      : installEvent
        ? t('installPrompt.installBtn', '설치')
        : expanded
          ? t('installPrompt.hideSteps', '접기')
          : t('installPrompt.showSteps', '방법 보기');

    return (
      <Banner role="complementary" aria-label={t('installPrompt.title', 'PlanQ 를 앱처럼 사용하기') as string}>
        <BannerRow>
          <BannerIcon><img src="/favicon.svg" alt="PlanQ" width={36} height={36} /></BannerIcon>
          <BannerBody>
            <BannerTitle>{t('installPrompt.title', 'PlanQ 를 앱처럼 사용하기')}</BannerTitle>
            <BannerDesc>
              {native
                ? (native.beta
                    ? t('installPrompt.betaDesc', 'TestFlight 로 iOS 앱 베타를 바로 설치할 수 있어요.')
                    : t('installPrompt.nativeDesc', '앱을 설치하면 알림도 더 정확하게 받을 수 있어요.'))
                : t('installPrompt.shortDesc', '홈 화면에 추가하면 앱처럼 빠르게 접속할 수 있어요.')}
            </BannerDesc>
          </BannerBody>
          <BannerActions>
            <PrimaryBtn type="button" onClick={handlePrimary} disabled={busy}>
              {primaryLabel}
            </PrimaryBtn>
            <DismissBtn type="button" onClick={(e) => { e.stopPropagation(); dismiss(DISMISS_KEY); }} aria-label={t('installPrompt.dismiss', '나중에') as string}>
              ×
            </DismissBtn>
          </BannerActions>
        </BannerRow>
        {/* 앱을 권하는 기기에서도 홈 화면 추가 경로는 남긴다 — 베타 설치를 원치 않는 사람이 있다 */}
        {native && (
          <SecondaryLine>
            <LinkBtn type="button" onClick={() => setExpanded((v) => !v)}>
              {expanded ? t('installPrompt.hideSteps', '접기') : t('installPrompt.homeScreenInstead', '앱 없이 홈 화면에 추가하기')}
            </LinkBtn>
          </SecondaryLine>
        )}
        {/* 단계 안내 — installEvent 없거나 네이티브 안내일 때 [방법 보기] 클릭 시 펼침 */}
        {(!installEvent || native) && expanded && (
          <Steps>
            {ios ? (
              <>
                <Step>1. {t('installPrompt.iosStep1', '하단 공유 버튼 (□↑) 을 누릅니다')}</Step>
                <Step>2. {t('installPrompt.iosStep2', '"홈 화면에 추가" 를 선택합니다')}</Step>
                <Step>3. {t('installPrompt.iosStep3', '추가된 PlanQ 아이콘을 누르면 앱처럼 열립니다')}</Step>
              </>
            ) : (
              <>
                <Step>1. {t('installPrompt.menuStep1', '브라우저 메뉴 (︙ 또는 ⋯) 를 누릅니다')}</Step>
                <Step>2. {t('installPrompt.menuStep2', '"홈 화면에 추가" / "앱 설치" 를 선택합니다')}</Step>
                <Step>3. {t('installPrompt.menuStep3', '추가된 PlanQ 아이콘을 누르면 앱처럼 열립니다')}</Step>
              </>
            )}
          </Steps>
        )}
      </Banner>
    );
  }

  // mode === 'notify'
  return (
    <Banner role="complementary" aria-label={t('notifPrompt.title', '알림 받기') as string}>
      <BannerRow>
        <BannerIcon $bell>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
        </BannerIcon>
        <BannerBody>
          <BannerTitle>{t('notifPrompt.title', '알림 받기')}</BannerTitle>
          <BannerDesc>{t('notifPrompt.desc', '새 메시지·컨펌 요청·결제 알림을 폰으로 바로 받습니다.')}</BannerDesc>
        </BannerBody>
        <BannerActions>
          <PrimaryBtn type="button" onClick={onSubscribeNotif} disabled={busy}>
            {busy ? t('notifPrompt.subscribing', '...') : t('notifPrompt.allowBtn', '알림 받기')}
          </PrimaryBtn>
          <DismissBtn type="button" onClick={(e) => { e.stopPropagation(); dismiss(NOTIF_DISMISS_KEY); }} aria-label={t('notifPrompt.dismiss', '나중에') as string}>
            ×
          </DismissBtn>
        </BannerActions>
      </BannerRow>
    </Banner>
  );
};

export default InstallPromptBanner;

// ─── styled ───
// 위치: 모바일 우하단 FAB(채팅·Cue 도움말 버튼, bottom 16px + height 48px = 64px) 위로 띄움.
//   bottom 80px = FAB top(64) + gap(16). safe-area 추가해 노치/홈인디케이터 보호.
const Banner = styled.div`
  position: fixed;
  left: 12px; right: 12px;
  bottom: calc(80px + var(--pq-safe-bottom, 0px));
  z-index: 80;
  display: flex; flex-direction: column; gap: 8px;
  padding: 12px 14px;
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 14px;
  box-shadow: 0 8px 28px rgba(15,23,42,0.18);
  animation: bannerSlide 0.32s cubic-bezier(0.22,1,0.36,1);
  @keyframes bannerSlide { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  @media (min-width: 769px) { display: none; }
  /* 모바일 키보드 업 시 억제 — bottom:80px 고정이라 키보드가 올라오면 화면 중앙을 덮어 입력을 가린다.
     main.tsx body[data-keyboard-up='1'] 계약 재사용. (이미 >=769px 은 display:none 이라 데스크탑 오작동 없음) */
  body[data-keyboard-up='1'] & { display: none; }
  /* ★ 모바일에서는 화면에 떠서 리스트를 덮지 않는다 (2026-08-25).
     하단 고정 배너는 목록의 마지막 항목을 가리고, 사용자는 그걸 "레이아웃이 깨졌다" 로 읽는다.
     좁은 화면에서는 콘텐츠 흐름 안(인플로우)에 놓아 밀어내되 덮지 않게 한다.
     ≥769px 는 기존대로 하단 플로팅 — 데스크탑은 가릴 콘텐츠가 없다. */
  @media (max-width: 768px) {
    position: static;
    margin: 0 0 10px;
    width: auto;
    max-width: none;
    left: auto; right: auto; bottom: auto;
  }
`;
const BannerRow = styled.div`
  display: flex; align-items: center; gap: 12px;
`;
// 네이티브 앱 안내 아래 보조 줄 — "앱 없이 홈 화면에 추가" 경로를 남긴다
const SecondaryLine = styled.div`
  padding: 0 12px 8px;
`;
const LinkBtn = styled.button`
  all: unset; cursor: pointer;
  font-size: 0.75rem; color: #0D9488; text-decoration: underline;
  min-height: 36px; display: inline-flex; align-items: center;
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; border-radius: 4px; }
`;

const Steps = styled.div`
  display: flex; flex-direction: column; gap: 4px;
  padding: 10px 12px;
  background: #F8FAFC;
  border: 1px solid #E2E8F0;
  border-radius: 10px;
  margin-top: 4px;
`;
const Step = styled.div`
  font-size: 0.75rem; color: #334155; line-height: 1.5;
`;
const BannerIcon = styled.div<{ $bell?: boolean }>`
  width: 40px; height: 40px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  background: ${(p) => (p.$bell ? '#F0FDFA' : 'transparent')};
  color: #0F766E; flex-shrink: 0;
`;
const BannerBody = styled.div`flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;`;
const BannerTitle = styled.div`font-size: 0.8125rem; font-weight: 700; color: #0F172A;`;
const BannerDesc = styled.div`font-size: 0.6875rem; color: #64748B; line-height: 1.4;`;
const BannerActions = styled.div`display: flex; align-items: center; gap: 6px; flex-shrink: 0;`;
const PrimaryBtn = styled.button`
  padding: 8px 14px; background: #14B8A6; color: #FFFFFF;
  border: none; border-radius: 8px; font-size: 0.75rem; font-weight: 700; cursor: pointer;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const DismissBtn = styled.button`
  width: 28px; height: 28px; padding: 0;
  background: transparent; border: none; border-radius: 6px;
  font-size: 1.125rem; color: #94A3B8; cursor: pointer;
  &:hover { background: #F1F5F9; color: #475569; }
`;
