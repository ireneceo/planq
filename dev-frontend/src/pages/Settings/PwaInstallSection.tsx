// 알림 설정 안 "디바이스 앱 설치" 섹션 — 영구 진입점.
// 상태별 UI:
//   - standalone (이미 설치됨)        → "이 디바이스에 설치됨" 배지 + 안내
//   - canPrompt (Android/Desktop OK) → "설치" 버튼
//   - iOS Safari                      → 공유 → 홈 화면 추가 안내 + 단계
//   - 그 외 (브라우저 미지원/이미 prompted) → 주소창 메뉴 안내
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { usePwaInstall } from '../../contexts/PwaInstallContext';

const PwaInstallSection: React.FC = () => {
  const { t } = useTranslation('settings');
  const { isStandalone, canPrompt, isIos, platform, install } = usePwaInstall();
  const [busy, setBusy] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

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
        {isStandalone && <InstalledBadge>{t('pwa.installedBadge', '설치됨')}</InstalledBadge>}
      </SectionHeader>

      {isStandalone && (
        <Body>
          <Note>{t('pwa.installedNote', '지금 PlanQ 앱으로 실행 중입니다. 다른 디바이스에서 설치하려면 그 기기의 브라우저에서 PlanQ 를 다시 열어주세요.')}</Note>
        </Body>
      )}

      {!isStandalone && isIos && (
        <Body>
          <Steps>
            <Step><StepNum>1</StepNum>{t('pwa.iosStep1', 'Safari 하단의 공유 버튼을 누릅니다')}</Step>
            <Step><StepNum>2</StepNum>{t('pwa.iosStep2', '"홈 화면에 추가" 를 선택합니다')}</Step>
            <Step><StepNum>3</StepNum>{t('pwa.iosStep3', '"추가" 를 눌러 완료합니다')}</Step>
          </Steps>
          <Note>{t('pwa.iosNote', 'iOS 는 보안 정책상 브라우저에서 자동으로 설치 다이얼로그를 띄울 수 없어 직접 메뉴 조작이 필요합니다.')}</Note>
        </Body>
      )}

      {!isStandalone && !isIos && canPrompt && (
        <Body>
          <Note>{t('pwa.promptNote', '아래 버튼을 누르면 브라우저가 설치 다이얼로그를 띄웁니다. 수락하면 홈 화면(또는 앱 서랍·시작 메뉴) 에 PlanQ 아이콘이 추가됩니다.')}</Note>
          <Actions>
            <PrimaryBtn type="button" onClick={handleInstall} disabled={busy}>
              {busy ? t('pwa.installing', '설치 중…') : t('pwa.installNow', '지금 설치')}
            </PrimaryBtn>
          </Actions>
        </Body>
      )}

      {!isStandalone && !isIos && !canPrompt && (
        <Body>
          <Note>
            {platform === 'android-chrome' || platform === 'desktop-chrome'
              ? t('pwa.manualHint', '브라우저 주소창 우측의 점 3개 메뉴 → "앱 설치" / "PlanQ 설치" 를 선택하세요.')
              : t('pwa.unsupportedHint', '이 브라우저는 PWA 설치를 지원하지 않습니다. Chrome / Edge / Samsung Internet 또는 iOS Safari 에서 다시 시도하세요.')}
          </Note>
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
