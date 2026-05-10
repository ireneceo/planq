// PWA 설치 상태 전역 관리.
// beforeinstallprompt 이벤트는 페이지 로드 시 한 번만 발생 — App.tsx 레벨에서 잡아 저장해야
// banner 와 설정 섹션이 같은 deferred prompt 를 공유할 수 있다.
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

type Platform = 'ios' | 'android-chrome' | 'android-samsung' | 'android-firefox' | 'desktop-chrome' | 'desktop-edge' | 'desktop-firefox' | 'desktop-safari' | 'other';

interface PwaInstallState {
  isStandalone: boolean;          // 이미 설치되어 PWA 모드로 실행 중 (display-mode: standalone)
  isRelatedInstalled: boolean;    // 같은 origin PWA 가 OS 에 이미 설치됨 (브라우저 탭에서 보더라도 true)
  canPrompt: boolean;             // beforeinstallprompt 받아둔 상태 — install() 호출 가능
  isIos: boolean;                 // iOS Safari (prompt API 미지원, 수동 안내만)
  platform: Platform;
  dismissedThisSession: boolean;  // 이번 탭 세션에서 사용자가 닫음
  dismissedUntil: number | null;  // 이 시각(ms)까지 영구 dismiss (사용자가 "7일 안 보기" 선택)
  install: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
  dismissForSession: () => void;
  dismissFor7Days: () => void;   // localStorage 에 7일 만료 박음
}

const Ctx = createContext<PwaInstallState | null>(null);

const SESSION_DISMISS_KEY = 'pq_pwa_install_dismiss_session';
// 사용자가 "7일 동안 안 보기" 선택 시 localStorage 에 만료 timestamp 저장
const PERSIST_DISMISS_KEY = 'pq_pwa_install_dismiss_until';
const DISMISS_DAYS = 7;

function detectPlatform(): { platform: Platform; isIos: boolean; isStandalone: boolean } {
  const ua = navigator.userAgent.toLowerCase();
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  const isIos = /iphone|ipad|ipod/.test(ua) && /safari/.test(ua) && !/crios|fxios/.test(ua);
  const isAndroid = /android/.test(ua);
  let platform: Platform = 'other';
  if (isIos) platform = 'ios';
  else if (isAndroid && /samsungbrowser/.test(ua)) platform = 'android-samsung';
  else if (isAndroid && /firefox|fxios/.test(ua)) platform = 'android-firefox';
  else if (isAndroid && /chrome|edg/.test(ua)) platform = 'android-chrome';
  else if (/edg/.test(ua)) platform = 'desktop-edge';
  else if (/firefox/.test(ua)) platform = 'desktop-firefox';
  else if (/safari/.test(ua) && !/chrome/.test(ua)) platform = 'desktop-safari';
  else if (/chrome/.test(ua)) platform = 'desktop-chrome';
  return { platform, isIos, isStandalone };
}

export function PwaInstallProvider({ children }: { children: ReactNode }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [{ platform, isIos, isStandalone }, setEnv] = useState(detectPlatform);
  const [isRelatedInstalled, setIsRelatedInstalled] = useState(false);
  const [dismissedThisSession, setDismissedThisSession] = useState<boolean>(() => {
    try { return sessionStorage.getItem(SESSION_DISMISS_KEY) === '1'; } catch { return false; }
  });
  const [dismissedUntil, setDismissedUntil] = useState<number | null>(() => {
    try {
      const v = Number(localStorage.getItem(PERSIST_DISMISS_KEY) || '0');
      if (!Number.isFinite(v) || v <= 0) return null;
      if (v < Date.now()) { localStorage.removeItem(PERSIST_DISMISS_KEY); return null; }
      return v;
    } catch { return null; }
  });

  // navigator.getInstalledRelatedApps() — 같은 origin PWA 가 이미 설치되어 있는지 감지.
  // Chrome 81+ 만 지원. manifest 에 related_applications + prefer_related_applications=false 필요.
  // 사용자가 PWA 를 설치한 뒤 일반 브라우저 탭으로 다시 들어와도 true 가 됨 (display-mode: standalone 은 false 인 케이스).
  useEffect(() => {
    if (isStandalone) return;
    type Nav = Navigator & { getInstalledRelatedApps?: () => Promise<{ platform?: string; url?: string }[]> };
    const nav = navigator as Nav;
    if (typeof nav.getInstalledRelatedApps !== 'function') return;
    nav.getInstalledRelatedApps()
      .then(apps => { if (apps && apps.length > 0) setIsRelatedInstalled(true); })
      .catch(() => { /* 미지원/거절 — 무시 */ });
  }, [isStandalone]);

  useEffect(() => {
    if (isStandalone) return; // 이미 설치됨 → 이벤트 캐치 불필요

    const onBefore = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setEnv(detectPlatform()); // standalone 재감지
    };
    window.addEventListener('beforeinstallprompt', onBefore);
    window.addEventListener('appinstalled', onInstalled);

    // display-mode 변경 감지 (브라우저에서 PWA 로 전환되는 경우)
    const mql = window.matchMedia('(display-mode: standalone)');
    const onMql = () => setEnv(detectPlatform());
    mql.addEventListener?.('change', onMql);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBefore);
      window.removeEventListener('appinstalled', onInstalled);
      mql.removeEventListener?.('change', onMql);
    };
  }, [isStandalone]);

  const install = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!deferred) return 'unavailable';
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      setDeferred(null);
      return choice.outcome;
    } catch {
      return 'unavailable';
    }
  }, [deferred]);

  const dismissForSession = useCallback(() => {
    try { sessionStorage.setItem(SESSION_DISMISS_KEY, '1'); } catch { /* ignore */ }
    setDismissedThisSession(true);
  }, []);

  const dismissFor7Days = useCallback(() => {
    const until = Date.now() + DISMISS_DAYS * 24 * 60 * 60 * 1000;
    try { localStorage.setItem(PERSIST_DISMISS_KEY, String(until)); } catch { /* ignore */ }
    setDismissedUntil(until);
    setDismissedThisSession(true); // 이번 탭에도 즉시 숨김
  }, []);

  const value: PwaInstallState = {
    isStandalone,
    isRelatedInstalled,
    canPrompt: !!deferred,
    isIos,
    platform,
    dismissedThisSession,
    dismissedUntil,
    dismissFor7Days,
    install,
    dismissForSession,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePwaInstall(): PwaInstallState {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePwaInstall must be used inside PwaInstallProvider');
  return v;
}
