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
// #258 — 팝아웃/PiP 요청 수신자. 트리 스왑이 데스크탑 기본 경로라 여기 없으면 실사용자에게 수신자가 0 이다.
//   router-less zone 이므로 useNavigate 대신 tabStore 를 쓰는 chrome 변종을 마운트한다.
const PopoutBridgeChrome = lazy(() => import('../Common/PopoutBridge').then((m) => ({ default: m.PopoutBridgeChrome })));

export default function ChromeOverlays() {
  return (
    <Suspense fallback={null}>
      <CueHelpDrawer />
      <MemoFab />
      <RightDock />
      {/* App.tsx 와 같은 계약 — 네이티브(예: iPad 가로, ≥1025px 라 탭 모드)에서는 OS 알림이 담당 */}
      {!isNativeApp() && <NotificationToaster />}
      <NativeBridge />
      {!isNativeApp() && <PwaInstallBanner />}
      {!isNativeApp() && <OpenInAppBanner />}
      <PopoutBridgeChrome />
      <BuildVersionGuard />
      <LimitReachedDialog />
      <AnnouncementBanner />
      <TermsReacceptModal />
      <ImpersonateBanner />
    </Suspense>
  );
}
