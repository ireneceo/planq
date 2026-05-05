// 운영 공지 배너 — 사이드바 상단 또는 메인 영역 상단. /me 의 platform.announcement_text 사용.
// 점검 모드 알림은 별도 미들웨어가 503 응답 → 점검 시 사용자는 페이지에 못 들어옴, 이 배너는 평시 공지용.
import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { useAuth } from '../../contexts/AuthContext';

const DISMISS_KEY_PREFIX = 'planq_announce_dismissed:';

const AnnouncementBanner: React.FC = () => {
  const { user } = useAuth();
  const ann = user?.platform;
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!ann?.announcement_text) { setDismissed(false); return; }
    // 같은 공지 텍스트에 대해 이전에 dismiss 했는지 확인 (텍스트 변경되면 다시 보임)
    const key = DISMISS_KEY_PREFIX + hashString(ann.announcement_text);
    if (window.localStorage.getItem(key) === '1') setDismissed(true);
    else setDismissed(false);
  }, [ann?.announcement_text]);

  const handleDismiss = () => {
    if (!ann?.announcement_text) return;
    const key = DISMISS_KEY_PREFIX + hashString(ann.announcement_text);
    window.localStorage.setItem(key, '1');
    setDismissed(true);
  };

  if (!ann?.announcement_text || dismissed) return null;

  return (
    <Banner $sev={ann.announcement_severity}>
      <BannerIcon $sev={ann.announcement_severity}>
        {ann.announcement_severity === 'critical' ? '⚠' : ann.announcement_severity === 'warn' ? '!' : 'ⓘ'}
      </BannerIcon>
      <BannerText>{ann.announcement_text}</BannerText>
      {ann.announcement_dismissible && (
        <DismissBtn type="button" onClick={handleDismiss} aria-label="Dismiss">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </DismissBtn>
      )}
    </Banner>
  );
};

function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

export default AnnouncementBanner;

const Banner = styled.div<{ $sev: 'info'|'warn'|'critical' }>`
  display: flex; align-items: center; gap: 10px;
  padding: 10px 16px;
  background: ${p => p.$sev === 'critical' ? '#FEF2F2' : p.$sev === 'warn' ? '#FEF3C7' : '#F0FDFA'};
  border-bottom: 1px solid ${p => p.$sev === 'critical' ? '#FECACA' : p.$sev === 'warn' ? '#FDE68A' : '#99F6E4'};
  font-size: 13px; line-height: 1.5;
  color: ${p => p.$sev === 'critical' ? '#B91C1C' : p.$sev === 'warn' ? '#92400E' : '#0F766E'};
`;
const BannerIcon = styled.span<{ $sev: 'info'|'warn'|'critical' }>`
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; flex-shrink: 0;
  background: ${p => p.$sev === 'critical' ? '#FEE2E2' : p.$sev === 'warn' ? '#FDE68A' : '#CCFBF1'};
  border-radius: 50%; font-weight: 700; font-size: 12px;
`;
const BannerText = styled.span`flex: 1; font-weight: 500;`;
const DismissBtn = styled.button`
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px;
  background: transparent; border: none; border-radius: 6px; cursor: pointer;
  color: inherit; opacity: 0.6;
  &:hover { opacity: 1; background: rgba(0,0,0,0.05); }
`;
