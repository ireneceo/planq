// 모바일 앱 다운로드 페이지 — 공개(비인증). planq.kr/app
//   환경 감지(iOS/Android/데스크탑) → 해당 스토어/파일로 안내. 링크는 platform_settings(관리자) 값.
//   출시 전이면 "출시 준비 중". 네이티브 앱 안에서 열면 "이미 앱에서 실행 중".
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { isNativeApp } from '../../services/native';

type Platform = 'ios' | 'android' | 'desktop';

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

interface DownloadInfo { ios_url: string | null; android_url: string | null; }

export default function DownloadAppPage() {
  const { t } = useTranslation('appdownload');
  const navigate = useNavigate();
  const [info, setInfo] = useState<DownloadInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const platform = detectPlatform();
  const inApp = isNativeApp();

  useEffect(() => {
    let cancelled = false;
    fetch('/api/app-download')
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setInfo(j?.data || { ios_url: null, android_url: null }); })
      .catch(() => { if (!cancelled) setInfo({ ios_url: null, android_url: null }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // 이미 네이티브 앱 안 — 다운로드 불필요.
  if (inApp) {
    return (
      <Screen>
        <Card>
          <Brand>PlanQ</Brand>
          <InAppTitle>{t('inApp.title')}</InAppTitle>
          {/* 네이티브 앱 안 — 마케팅 홈(/)이 아니라 워크스페이스(/inbox)로. 비로그인이면 /inbox 가드가 로그인으로 보냄 */}
          <PrimaryBtn as="button" type="button" onClick={() => navigate('/inbox')}>{t('inApp.cta')}</PrimaryBtn>
        </Card>
      </Screen>
    );
  }

  const iosUrl = info?.ios_url || null;
  const androidUrl = info?.android_url || null;

  const StoreCard = ({ p, url }: { p: 'ios' | 'android'; url: string | null }) => (
    <Platform_ $highlight={platform === p}>
      <PlatIcon>{p === 'ios' ? <AppleGlyph /> : <AndroidGlyph />}</PlatIcon>
      <PlatLabel>{t(`${p}.label`)}</PlatLabel>
      {url ? (
        <PrimaryBtn href={url} target="_blank" rel="noopener noreferrer">{t(`${p}.cta`)}</PrimaryBtn>
      ) : (
        <ComingSoon>{t('comingSoon')}</ComingSoon>
      )}
    </Platform_>
  );

  return (
    <Screen>
      <Card>
        <Brand>PlanQ</Brand>
        <Title>{t('title')}</Title>
        <Subtitle>{t('subtitle')}</Subtitle>

        {loading ? (
          <Skeleton />
        ) : platform === 'desktop' ? (
          <>
            <DesktopHint>{t('desktop.or')}</DesktopHint>
            <Grid>
              <StoreCard p="ios" url={iosUrl} />
              <StoreCard p="android" url={androidUrl} />
            </Grid>
            <UrlHint>{t('desktop.hint')}</UrlHint>
            <UrlBox>planq.kr/app</UrlBox>
          </>
        ) : (
          <SingleWrap>
            <StoreCard p={platform} url={platform === 'ios' ? iosUrl : androidUrl} />
          </SingleWrap>
        )}

        <NotifyNote>{t('notifyNote')}</NotifyNote>
        <WebLink href="/">{t('webContinue')}</WebLink>
      </Card>
    </Screen>
  );
}

// ── 아이콘 (인라인 SVG — 외부 의존 0) ──
const AppleGlyph = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M16.365 1.43c0 1.14-.42 2.2-1.13 3.02-.86.99-2.28 1.75-3.42 1.66-.14-1.1.42-2.28 1.09-3.02.75-.83 2.06-1.47 3.11-1.53.02.06.02.11.02.17-.02-.11 0 0 .26-.3zM20.9 17.02c-.55 1.27-.82 1.84-1.53 2.96-.99 1.57-2.39 3.52-4.12 3.53-1.54.01-1.93-1.01-4.02-1-2.09.01-2.52 1.02-4.06 1.01-1.73-.02-3.05-1.78-4.04-3.35-2.77-4.4-3.06-9.56-1.35-12.31 1.21-1.95 3.13-3.09 4.93-3.09 1.84 0 2.99 1.01 4.51 1.01 1.47 0 2.37-1.01 4.5-1.01 1.61 0 3.32.88 4.53 2.39-3.98 2.18-3.33 7.86.65 9.86z"/>
  </svg>
);
const AndroidGlyph = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M17.6 9.48l1.84-3.18a.4.4 0 00-.15-.55.4.4 0 00-.54.15l-1.86 3.22a11.36 11.36 0 00-8.78 0L6.25 5.9a.4.4 0 00-.54-.15.4.4 0 00-.15.55L7.4 9.48A10.78 10.78 0 002 18.5h20a10.78 10.78 0 00-5.4-9.02zM7 15.25a1 1 0 110-2 1 1 0 010 2zm10 0a1 1 0 110-2 1 1 0 010 2z"/>
  </svg>
);

const Screen = styled.div`
  min-height: 100vh; min-height: 100dvh;
  display: flex; align-items: center; justify-content: center;
  background: #F8FAFC; padding: 24px;
  padding-bottom: calc(24px + env(safe-area-inset-bottom));
`;
const Card = styled.div`
  width: 100%; max-width: 460px; background: #fff;
  border: 1px solid #E2E8F0; border-radius: 16px;
  padding: 32px 28px; text-align: center;
  box-shadow: 0 4px 12px rgba(0,0,0,0.06);
`;
const Brand = styled.div` font-size: 20px; font-weight: 700; color: #0F766E; letter-spacing: -0.3px; `;
const Title = styled.h1` margin: 16px 0 8px; font-size: 22px; font-weight: 700; color: #0F172A; `;
const Subtitle = styled.p` margin: 0 0 24px; font-size: 14px; line-height: 1.6; color: #334155; `;
const SingleWrap = styled.div` display: flex; justify-content: center; `;
const Grid = styled.div` display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; @media (max-width: 420px) { grid-template-columns: 1fr; } `;
const Platform_ = styled.div<{ $highlight?: boolean }>`
  border: 1px solid ${(p) => (p.$highlight ? '#14B8A6' : '#E2E8F0')};
  background: ${(p) => (p.$highlight ? '#F0FDFA' : '#fff')};
  border-radius: 12px; padding: 20px 16px; min-width: 180px;
  display: flex; flex-direction: column; align-items: center; gap: 10px;
`;
const PlatIcon = styled.div` color: #0F172A; display: flex; `;
const PlatLabel = styled.div` font-size: 13px; font-weight: 600; color: #334155; `;
const PrimaryBtn = styled.a`
  display: inline-flex; align-items: center; justify-content: center;
  padding: 11px 18px; border-radius: 8px; font-size: 14px; font-weight: 600;
  background: #14B8A6; color: #fff; text-decoration: none; border: none; cursor: pointer;
  transition: background 0.15s; width: 100%;
  &:hover { background: #0D9488; }
  &:active { background: #0F766E; }
`;
const ComingSoon = styled.div`
  padding: 11px 14px; border-radius: 8px; font-size: 13px; font-weight: 500;
  color: #64748B; background: #F1F5F9; width: 100%;
`;
const DesktopHint = styled.div` font-size: 13px; font-weight: 500; color: #64748B; margin-bottom: 12px; `;
const UrlHint = styled.div` font-size: 13px; color: #64748B; margin-top: 8px; `;
const UrlBox = styled.div`
  margin-top: 8px; padding: 10px 16px; border-radius: 8px; background: #F1F5F9;
  font-size: 15px; font-weight: 600; color: #0F766E; letter-spacing: 0.2px; display: inline-block;
`;
const NotifyNote = styled.p` margin: 20px 0 0; font-size: 12px; color: #94A3B8; line-height: 1.5; `;
const WebLink = styled.a` display: inline-block; margin-top: 16px; font-size: 13px; color: #64748B; text-decoration: underline; `;
const InAppTitle = styled.h1` margin: 16px 0 24px; font-size: 18px; font-weight: 700; color: #0F172A; `;
const Skeleton = styled.div` height: 120px; border-radius: 12px; background: #F1F5F9; `;
