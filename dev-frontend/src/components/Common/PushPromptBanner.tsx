// 디바이스 알림 안내 — 모든 페이지 상단 (MainLayout 통합).
//   - default-off / granted-off / denied / iOS-not-pwa 표시
//   - granted-off: 자동 silent re-subscribe 시도 — 실패 시 명시 banner
//   - dismiss 는 sessionStorage (탭 닫으면 다시 표시 — 적극 유도)
//   - iOS Safari (PWA 아님) — push 자체 미지원이지만 사용자 안내 + "홈 화면에 추가" 유도
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { usePushStatus } from '../../hooks/usePushStatus';
import { isNativeApp } from '../../services/native';
import { nativePushStatus } from '../../services/nativePush';

const SESSION_DISMISS_KEY = 'pq_push_prompt_dismiss_session';

// iOS Safari 비-PWA 감지 — push 미지원이지만 별도 안내 ("홈 화면에 추가 후")
function isIosNotPwa(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  const isIos = /iphone|ipad|ipod/.test(ua) && !/crios|fxios/.test(ua);
  if (!isIos) return false;
  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return !standalone;
}

export default function PushPromptBanner() {
  const { t } = useTranslation('settings');
  const { status, refresh } = usePushStatus();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return sessionStorage.getItem(SESSION_DISMISS_KEY) === '1'; } catch { return false; }
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const iosNotPwa = isIosNotPwa();
  // ★ 디바이스 인지: 네이티브앱(Capacitor)은 웹 push 상태(usePushStatus)가 부정확 → 네이티브 OS 권한 기준.
  const native = isNativeApp();
  const [nativeStatus, setNativeStatus] = useState<'loading' | 'granted' | 'denied' | 'prompt' | 'unknown'>('loading');
  useEffect(() => {
    if (!native) return;
    let alive = true;
    nativePushStatus().then((s) => { if (alive) setNativeStatus(s); }).catch(() => { if (alive) setNativeStatus('unknown'); });
    return () => { alive = false; };
  }, [native]);

  const nativeEnable = async () => {
    setBusy(true); setErr(null);
    const { subscribe } = await import('../../services/push'); // 네이티브면 registerNative(APNs/FCM)
    const r = await subscribe();
    setBusy(false);
    if (r.ok) { setNativeStatus('granted'); await refresh(); }
    else setErr(t('pushPrompt.errMsg', '알림 켜기 실패: {{r}}', { r: r.reason || '' }) as string);
  };
  const nativeDismiss = () => { try { sessionStorage.setItem(SESSION_DISMISS_KEY, '1'); } catch { /* */ } setDismissed(true); };

  // N+72-6 — granted-off (OS 권한 OK + browser sub 없음) 자동 silent re-subscribe
  // 사용자가 명시 "지금 켜기" 누르지 않아도 자동 복구 (1회 시도)
  useEffect(() => {
    if (status !== 'granted-off') return;
    (async () => {
      const { subscribe } = await import('../../services/push');
      const r = await subscribe();
      if (r.ok) await refresh();  // banner 자동 사라짐
    })();
  }, [status, refresh]);

  if (dismissed) return null;

  // ★ 네이티브앱: OS 권한 기준으로 표시 (웹 문구/상태 사용 안 함).
  if (native) {
    if (nativeStatus === 'loading' || nativeStatus === 'granted') return null; // 허용됨/판정중 → 숨김
    const denied = nativeStatus === 'denied';
    return (
      <Banner role="status">
        <BellIcon>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
        </BellIcon>
        <Body>
          <Title>{denied
            ? t('pushPrompt.nativeDeniedTitle', { defaultValue: '알림이 꺼져 있어요' }) as string
            : t('pushPrompt.title', '디바이스 알림이 꺼져 있어요') as string}</Title>
          <Desc>{denied
            ? t('pushPrompt.nativeDeniedDesc', { defaultValue: '기기 설정 > PlanQ > 알림에서 허용해주세요.' }) as string
            : t('pushPrompt.desc', 'PlanQ 를 안 보고 있을 때도 새 메시지·업무 알림을 받으려면 켜주세요.') as string}</Desc>
          {err && <Err>{err}</Err>}
        </Body>
        {!denied && (
          <CtaBtn type="button" onClick={nativeEnable} disabled={busy}>
            {busy ? t('pushPrompt.enabling', '켜는 중…') as string : t('pushPrompt.enable', '지금 켜기') as string}
          </CtaBtn>
        )}
        <CloseBtn type="button" onClick={nativeDismiss} aria-label={t('common.close', '닫기') as string}>×</CloseBtn>
      </Banner>
    );
  }

  // iOS PWA 안 + push 안 됨 (default-off / granted-off) — 둘 다 banner 노출
  if (iosNotPwa && status !== 'denied') {
    // iOS Safari (PWA 아님) — "홈 화면에 추가" 유도 banner
    return (
      <Banner role="status">
        <BellIcon>📱</BellIcon>
        <Body>
          <Title>{t('pushPrompt.iosTitle', { defaultValue: 'iPhone 알림은 PlanQ 앱 설치 후 가능' }) as string}</Title>
          <Desc>{t('pushPrompt.iosDesc', { defaultValue: 'Safari 하단 공유 버튼 → "홈 화면에 추가" → 추가된 PlanQ 앱에서 알림이 작동해요' }) as string}</Desc>
        </Body>
        <CloseBtn type="button" onClick={() => {
          try { sessionStorage.setItem(SESSION_DISMISS_KEY, '1'); } catch { /* */ }
          setDismissed(true);
        }} aria-label={t('common.close', { defaultValue: '닫기' }) as string}>×</CloseBtn>
      </Banner>
    );
  }
  if (status === 'loading' || status === 'unsupported' || status === 'granted-on') return null;
  // granted-off 자동 silent subscribe 시도 중 — banner 안 보임 (사용자 noise 차단)
  if (status === 'granted-off') return null;

  const dismiss = () => {
    try { sessionStorage.setItem(SESSION_DISMISS_KEY, '1'); } catch { /* */ }
    setDismissed(true);
  };

  const handleEnable = async () => {
    setBusy(true); setErr(null);
    const { subscribe } = await import('../../services/push');
    const r = await subscribe();
    setBusy(false);
    if (r.ok) {
      await refresh();
    } else {
      setErr(t('pushPrompt.errMsg', '알림 켜기 실패: {{r}}', { r: r.reason || '' }) as string);
    }
  };

  const isDenied = status === 'denied';

  return (
    <Banner role="status">
      <BellIcon>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
      </BellIcon>
      <Body>
        <Title>
          {isDenied
            ? t('pushPrompt.deniedTitle', '디바이스 알림이 차단되어 있습니다')
            : t('pushPrompt.title', '디바이스 알림이 꺼져 있어요')}
        </Title>
        <Desc>
          {isDenied
            ? t('pushPrompt.deniedDesc', '브라우저 사이트 설정에서 알림을 "허용" 으로 변경하면 받을 수 있습니다.')
            : t('pushPrompt.desc', 'PlanQ 를 안 보고 있을 때도 새 메시지·업무 알림을 받으려면 켜주세요.')}
        </Desc>
        {err && <Err>{err}</Err>}
      </Body>
      {!isDenied && (
        <CtaBtn type="button" onClick={handleEnable} disabled={busy}>
          {busy ? t('pushPrompt.enabling', '켜는 중…') : t('pushPrompt.enable', '지금 켜기')}
        </CtaBtn>
      )}
      <SettingsLink to="/business/settings/notifications" onClick={dismiss}>
        {t('pushPrompt.settings', '알림 설정')}
      </SettingsLink>
      <CloseBtn type="button" onClick={dismiss} aria-label={t('common.close', '닫기') as string}>×</CloseBtn>
    </Banner>
  );
}

const Banner = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
  padding: 12px 14px;
  background: #FFF7ED;
  border: 1px solid #FED7AA;
  border-radius: 10px;
  margin-bottom: 16px;
  position: relative;
  /* 데스크탑: 한 줄 (아이콘·본문·CTA·설정·닫기) */
  @media (min-width: 641px) { flex-wrap: nowrap; }
  /* 모바일: 컴팩트 — 아이콘+제목 한 줄, 설명 숨김, 버튼은 작게(full-width 강제 제거).
     넛지 유지하되 콘텐츠 잠식 최소화 (~180px→~90px). */
  @media (max-width: 640px) {
    padding: 10px 40px 10px 12px;
    margin-bottom: 12px;
    gap: 8px;
  }
`;
const BellIcon = styled.div`
  width: 36px; height: 36px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: #FFEDD5;
  color: #C2410C;
  border-radius: 8px;
`;
const Body = styled.div`
  min-width: 0; flex: 1 1 auto;
  display: flex; flex-direction: column; gap: 2px;
`;
const Title = styled.div`font-size: 13px; font-weight: 700; color: #9A3412; line-height: 1.3;`;
const Desc = styled.div`font-size: 12px; color: #7C2D12; line-height: 1.4;`;
const Err = styled.div`font-size: 11px; color: #B91C1C; margin-top: 4px;`;
const CtaBtn = styled.button`
  height: 32px; padding: 0 14px;
  background: #14B8A6; color: #FFFFFF; border: none; border-radius: 8px;
  font-size: 12px; font-weight: 600; cursor: pointer;
  transition: background 0.15s;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
`;
const SettingsLink = styled(Link)`
  height: 32px; padding: 0 12px;
  display: inline-flex; align-items: center;
  background: transparent; color: #9A3412;
  border: 1px solid #FED7AA; border-radius: 8px;
  font-size: 12px; font-weight: 600; text-decoration: none;
  transition: background 0.15s;
  &:hover { background: #FFEDD5; }
`;
const CloseBtn = styled.button`
  width: 28px; height: 28px; flex-shrink: 0;
  background: transparent; border: none; cursor: pointer;
  color: #C2410C; font-size: 18px; line-height: 1;
  display: flex; align-items: center; justify-content: center;
  border-radius: 4px;
  &:hover { background: #FED7AA; }
  /* 모바일: 우상단 고정 (본문/버튼 흐름에서 빠짐) */
  @media (max-width: 640px) { position: absolute; top: 8px; right: 8px; }
`;
