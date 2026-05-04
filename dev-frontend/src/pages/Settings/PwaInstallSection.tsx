// 알림 설정 안 "디바이스 앱 설치" 섹션 — 영구 진입점.
// 상태별 UI:
//   - standalone (이미 설치됨)        → "이 디바이스에 설치됨" 배지 + 안내
//   - canPrompt (Android/Desktop OK) → "설치" 버튼
//   - iOS Safari                      → 공유 → 홈 화면 추가 안내 + 단계
//   - 그 외 (브라우저 미지원/이미 prompted) → 주소창 메뉴 안내
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { usePwaInstall } from '../../contexts/PwaInstallContext';

// 브라우저별 메뉴 위치는 OS·버전마다 달라 일반화된 안내 사용.
// 메뉴 명칭은 브라우저 한국어 UI 기준 (영어 환경에서는 i18n 분기로 영어 명칭 사용).
function getBrowserFallback(platform: string): string {
  switch (platform) {
    case 'android-chrome': return 'Chrome (Android)';
    case 'android-samsung': return 'Samsung Internet';
    case 'android-firefox': return 'Firefox (Android)';
    case 'desktop-chrome': return 'Chrome (데스크탑)';
    case 'desktop-edge': return 'Microsoft Edge';
    case 'desktop-firefox': return 'Firefox (데스크탑)';
    case 'desktop-safari': return 'Safari (데스크탑)';
    default: return '현재 브라우저';
  }
}

function getManualSteps(platform: string, t: TFunction): string[] {
  switch (platform) {
    case 'android-chrome':
      return [
        t('pwa.steps.androidChrome.1', '주소창 우측의 ⋮ (세로 점 3개) 메뉴를 엽니다') as string,
        t('pwa.steps.androidChrome.2', '"홈 화면에 추가" 또는 "앱 설치" 를 선택합니다') as string,
        t('pwa.steps.androidChrome.3', '"추가" / "설치" 를 눌러 완료합니다') as string,
      ];
    case 'android-samsung':
      return [
        t('pwa.steps.androidSamsung.1', '하단 ☰ 메뉴를 엽니다') as string,
        t('pwa.steps.androidSamsung.2', '"현재 페이지 추가" → "홈 화면" 을 선택합니다') as string,
      ];
    case 'desktop-chrome':
    case 'desktop-edge':
      return [
        t('pwa.steps.desktopChromium.1', '주소창 우측의 설치 아이콘 (⊕ 또는 모니터 + ↓) 을 클릭하거나') as string,
        t('pwa.steps.desktopChromium.2', '주소창 우측의 ⋮ 메뉴 → "PlanQ 설치" / "앱 설치" 를 선택합니다') as string,
        t('pwa.steps.desktopChromium.3', '설치 다이얼로그에서 "설치" 를 누르면 시작 메뉴·독에 추가됩니다') as string,
      ];
    case 'android-firefox':
    case 'desktop-firefox':
      return [
        t('pwa.steps.firefox.1', 'Firefox 는 PWA 설치를 제한적으로만 지원합니다') as string,
        t('pwa.steps.firefox.2', '권장: Chrome / Edge / Samsung Internet 으로 다시 열어주세요') as string,
      ];
    case 'desktop-safari':
      return [
        t('pwa.steps.desktopSafari.1', '데스크탑 Safari 는 PWA 설치를 지원하지 않습니다') as string,
        t('pwa.steps.desktopSafari.2', '북마크 / Dock 에 추가해 빠른 진입만 가능합니다') as string,
      ];
    default:
      return [
        t('pwa.steps.other.1', '이 브라우저는 PWA 설치를 지원하지 않거나 식별할 수 없습니다') as string,
        t('pwa.steps.other.2', 'Chrome / Edge / Samsung Internet 또는 iOS Safari 에서 다시 시도하세요') as string,
      ];
  }
}

const PwaInstallSection: React.FC = () => {
  const { t } = useTranslation('settings');
  const { isStandalone, isRelatedInstalled, canPrompt, isIos, platform, install } = usePwaInstall();
  const [busy, setBusy] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  // 이미 설치된 상태 — display-mode: standalone (PWA 로 실행 중) 또는
  // getInstalledRelatedApps 가 같은 origin PWA 를 보고함 (브라우저 탭에서 보고 있어도 true)
  const installed = isStandalone || isRelatedInstalled;

  const handleInstall = async () => {
    setBusy(true); setResultMsg(null);
    const r = await install();
    setBusy(false);
    if (r === 'accepted') setResultMsg(t('pwa.installedMsg', '설치되었습니다. 홈 화면에서 PlanQ 를 실행하세요.') as string);
    else if (r === 'dismissed') setResultMsg(t('pwa.dismissedMsg', '설치를 취소했습니다.') as string);
    else setResultMsg(t('pwa.unavailableMsg', '지금은 설치 프롬프트를 띄울 수 없습니다.') as string);
  };

  return (
    <Section>
      <SectionHeader>
        <IconWrap>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="2" width="14" height="20" rx="2"/>
            <line x1="12" y1="18" x2="12.01" y2="18"/>
          </svg>
        </IconWrap>
        <HeaderText>
          <Title>{t('pwa.sectionTitle', 'PlanQ 앱으로 설치')}</Title>
          <Desc>{t('pwa.sectionDesc', '홈 화면에 추가하면 빠른 진입과 알림 수신이 가능합니다.')}</Desc>
        </HeaderText>
        {installed && <InstalledBadge>{t('pwa.installedBadge', '설치됨')}</InstalledBadge>}
      </SectionHeader>

      {isStandalone && (
        <Body>
          <Note>{t('pwa.installedNote', '지금 PlanQ 앱으로 실행 중입니다. 다른 디바이스에서 설치하려면 그 기기의 브라우저에서 PlanQ 를 다시 열어주세요.')}</Note>
        </Body>
      )}

      {!isStandalone && isRelatedInstalled && (
        <Body>
          <Note>{t('pwa.relatedInstalledNote', '이 디바이스에 PlanQ 앱이 이미 설치되어 있습니다. 지금은 브라우저 탭에서 보고 있어요.')}</Note>
          <Note>{t('pwa.openInAppHint', '주소창 우측의 "Open in app" / "앱으로 열기" 를 누르거나, 홈 화면 / 앱 서랍 / 시작 메뉴의 PlanQ 아이콘으로 진입하세요.')}</Note>
        </Body>
      )}

      {!installed && isIos && (
        <Body>
          <Steps>
            <Step><StepNum>1</StepNum>{t('pwa.iosStep1', 'Safari 하단의 공유 버튼을 누릅니다')}</Step>
            <Step><StepNum>2</StepNum>{t('pwa.iosStep2', '"홈 화면에 추가" 를 선택합니다')}</Step>
            <Step><StepNum>3</StepNum>{t('pwa.iosStep3', '"추가" 를 눌러 완료합니다')}</Step>
          </Steps>
          <Note>{t('pwa.iosNote', 'iOS 는 보안 정책상 브라우저에서 자동으로 설치 다이얼로그를 띄울 수 없어 직접 메뉴 조작이 필요합니다.')}</Note>
        </Body>
      )}

      {!installed && !isIos && canPrompt && (
        <Body>
          <Note>{t('pwa.promptNote', '아래 버튼을 누르면 브라우저가 설치 다이얼로그를 띄웁니다. 수락하면 홈 화면(또는 앱 서랍·시작 메뉴) 에 PlanQ 아이콘이 추가됩니다.')}</Note>
          <Actions>
            <PrimaryBtn type="button" onClick={handleInstall} disabled={busy}>
              {busy ? t('pwa.installing', '설치 중…') : t('pwa.installNow', '지금 설치')}
            </PrimaryBtn>
          </Actions>
        </Body>
      )}

      {!installed && !isIos && !canPrompt && (
        <Body>
          <BrowserName>{t(`pwa.browser.${platform}`, getBrowserFallback(platform)) as string}</BrowserName>
          <Steps>
            {getManualSteps(platform, t).map((step, i) => (
              <Step key={i}><StepNum>{i + 1}</StepNum>{step}</Step>
            ))}
          </Steps>
          <Troubleshoot>
            <TroubleTitle>{t('pwa.troubleTitle', '메뉴가 안 보이나요?')}</TroubleTitle>
            <TroubleItem>· {t('pwa.troubleAlready', '이미 설치하셨을 수 있습니다 — 홈 화면 / 앱 서랍 / 시작 메뉴에서 PlanQ 를 찾아보세요.')}</TroubleItem>
            <TroubleItem>· {t('pwa.troubleCooldown', '한 번 설치 안내를 닫으면 며칠간 메뉴가 표시되지 않을 수 있습니다 (브라우저 정책).')}</TroubleItem>
            <TroubleItem>· {t('pwa.troubleIncognito', '시크릿 / 게스트 모드에서는 PWA 설치가 동작하지 않습니다.')}</TroubleItem>
          </Troubleshoot>
        </Body>
      )}

      {resultMsg && <ResultLine>{resultMsg}</ResultLine>}
    </Section>
  );
};

export default PwaInstallSection;

// ─── styled ───
const Section = styled.section`
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px;
  padding: 18px 20px; display: flex; flex-direction: column; gap: 14px;
`;
const SectionHeader = styled.div`
  display: flex; align-items: flex-start; gap: 12px;
`;
const IconWrap = styled.div`
  flex-shrink: 0; width: 40px; height: 40px;
  display: flex; align-items: center; justify-content: center;
  background: #F0FDFA; color: #0D9488; border-radius: 10px;
`;
const HeaderText = styled.div`
  flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px;
`;
const Title = styled.h3`font-size: 15px; font-weight: 700; color: #0F172A; margin: 0;`;
const Desc = styled.div`font-size: 12px; color: #64748B; line-height: 1.4;`;
const InstalledBadge = styled.span`
  flex-shrink: 0;
  display: inline-flex; align-items: center; height: 24px; padding: 0 10px;
  background: #F0FDFA; color: #0D9488;
  border: 1px solid #99F6E4; border-radius: 999px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.2px;
`;
const Body = styled.div`
  display: flex; flex-direction: column; gap: 10px;
`;
const Note = styled.div`
  font-size: 12px; color: #475569; line-height: 1.6;
`;
const Steps = styled.div`
  display: flex; flex-direction: column; gap: 8px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;
  padding: 12px 14px;
`;
const Step = styled.div`
  display: flex; align-items: center; gap: 10px;
  font-size: 13px; color: #0F172A;
`;
const StepNum = styled.span`
  flex-shrink: 0; width: 22px; height: 22px;
  display: inline-flex; align-items: center; justify-content: center;
  background: #14B8A6; color: #FFFFFF; border-radius: 50%;
  font-size: 11px; font-weight: 700;
`;
const Actions = styled.div`
  display: flex; gap: 8px;
`;
const PrimaryBtn = styled.button`
  height: 36px; padding: 0 18px;
  background: #14B8A6; color: #FFFFFF; border: none; border-radius: 8px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  transition: background 0.15s;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
`;
const ResultLine = styled.div`
  font-size: 12px; color: #0D9488;
  padding-top: 4px; border-top: 1px dashed #E2E8F0;
`;
const BrowserName = styled.div`
  font-size: 11px; font-weight: 700; color: #0D9488;
  text-transform: uppercase; letter-spacing: 0.4px;
`;
const Troubleshoot = styled.div`
  display: flex; flex-direction: column; gap: 4px;
  margin-top: 4px; padding: 12px 14px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;
`;
const TroubleTitle = styled.div`
  font-size: 12px; font-weight: 700; color: #0F172A; margin-bottom: 2px;
`;
const TroubleItem = styled.div`
  font-size: 12px; color: #475569; line-height: 1.6;
`;
