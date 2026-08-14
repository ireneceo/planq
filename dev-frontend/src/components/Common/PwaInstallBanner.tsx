// PWA 홈화면 추가 안내 배너 — 모바일 우선.
//   - Chrome/Edge: beforeinstallprompt 잡혀 있으면 직접 prompt
//   - iOS Safari: prompt API 미지원 → 사용 안내 (공유 → 홈 화면에 추가)
//   - dismiss 정책 (사이클 N+3 보완):
//     · sessionStorage — 이번 탭만 닫기 (X 버튼)
//     · localStorage 7일 — "7일 동안 안 보기" 버튼 (사용자가 영구히 안 보고 싶을 때)
//   - 이미 설치(standalone) 된 경우는 노출 X
//   - 상태는 PwaInstallContext 가 관리 → 설정 페이지의 InstallSection 과 deferred 공유
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { usePwaInstall } from '../../contexts/PwaInstallContext';

export default function PwaInstallBanner() {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const { isStandalone, isRelatedInstalled, canPrompt, isIos, dismissedThisSession, dismissedUntil, install, dismissForSession, dismissFor7Days } = usePwaInstall();

  if (!user) return null;
  if (isStandalone || isRelatedInstalled) return null;
  if (dismissedThisSession) return null;
  if (dismissedUntil && dismissedUntil > Date.now()) return null;  // 7일 안 보기 활성
  if (!canPrompt && !isIos) return null;

  const handleInstall = async () => {
    const result = await install();
    if (result === 'dismissed') dismissForSession();
  };

  // 비모달 배너에 role="dialog" 를 주면 안 된다 — 검사 하니스가 [role=dialog]/[aria-modal] 로
  // 모달을 스코핑하는데(CLAUDE.md §17), 이 배너가 잡혀 판정이 오염된다. complementary 가 맞다.
  return (
    <BannerRoot role="complementary" aria-label={t('pwa.installAria', '앱으로 설치') as string}>
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
      <SnoozeBtn type="button" onClick={dismissFor7Days} title={t('pwa.snooze7d', { defaultValue: '7일 동안 안 보기' }) as string}>
        {t('pwa.snooze7dShort', { defaultValue: '7일 안 보기' }) as string}
      </SnoozeBtn>
      <CloseBtn type="button" onClick={dismissForSession} aria-label={t('common.close', '닫기') as string}>×</CloseBtn>
    </BannerRoot>
  );
}

const BannerRoot = styled.div`
  position: fixed;
  /* ★ 우하단 도크 FAB(RightDock: right 20 / bottom 16 / 52×52) 위로 비켜선다.
     bottom 16 이면 이 배너(z 8500)가 FAB(z 120)을 통째로 덮어 **모든 페이지에서 도크가 안 눌린다**
     — 2026-08-14 실측으로 5/5 페이지 도달 0 확인. 80 = FAB top(16+52=68) + gap(12).
     모바일용 InstallPromptBanner 가 같은 이유로 이미 80 을 쓰고 있었는데 이 배너만 규칙을 못 받았다. */
  bottom: calc(80px + env(safe-area-inset-bottom, 0px));
  right: 16px;
  z-index: 8500;
  display: grid;
  grid-template-columns: 36px 1fr auto auto auto;
  gap: 8px;
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
  /* 모바일은 InstallPromptBanner("앱처럼 사용하기") 하나만 노출 — 중복 배너 방지.
     데스크탑(≥769px)에서만 이 배너 표시. */
  @media (max-width: 768px) { display: none; }
  /* 도크 퀵메뉴를 펼치면 메뉴가 이 자리로 올라온다 — 설치 안내가 그 위를 덮지 않게 비운다.
     (배너 z 8500 > 메뉴 z 120 이라 안 비우면 딤 배경 위에 배너만 밝게 떠 메뉴를 가린다.) */
  body[data-dock-open="1"] & { display: none; }
  /* 모달·드로어가 열린 동안에도 비운다 — 설치 권유가 다이얼로그 하단 버튼을 덮으면 안 된다.
     RightDock FAB 이 쓰는 것과 같은 계약(useBodyScrollLock 가 토글). */
  body[data-overlay-open="true"] & { display: none; }
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
const SnoozeBtn = styled.button`
  height: 32px; padding: 0 10px;
  background: #fff; color: #64748B; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 11px; font-weight: 600; cursor: pointer;
  &:hover { border-color: #CBD5E1; background: #F8FAFC; }
`;
