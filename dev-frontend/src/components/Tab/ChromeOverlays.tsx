// components/Tab/ChromeOverlays.tsx — ⑥ 트리 스왑 모드 전역 오버레이 (router-less zone)
//
// shell(App.tsx)이 렌더하던 오버레이를 tree-swap TabAppShell 에서도 렌더(기능 패리티). 전부 RR 탈피됨.
// TabMirror 제외(트리 스왑은 미러 아님). 조건부/idle mount 라 fallback={null} 안전.
import { Suspense, lazy } from 'react';
import NativeBridge from '../NativeBridge';
import { isNativeApp } from '../../services/native';

const CueHelpDrawer = lazy(() => import('../Common/CueHelpDrawer'));
const MemoFab = lazy(() => import('../QNote/MemoFab'));
const RightDock = lazy(() => import('../Common/RightDock'));
const NotificationToaster = lazy(() => import('../Common/NotificationToaster'));
const PwaInstallBanner = lazy(() => import('../Common/PwaInstallBanner'));
const OpenInAppBanner = lazy(() => import('../Common/OpenInAppBanner'));
const BuildVersionGuard = lazy(() => import('../Common/BuildVersionGuard'));
const LimitReachedDialog = lazy(() => import('../Common/LimitReachedDialog'));
const AnnouncementBanner = lazy(() => import('../Common/AnnouncementBanner'));
const TermsReacceptModal = lazy(() => import('../Common/TermsReacceptModal'));
const ImpersonateBanner = lazy(() => import('../Common/ImpersonateBanner'));

export default function ChromeOverlays() {
  return (
    <Suspense fallback={null}>
      <CueHelpDrawer />
      <MemoFab />
      <RightDock />
      <NotificationToaster />
      <NativeBridge />
      {!isNativeApp() && <PwaInstallBanner />}
      {!isNativeApp() && <OpenInAppBanner />}
      <BuildVersionGuard />
      <LimitReachedDialog />
      <AnnouncementBanner />
      <TermsReacceptModal />
      <ImpersonateBanner />
    </Suspense>
  );
}
