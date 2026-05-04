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

type Platform = 'ios' | 'android-chrome' | 'desktop-chrome' | 'other';

interface PwaInstallState {
  isStandalone: boolean;          // 이미 설치되어 PWA 모드로 실행 중
  canPrompt: boolean;             // beforeinstallprompt 받아둔 상태 — install() 호출 가능
  isIos: boolean;                 // iOS Safari (prompt API 미지원, 수동 안내만)
  platform: Platform;
  dismissedThisSession: boolean;  // 이번 탭 세션에서 사용자가 닫음
  install: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
  dismissForSession: () => void;
}

const Ctx = createContext<PwaInstallState | null>(null);

const SESSION_DISMISS_KEY = 'pq_pwa_install_dismiss_session';

function detectPlatform(): { platform: Platform; isIos: boolean; isStandalone: boolean } {
  const ua = navigator.userAgent.toLowerCase();
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  const isIos = /iphone|ipad|ipod/.test(ua) && /safari/.test(ua) && !/crios|fxios/.test(ua);
  const isAndroid = /android/.test(ua);
  let platform: Platform = 'other';
  if (isIos) platform = 'ios';
  else if (isAndroid && /chrome|edg/.test(ua)) platform = 'android-chrome';
  else if (/chrome|edg/.test(ua)) platform = 'desktop-chrome';
  return { platform, isIos, isStandalone };
}

export function PwaInstallProvider({ children }: { children: ReactNode }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [{ platform, isIos, isStandalone }, setEnv] = useState(detectPlatform);
  const [dismissedThisSession, setDismissedThisSession] = useState<boolean>(() => {
    try { return sessionStorage.getItem(SESSION_DISMISS_KEY) === '1'; } catch { return false; }
  });

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

  const value: PwaInstallState = {
    isStandalone,
    canPrompt: !!deferred,
    isIos,
    platform,
    dismissedThisSession,
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
